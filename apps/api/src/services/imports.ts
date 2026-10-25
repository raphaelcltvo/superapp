import * as XLSX from "xlsx";
import { normPhone, r2, uid, type Customer, type Order } from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";
import { recomputeStats, upsertCustomer } from "./customers";

export type ImportKind = "customers" | "orders";
export const FIELDS: Record<ImportKind, { key: string; label: string; required?: boolean; aliases: string[] }[]> = {
  customers: [
    { key: "phone", label: "Telefone", required: true, aliases: ["telefone", "celular", "phone", "whatsapp", "fone", "tel"] },
    { key: "name", label: "Nome", aliases: ["nome", "cliente", "name", "nome cliente", "nome do cliente"] },
    { key: "email", label: "E-mail", aliases: ["email", "e-mail", "mail"] },
    { key: "document", label: "CPF", aliases: ["cpf", "documento", "document", "cpf/cnpj"] },
    { key: "birthday", label: "Aniversário", aliases: ["aniversario", "nascimento", "data de nascimento", "birthday"] },
    { key: "optinWhatsapp", label: "Aceita WhatsApp", aliases: ["optin", "opt-in", "aceita whatsapp", "aceite"] },
    { key: "externalId", label: "ID no sistema de origem", aliases: ["id", "id cliente", "id_cliente", "codigo", "código"] },
    { key: "source", label: "Origem", aliases: ["origem", "canal", "source"] },
  ],
  orders: [
    { key: "orderId", label: "ID do pedido", required: true, aliases: ["id pedido", "pedido", "id_pedido", "order_id", "codigo", "nº pedido", "numero"] },
    { key: "createdAt", label: "Data/hora", required: true, aliases: ["data", "data pedido", "data/hora", "created_at", "dt_pedido", "data_hora"] },
    { key: "total", label: "Valor total", required: true, aliases: ["total", "valor", "valor total", "vl_total", "faturamento"] },
    { key: "phone", label: "Telefone do cliente", aliases: ["telefone", "celular", "phone", "fone"] },
    { key: "name", label: "Nome do cliente", aliases: ["nome", "cliente", "nome cliente"] },
    { key: "externalCustomerId", label: "ID do cliente", aliases: ["id cliente", "id_cliente", "cliente id"] },
    { key: "channel", label: "Canal", aliases: ["canal", "origem", "plataforma", "channel"] },
    { key: "status", label: "Status", aliases: ["status", "situacao", "situação"] },
    { key: "items", label: "Qtde de itens", aliases: ["itens", "qtd itens", "quantidade"] },
  ],
};

const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function parseFile(bytes: Uint8Array, filename: string) {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true, raw: false, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false, dateNF: "yyyy-mm-dd hh:mm" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers, sheet: wb.SheetNames[0], filename };
}

export function suggest(kind: ImportKind, headers: string[]) {
  const map: Record<string, string> = {};
  for (const f of FIELDS[kind]) { const h = headers.find((x) => f.aliases.includes(n(x)) || n(x) === n(f.label)); if (h) map[f.key] = h; }
  return map;
}

const parseMoney = (v: unknown) => { const s = String(v ?? "").replace(/[R$\s]/g, ""); const x = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s; return r2(Number(x) || 0); };
const parseDate = (v: unknown) => {
  const s = String(v ?? "").trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (br) { const y = br[3].length === 2 ? "20" + br[3] : br[3]; return new Date(`${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T${(br[4] || "12").padStart(2, "0")}:${br[5] || "00"}:00-03:00`).toISOString(); }
  const d = new Date(s); return isNaN(+d) ? null : d.toISOString();
};
const truthy = (v: unknown) => ["1", "sim", "s", "yes", "true", "y", "x"].includes(n(String(v ?? "")));

/** Cria o job de importação com prévia; nada é gravado nos clientes/pedidos até o commit. */
export async function createImport(ctx: Ctx, kind: ImportKind, bytes: Uint8Array, filename: string) {
  const { rows, headers } = parseFile(bytes, filename);
  if (!rows.length) throw new HttpError(422, "Arquivo sem linhas");
  if (rows.length > 200000) throw new HttpError(422, "Máximo de 200 mil linhas por arquivo");
  const job = { id: uid("imp"), kind, filename, headers, mapping: suggest(kind, headers), total: rows.length, preview: rows.slice(0, 8), status: "mapeando", createdAt: ctx.deps.now().toISOString(), rows };
  await ctx.deps.db.put("imports", ctx.tenantId, job as never);
  const { rows: _r, ...out } = job; return out;
}

export async function commitImport(ctx: Ctx, id: string, mapping: Record<string, string>) {
  const job = await ctx.deps.db.get<{ id: string; kind: ImportKind; rows: Record<string, unknown>[]; filename: string }>("imports", ctx.tenantId, id);
  if (!job) throw new HttpError(404, "Importação não encontrada");
  const miss = FIELDS[job.kind].filter((f) => f.required && !mapping[f.key]);
  if (miss.length) throw new HttpError(422, "Mapeie: " + miss.map((f) => f.label).join(", "));
  const get = (r: Record<string, unknown>, k: string) => (mapping[k] ? r[mapping[k]] : undefined);
  const report = { created: 0, updated: 0, skipped: 0, errors: [] as { row: number; message: string }[] };
  const touched = new Set<string>();
  for (const [i, r] of job.rows.entries()) {
    try {
      if (job.kind === "customers") {
        const phone = normPhone(String(get(r, "phone") ?? ""));
        if (!phone) { report.skipped++; report.errors.push({ row: i + 2, message: "telefone inválido" }); continue; }
        const before = await ctx.deps.db.count("customers", ctx.tenantId, { where: { phone } });
        const ext = get(r, "externalId");
        await upsertCustomer(ctx, { phone, name: (get(r, "name") as string) || undefined, email: (get(r, "email") as string) || undefined, document: (get(r, "document") as string) || undefined, birthday: get(r, "birthday") ? parseDate(get(r, "birthday"))?.slice(0, 10) : undefined, optinWhatsapp: mapping.optinWhatsapp ? truthy(get(r, "optinWhatsapp")) : undefined, source: (get(r, "source") as string) || undefined, externalIds: ext ? { importacao: String(ext) } : undefined });
        before ? report.updated++ : report.created++;
      } else {
        const createdAt = parseDate(get(r, "createdAt"));
        const total = parseMoney(get(r, "total"));
        if (!createdAt || !total) { report.skipped++; report.errors.push({ row: i + 2, message: "data ou valor inválido" }); continue; }
        let customerId: string | undefined;
        const phone = normPhone(String(get(r, "phone") ?? ""));
        if (phone) customerId = (await upsertCustomer(ctx, { phone, name: (get(r, "name") as string) || undefined, source: (get(r, "channel") as string) || undefined })).id;
        const oid = `imp_${String(get(r, "orderId"))}`;
        const exists = await ctx.deps.db.get("orders", ctx.tenantId, oid);
        const st = n(String(get(r, "status") ?? ""));
        const order: Partial<Order> & { id: string; imported: boolean } = { id: oid, imported: true, displayId: String(get(r, "orderId")), storeId: "", customerId, mode: "DELIVERY", lines: [], subtotal: total, discount: 0, deliveryFee: 0, fees: [], strategiesApplied: [], cashbackUsed: 0, total, cashbackEarned: 0, payment: { code: "PIX_ONLINE" }, status: st.includes("cancel") ? "cancelled" : "concluded", statusHistory: [], source: "import:" + (get(r, "channel") || job.filename), createdAt };
        (order as Record<string, unknown>).itemsCount = Number(get(r, "items")) || undefined;
        await ctx.deps.db.put("orders", ctx.tenantId, order as never);
        exists ? report.updated++ : report.created++;
        if (customerId) touched.add(customerId);
      }
    } catch (e) { report.skipped++; report.errors.push({ row: i + 2, message: String((e as Error).message || e) }); }
  }
  for (const cid of touched) await recomputeStats(ctx, cid);
  await ctx.deps.db.patch("imports", ctx.tenantId, id, { status: "concluida", mapping, report: { ...report, errors: report.errors.slice(0, 200) }, rows: [], finishedAt: ctx.deps.now().toISOString() });
  return report;
}
