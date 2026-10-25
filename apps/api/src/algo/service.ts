/**
 * Serviço do algoritmo: camada 0 (SETUP / Agente S), agentes, achados, testes (Agente G),
 * decisões do orquestrador e o ciclo vivo que alimenta o cockpit.
 */
import { normPhone, r2 as round2, uid, type Customer, type Item, type OptionGroup, type Order } from "@cw/core";
import {
  AGENTS, DEFAULT_AGENT_PARAMS, LEVERS, MARKETPLACES, computeLadder, detectChannel, detectKind, evasion, itemTokens, markRecovered,
  matchItem, pickArm, prioritizeLeaks, probBest, sessionOutcomes, suggestSalesMapping,
  type AgentCode, type AgentState, type ArmStat, type CatalogEntry, type Channel, type Cohort, type Critique, type DataRequest,
  type Decision, type Dossier, type Experiment, type FileKind, type Finding, type Ladder, type SetupFile, type SetupRun, type Severity,
} from "../../../../packages/core/src/algo";
import { algoDbOf, type SalesLineRow } from "./db";
import type { Ctx } from "../services/ctx";
import { HttpError } from "../services/ctx";
import { parseFile } from "../services/imports";
import { upsertCustomer } from "../services/customers";

/** Banco do algoritmo (esquema próprio). As tabelas do cardápio/CRM são lidas por ctx.deps.db. */
const A = (ctx: Ctx) => algoDbOf(ctx.deps);
const nrm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const parseMoney = (v: unknown) => { const s = String(v ?? "").replace(/[R$\s]/g, ""); const x = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s; return round2(Number(x) || 0); };
const parseDate = (v: unknown) => {
  const s = String(v ?? "").trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (br) { const y = br[3].length === 2 ? "20" + br[3] : br[3]; return new Date(`${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T${(br[4] || "12").padStart(2, "0")}:${br[5] || "00"}:00-03:00`).toISOString(); }
  const d = new Date(s); return isNaN(+d) ? null : d.toISOString();
};
const truthy = (v: unknown) => ["1", "sim", "s", "yes", "true", "y", "x"].includes(nrm(String(v ?? "")));

type WithId<T> = T & { id: string };
const now = (ctx: Ctx) => ctx.deps.now().toISOString();
const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const SEV: Record<Severity, number> = { verde: 0, amarelo: 1, vermelho: 2 };

/* ---------------- agentes ---------------- */
export async function ensureAgents(ctx: Ctx): Promise<AgentState[]> {
  const have = await A(ctx).list<WithId<AgentState>>("agents", ctx.tenantId, { limit: 50 });
  const out: AgentState[] = [];
  for (const a of AGENTS) {
    const cur = have.find((x) => x.code === a.code);
    if (cur) { out.push(cur); continue; }
    const st: AgentState = { id: a.code, code: a.code, enabled: true, mode: "regras", params: { ...DEFAULT_AGENT_PARAMS[a.code] }, credit: 0, explorationShare: a.code === "S" || a.code === "O" ? 0 : 1 / 7, health: "verde" };
    await A(ctx).put("agents", ctx.tenantId, st as never);
    out.push(st);
  }
  return out;
}
export async function agentParams(ctx: Ctx, code: AgentCode) {
  const a = await A(ctx).get<WithId<AgentState>>("agents", ctx.tenantId, code);
  return { ...DEFAULT_AGENT_PARAMS[code], ...(a?.params || {}) };
}

/* ---------------- achados e pedidos à marca (sem duplicar) ---------------- */
export async function upsertFinding(ctx: Ctx, f: Omit<Finding, "id" | "createdAt" | "status"> & { status?: Finding["status"] }) {
  const open = (await A(ctx).list<WithId<Finding>>("findings", ctx.tenantId, { where: { dedupeKey: f.dedupeKey }, limit: 5 })).find((x) => x.status === "aberto" || x.status === "em_teste");
  if (open) return (await A(ctx).patch<WithId<Finding>>("findings", ctx.tenantId, open.id, { ...f, status: open.status, updatedAt: now(ctx) }))!;
  const doc: Finding = { id: uid("fnd"), status: "aberto", createdAt: now(ctx), ...f };
  await A(ctx).put("findings", ctx.tenantId, doc as never);
  return doc;
}
export async function upsertRequest(ctx: Ctx, r: Omit<DataRequest, "id" | "createdAt" | "status">) {
  const open = (await A(ctx).list<WithId<DataRequest>>("data_requests", ctx.tenantId, { where: { dedupeKey: r.dedupeKey }, limit: 5 })).find((x) => x.status === "aberto" || x.status === "enviado");
  if (open) return (await A(ctx).patch<WithId<DataRequest>>("data_requests", ctx.tenantId, open.id, r))!;
  const doc: DataRequest = { id: uid("req"), status: "aberto", createdAt: now(ctx), ...r };
  await A(ctx).put("data_requests", ctx.tenantId, doc as never);
  return doc;
}

/* ---------------- Agente S: SETUP ---------------- */
export async function startRun(ctx: Ctx, inventory: SetupRun["inventory"]) {
  await ensureAgents(ctx);
  const run: SetupRun = { id: uid("run"), status: "recebendo", inventory, createdAt: now(ctx) };
  await A(ctx).put("setup_runs", ctx.tenantId, run as never);
  return run;
}
async function getRun(ctx: Ctx, id: string) {
  const r = await A(ctx).get<WithId<SetupRun>>("setup_runs", ctx.tenantId, id);
  if (!r) throw new HttpError(404, "Rodada de SETUP não encontrada");
  return r;
}
const strip = ({ rows: _r, ...f }: SetupFile) => f;

/** Recebe qualquer relatório no campo livre: reconhece canal e tipo e sugere o mapeamento. Nada entra no histórico ainda. */
export async function addFile(ctx: Ctx, runId: string, bytes: Uint8Array, filename: string) {
  await getRun(ctx, runId);
  const { rows, headers } = parseFile(bytes, filename);
  if (!rows.length) throw new HttpError(422, "Arquivo sem linhas");
  if (rows.length > 200000) throw new HttpError(422, "Máximo de 200 mil linhas por arquivo");
  const ch = detectChannel(filename, headers), kd = detectKind(headers);
  const critiques: Critique[] = [];
  if (ch.channel === "outro") critiques.push({ checkup: "reconhecimento", severity: "amarelo", text: "Não identifiquei o canal deste arquivo — confirme de onde ele veio" });
  if (kd.kind === "desconhecido") critiques.push({ checkup: "reconhecimento", severity: "amarelo", text: "Não reconheci o tipo do arquivo pelas colunas — confirme o que ele contém" });
  const f: SetupFile = { id: uid("sfl"), runId, filename, size: bytes.length, channel: ch.channel, kind: kd.kind, confidence: Math.min(ch.confidence, kd.confidence), headers, mapping: suggestSalesMapping(headers), preview: rows.slice(0, 8), status: "classificado", critiques, rows, createdAt: now(ctx) };
  await A(ctx).put("setup_files", ctx.tenantId, f as never);
  if (critiques.length) await upsertRequest(ctx, { runId, origin: "S", title: `Confirmar canal e tipo de "${filename}"`, detail: critiques.map((c) => c.text).join(". "), impact: 30, dedupeKey: `S:reconhecimento:${f.id}` });
  return strip(f);
}

async function catalog(ctx: Ctx): Promise<CatalogEntry[]> {
  const [items, groups] = await Promise.all([ctx.deps.db.list<WithId<Item>>("items", ctx.tenantId), ctx.deps.db.list<WithId<OptionGroup>>("option_groups", ctx.tenantId)]);
  const seen = new Set<string>(); const out: CatalogEntry[] = [];
  const add = (id: string, name: string) => { const k = itemTokens(name).sort().join(" "); if (!k || seen.has(k)) return; seen.add(k); out.push({ id, name }); };
  for (const i of items) if (i.active) add(i.id, i.name);
  // sabores e complementos (ex.: meio a meio) também são vendidos pelo nome
  for (const g of groups) for (const o of g.options) if (o.active) add(`opt:${g.id}:${o.id}`, o.name);
  return out;
}

const keyOf = (phone?: string, email?: string) => {
  const raw = phone ? "t" + phone : email ? "e" + email.toLowerCase().trim() : "";
  if (!raw) return undefined;
  let h = 2166136261; for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
  return "ck_" + (h >>> 0).toString(36); // pseudônimo estável: o telefone em si não entra no histórico
};
const isCancel = (v: unknown) => /cancel|estorn|recus/.test(String(v ?? "").toLowerCase());
const qtyOf = (v: unknown) => { const n = Number(String(v ?? "1").replace(",", ".")); return isFinite(n) && n > 0 ? n : 1; };

/**
 * Aproveita o arquivo: grava as linhas no histórico de vendas, unifica clientes dos canais próprios,
 * casa os itens com o cardápio e roda as críticas do Agente S (coerência, duplicados, cancelados, lacunas, casamento).
 */
export async function ingestFile(ctx: Ctx, fileId: string, opts: { mapping?: Record<string, string>; channel?: Channel; kind?: FileKind } = {}) {
  const f = await A(ctx).get<WithId<SetupFile>>("setup_files", ctx.tenantId, fileId);
  if (!f) throw new HttpError(404, "Arquivo não encontrado");
  if (!f.rows?.length) throw new HttpError(409, "Arquivo já processado ou sem linhas");
  const mapping = opts.mapping || f.mapping, channel = opts.channel || f.channel, kind = opts.kind || f.kind;
  const get = (r: Record<string, unknown>, k: string) => (mapping[k] ? r[mapping[k]] : undefined);
  const S = await agentParams(ctx, "S");
  const critiques: Critique[] = [];

  if (kind === "clientes") return ingestCustomers(ctx, f, mapping, channel);
  if (kind !== "pedidos_itens" && kind !== "vendas_item") {
    await A(ctx).patch("setup_files", ctx.tenantId, f.id, { channel, kind, mapping, critiques: [...f.critiques, { checkup: "reconhecimento", severity: "verde", text: "Guardado como referência; este tipo ainda não alimenta o histórico de vendas" }] });
    return { file: f.id, used: 0 };
  }
  if (!mapping.item) throw new HttpError(422, "Mapeie a coluna do item/produto");
  if (kind === "pedidos_itens" && (!mapping.orderId || !mapping.orderedAt)) throw new HttpError(422, "Mapeie o ID do pedido e a data/hora");

  const cat = await catalog(ctx); const cache = new Map<string, ReturnType<typeof matchItem>>();
  const marketplace = MARKETPLACES.includes(channel);
  const seen = new Set<string>(); let duplicates = 0, cancelled = 0, discarded = 0;
  const lines: SalesLineRow[] = []; const custCache = new Map<string, string>();
  const runDate = f.createdAt;

  for (const [i, r] of f.rows.entries()) {
    const raw = String(get(r, "item") ?? "").trim();
    if (!raw) { discarded++; continue; }
    const orderId = get(r, "orderId") != null && String(get(r, "orderId")).trim() !== "" ? String(get(r, "orderId")).trim() : undefined;
    const qty = qtyOf(get(r, "qty"));
    const unitPrice = mapping.unitPrice ? parseMoney(get(r, "unitPrice")) : undefined;
    const lineTotal = mapping.lineTotal ? parseMoney(get(r, "lineTotal")) : unitPrice != null ? r2(unitPrice * qty) : undefined;
    const dupKey = `${orderId ?? i}|${raw.toLowerCase()}|${qty}|${unitPrice ?? lineTotal}`;
    if (kind === "pedidos_itens" && seen.has(dupKey)) { duplicates++; continue; }
    seen.add(dupKey);
    const orderedAt = parseDate(get(r, kind === "vendas_item" ? (mapping.periodTo ? "periodTo" : "orderedAt") : "orderedAt")) || (kind === "vendas_item" ? runDate : null);
    if (!orderedAt) { discarded++; continue; }
    const status = isCancel(get(r, "status")) ? "cancelado" : "concluido";
    if (status === "cancelado") cancelled++;
    let m = cache.get(raw.toLowerCase());
    if (!m) { m = matchItem(raw, cat, Number(S.matchAuto), Number(S.matchSuggest)); cache.set(raw.toLowerCase(), m); }
    const phone = normPhone(String(get(r, "phone") ?? "")), email = String(get(r, "email") ?? "").trim() || undefined;
    const ext = get(r, "customerId") ? String(get(r, "customerId")) : undefined;
    const customerKey = keyOf(phone, email) || (ext ? keyOf(undefined, `${channel}:${ext}`) : undefined);
    let customerId: string | undefined;
    if (!marketplace && (phone || email) && customerKey) {
      customerId = custCache.get(customerKey);
      if (!customerId) {
        const byEmail = !phone && email ? (await ctx.deps.db.list<WithId<Customer>>("customers", ctx.tenantId, { where: { email: email.toLowerCase() }, limit: 1 }))[0] : undefined;
        customerId = byEmail?.id || (await upsertCustomer(ctx, { phone, email, source: channel })).id;
        custCache.set(customerKey, customerId);
      }
    }
    lines.push({
      id: `sl_${f.id}_${i}`, fileId: f.id, channel, isAggregate: kind === "vendas_item", externalOrderId: kind === "pedidos_itens" ? orderId : undefined,
      orderedAt, periodFrom: kind === "vendas_item" && mapping.orderedAt && mapping.periodTo ? parseDate(get(r, "orderedAt")) ?? undefined : undefined,
      customerKey, customerId, itemRaw: raw, itemId: m.status === "auto" ? m.id : undefined, qty, unitPrice, lineTotal,
      discount: mapping.discount ? parseMoney(get(r, "discount")) : undefined, orderTotal: mapping.orderTotal ? parseMoney(get(r, "orderTotal")) : undefined,
      deliveryFee: mapping.deliveryFee ? parseMoney(get(r, "deliveryFee")) : undefined, status,
      district: get(r, "district") ? String(get(r, "district")) : undefined, postalCode: get(r, "postalCode") ? String(get(r, "postalCode")).replace(/\D/g, "") : undefined,
    });
  }
  await A(ctx).sales.insert(ctx.tenantId, lines);

  /* ---- críticas do Agente S ---- */
  const valid = lines.filter((l) => l.status === "concluido");
  const revenue = (l: SalesLineRow) => l.lineTotal ?? (l.unitPrice ?? 0) * l.qty;
  const totalRev = valid.reduce((a, l) => a + revenue(l), 0);
  const matchedRev = valid.filter((l) => l.itemId).reduce((a, l) => a + revenue(l), 0);
  const matchedShare = totalRev ? matchedRev / totalRev : valid.length ? valid.filter((l) => l.itemId).length / valid.length : 0;

  // coerência: soma dos itens − desconto + taxa = total do pedido (tolerância 1%)
  let consistency = 1, ordersChecked = 0;
  if (kind === "pedidos_itens" && mapping.orderTotal) {
    const byOrder = new Map<string, SalesLineRow[]>();
    for (const l of valid) if (l.externalOrderId) (byOrder.get(l.externalOrderId) || byOrder.set(l.externalOrderId, []).get(l.externalOrderId)!).push(l);
    let ok = 0;
    for (const ls of byOrder.values()) {
      const tot = ls.find((l) => l.orderTotal != null)?.orderTotal; if (tot == null) continue; ordersChecked++;
      const sum = ls.reduce((a, l) => a + revenue(l) - (mapping.discount && l.discount ? l.discount : 0), 0) + (ls[0].deliveryFee ?? 0);
      if (Math.abs(sum - tot) <= Math.max(0.05, tot * 0.01)) ok++;
    }
    consistency = ordersChecked ? ok / ordersChecked : 1;
    if (ordersChecked && consistency < Number(S.minConsistency)) critiques.push({ checkup: "coerencia", severity: consistency < 0.9 ? "vermelho" : "amarelo", text: `${pct(ordersChecked - ok, ordersChecked)}% dos pedidos têm total que não fecha com a soma dos itens`, value: pct(ordersChecked - ok, ordersChecked) });
  }
  if (duplicates) critiques.push({ checkup: "duplicados", severity: "verde", text: `${duplicates} linhas repetidas removidas`, value: duplicates });
  if (cancelled) critiques.push({ checkup: "cancelados", severity: "verde", text: `${cancelled} linhas canceladas separadas (não contam como venda)`, value: cancelled });
  if (discarded) critiques.push({ checkup: "aproveitamento", severity: discarded / f.rows.length > 0.05 ? "amarelo" : "verde", text: `${discarded} linhas sem item ou sem data descartadas`, value: discarded });

  // lacunas: mais de 7 dias seguidos sem pedido dentro do período
  const days = [...new Set(valid.filter((l) => !l.isAggregate).map((l) => l.orderedAt.slice(0, 10)))].sort();
  let gap = 0;
  for (let k = 1; k < days.length; k++) gap = Math.max(gap, (+new Date(days[k]) - +new Date(days[k - 1])) / 864e5 - 1);
  if (gap > 7) critiques.push({ checkup: "lacunas", severity: "amarelo", text: `Há um intervalo de ${gap} dias sem nenhum pedido — loja fechada ou dado faltando?`, value: gap });

  // casamento de itens: o que não casou vira pedido à marca, priorizado pela receita
  const unmatched = new Map<string, { raw: string; rev: number; status: string; cands: string[] }>();
  for (const l of valid) if (!l.itemId) { const m = cache.get(l.itemRaw.toLowerCase())!; const u = unmatched.get(l.itemRaw.toLowerCase()) || { raw: l.itemRaw, rev: 0, status: m.status, cands: m.candidates.map((c) => c.name) }; u.rev += revenue(l); unmatched.set(l.itemRaw.toLowerCase(), u); }
  const top = [...unmatched.values()].sort((a, b) => b.rev - a.rev);
  if (top.length) {
    critiques.push({ checkup: "casamento", severity: matchedShare < Number(S.minCoverage) ? "amarelo" : "verde", text: `${pct(matchedRev, totalRev)}% da receita casou com o cardápio; ${top.length} nomes precisam de confirmação`, value: pct(matchedRev, totalRev) });
    await upsertRequest(ctx, { runId: f.runId, origin: "S", title: `Confirmar ${Math.min(top.length, 20)} itens de "${f.filename}" que não casaram com o cardápio`, detail: "Começando pelos que mais vendem. Para cada um, diga a qual item do cardápio corresponde (ou se saiu de linha).", impact: Math.round(Math.min(100, (1 - matchedShare) * 100)), items: top.slice(0, 20).map((u) => ({ label: u.cands.length ? `${u.raw} → ${u.cands[0]}?` : u.raw, value: r2(u.rev) })), dedupeKey: `S:casamento:${f.id}` });
  }
  for (const c of critiques.filter((c) => c.severity !== "verde")) await upsertFinding(ctx, { agent: "S", checkup: c.checkup, severity: c.severity, evidence: { text: c.text, value: c.value }, proposal: c.checkup === "coerencia" ? "Pedir reenvio só do trecho com total divergente" : c.checkup === "lacunas" ? "Confirmar com a marca e marcar o período como atípico" : "Pedir confirmação à marca", actionType: "automatica", dedupeKey: `S:${c.checkup}:${f.id}` });

  const ts = lines.map((l) => l.orderedAt).sort();
  const stats = { rows: f.rows.length, used: lines.length, discarded, cancelled, duplicates, matchedShare: Math.round(matchedShare * 1000) / 1000, consistency: Math.round(consistency * 1000) / 1000, ordersChecked, periodFrom: ts[0], periodTo: ts[ts.length - 1] };
  await A(ctx).patch("setup_files", ctx.tenantId, f.id, { channel, kind, mapping, status: "aproveitado", critiques: [...f.critiques.filter((c) => c.checkup !== "reconhecimento"), ...critiques], stats, rows: [] });
  const ladder = await recomputeLadder(ctx, f.runId);
  return { file: f.id, ...stats, critiques, ladder };
}

async function ingestCustomers(ctx: Ctx, f: WithId<SetupFile>, mapping: Record<string, string>, channel: Channel) {
  const get = (r: Record<string, unknown>, k: string) => (mapping[k] ? r[mapping[k]] : undefined);
  const marketplace = MARKETPLACES.includes(channel);
  let used = 0, discarded = 0, withOptin = 0;
  const optinCol = f.headers.find((h) => /opt.?in|aceita|whats.*(sim|nao)/i.test(h));
  if (!marketplace) for (const r of f.rows || []) {
    const phone = normPhone(String(get(r, "phone") ?? "")), email = String(get(r, "email") ?? "").trim() || undefined;
    if (!phone && !email) { discarded++; continue; }
    const optin = optinCol ? truthy(r[optinCol]) : undefined; if (optin) withOptin++;
    await upsertCustomer(ctx, { phone, email, source: channel, district: get(r, "district") ? String(get(r, "district")) : undefined, optinWhatsapp: optin } as never);
    used++;
  }
  const critiques: Critique[] = [];
  if (marketplace) critiques.push({ checkup: "consentimento", severity: "verde", text: "Contatos de marketplace não viram contato de CRM; o arquivo serve só como referência agregada" });
  else if (!optinCol) critiques.push({ checkup: "consentimento", severity: "amarelo", text: "Base sem coluna de opt-in: os contatos alimentam o modelo, mas não recebem mensagem até aceitarem no checkout" });
  for (const c of critiques.filter((c) => c.severity !== "verde")) await upsertFinding(ctx, { agent: "S", checkup: c.checkup, severity: c.severity, evidence: { text: c.text }, proposal: "Coletar opt-in no checkout do Superapp", actionType: "automatica", dedupeKey: `S:${c.checkup}:${f.id}` });
  const stats = { rows: f.rows?.length || 0, used, discarded, cancelled: 0, duplicates: 0, matchedShare: 0, withOptin };
  await A(ctx).patch("setup_files", ctx.tenantId, f.id, { channel, kind: "clientes", mapping, status: "aproveitado", critiques, stats, rows: [] });
  return { file: f.id, ...stats, critiques, ladder: await recomputeLadder(ctx, f.runId) };
}

/** Recalcula o degrau com o histórico importado + os pedidos que o próprio Superapp já gerou. */
export async function recomputeLadder(ctx: Ctx, runId?: string): Promise<Ladder> {
  const db = ctx.deps.db; const adb = A(ctx); const T = ctx.tenantId;
  const [stats, totals, items, files, own] = await Promise.all([
    adb.sales.stats(T), adb.sales.itemTotals(T), db.list<WithId<Item>>("items", T),
    adb.list<WithId<SetupFile & { stats?: { consistency?: number; ordersChecked?: number } }>>("setup_files", T, { limit: 500 }),
    db.list<WithId<Order & { imported?: boolean }>>("orders", T, { limit: 100000 }),
  ]);
  const costs = new Map((await adb.list<{ id: string; cost: number }>("item_costs", T, { limit: 10000 })).map((c) => [c.id, c.cost]));
  const ownOrders = own.filter((o) => !o.imported && o.status !== "cancelled" && o.lines?.length);
  const ordersWithItems = stats.orders + ownOrders.length;
  const identified = stats.identifiedOrders + ownOrders.filter((o) => o.customerId).length;
  const firsts = [stats.first, ...ownOrders.map((o) => o.createdAt)].filter(Boolean).sort() as string[];
  const lasts = [stats.last, ...ownOrders.map((o) => o.createdAt)].filter(Boolean).sort() as string[];
  const periodDays = firsts.length ? Math.round((+new Date(lasts[lasts.length - 1]) - +new Date(firsts[0])) / 864e5) : 0;
  const rev = totals.reduce((a, t) => a + t.revenue, 0), matched = totals.filter((t) => t.itemId).reduce((a, t) => a + t.revenue, 0);
  const coverage = rev ? matched / rev : ownOrders.length ? 1 : 0;
  const checked = files.filter((f) => f.stats?.ordersChecked);
  const consistency = checked.length ? checked.reduce((a, f) => a + (f.stats!.consistency ?? 1) * f.stats!.ordersChecked!, 0) / checked.reduce((a, f) => a + f.stats!.ordersChecked!, 0) : 1;
  const active = items.filter((i) => i.active);
  const ladder = computeLadder({
    pricedItems: active.filter((i) => i.price > 0).length, aggregateLines: stats.aggregateLines, ordersWithItems,
    identifiedShare: ordersWithItems ? identified / ordersWithItems : 0, periodDays, coverage, consistency,
    costCoverage: active.length ? active.filter((i) => (costs.get(i.id) ?? 0) > 0).length / active.length : 0, ownOrders: ownOrders.length,
  }, await agentParams(ctx, "S"));
  ladder.computedAt = now(ctx);
  const run = runId ? await adb.get<WithId<SetupRun>>("setup_runs", T, runId) : (await adb.list<WithId<SetupRun>>("setup_runs", T, { limit: 1 }))[0];
  if (run) await adb.patch("setup_runs", T, run.id, { ladder, status: run.status === "liberado" ? "liberado" : "pronto" });
  return ladder;
}

/** Dossiê de importação + decisão pendente de liberação (o lançamento sempre passa por um humano). */
export async function buildDossier(ctx: Ctx, runId: string) {
  const run = await getRun(ctx, runId);
  const ladder = await recomputeLadder(ctx, runId);
  const files = await A(ctx).list<WithId<SetupFile & { stats?: { used: number; rows: number } }>>("setup_files", ctx.tenantId, { where: { runId }, limit: 500 });
  const reqs = (await A(ctx).list<WithId<DataRequest>>("data_requests", ctx.tenantId, { limit: 500 })).filter((r) => r.status === "aberto" || r.status === "enviado").sort((a, b) => b.impact - a.impact);
  const dossier: Dossier = {
    sources: files.map((f) => ({ file: f.filename, channel: f.channel, kind: f.kind, status: f.status, used: f.stats?.used ?? 0, rows: f.stats?.rows ?? f.preview.length })),
    critiques: files.flatMap((f) => f.critiques), ladder, pending: reqs.map((r) => ({ title: r.title, impact: r.impact })), generatedAt: now(ctx),
  };
  await A(ctx).patch("setup_runs", ctx.tenantId, run.id, { dossier, status: "pronto" });
  const pend = (await A(ctx).list<WithId<Decision>>("decisions", ctx.tenantId, { where: { runId, kind: "liberar_lancamento" }, limit: 5 })).find((d) => d.status === "pendente");
  const decision: Decision = pend || { id: uid("dec"), kind: "liberar_lancamento", agent: "S", title: `Liberar lançamento no degrau ${ladder.step}`, evidence: ladder.next ? `Próximo passo para subir: ${ladder.next}` : "Todos os portões verdes", runId, requiresApproval: true, status: "pendente", createdAt: now(ctx) };
  if (!pend) await A(ctx).put("decisions", ctx.tenantId, decision as never);
  return { dossier, decision };
}

/* ---------------- decisões do orquestrador ---------------- */
export async function decide(ctx: Ctx, id: string, approve: boolean, by: string) {
  const d = await A(ctx).get<WithId<Decision>>("decisions", ctx.tenantId, id);
  if (!d) throw new HttpError(404, "Decisão não encontrada");
  if (d.status !== "pendente") throw new HttpError(409, "Decisão já tomada");
  const at = now(ctx);
  const status = approve ? (d.kind === "liberar_lancamento" || d.kind === "aplicar" || d.kind === "reverter" ? "aplicada" : "aprovada") : "recusada";
  const out = await A(ctx).patch<WithId<Decision>>("decisions", ctx.tenantId, id, { status, decidedBy: by, decidedAt: at });
  if (approve && d.kind === "liberar_lancamento" && d.runId) await A(ctx).patch("setup_runs", ctx.tenantId, d.runId, { status: "liberado", releasedAt: at, releasedBy: by });
  if (d.experimentId) await A(ctx).patch("experiments", ctx.tenantId, d.experimentId, { status: approve ? (d.kind === "reverter" ? "revertido" : "encerrado") : "rodando", endedAt: approve ? at : undefined });
  if (d.findingId && approve) await A(ctx).patch("findings", ctx.tenantId, d.findingId, { status: "resolvido", updatedAt: at });
  return out;
}

/* ---------------- Agente G: testes ---------------- */
export async function createExperiment(ctx: Ctx, e: Pick<Experiment, "agent" | "lever" | "hypothesis" | "arms"> & Partial<Pick<Experiment, "leak" | "unit" | "metric" | "findingId">>) {
  if (!LEVERS[e.lever]) throw new HttpError(422, "Alavanca inválida");
  if (!LEVERS[e.lever].owners.includes(e.agent)) throw new HttpError(422, `O agente ${e.agent} não é dono da alavanca ${e.lever}`);
  if (e.arms.length < 2) throw new HttpError(422, "Um teste precisa de pelo menos 2 braços");
  const arms = e.arms.some((a) => a.control) ? e.arms : e.arms.map((a, i) => ({ ...a, control: i === 0 }));
  const running = (await A(ctx).list<WithId<Experiment>>("experiments", ctx.tenantId, { where: { status: "rodando" }, limit: 200 })).find((x) => x.lever === e.lever);
  if (running) throw new HttpError(409, `Já existe um teste rodando nesta alavanca (${running.id}); ele entra na fila`);
  const exp: Experiment = { id: uid("exp"), unit: "sessao", metric: "conversao_intencao", status: "rodando", startedAt: now(ctx), createdAt: now(ctx), ...e, arms };
  await A(ctx).put("experiments", ctx.tenantId, exp as never);
  if (e.findingId) await A(ctx).patch("findings", ctx.tenantId, e.findingId, { status: "em_teste", experimentId: exp.id });
  return exp;
}

async function sessionsSince(ctx: Ctx, since: string, until?: string) {
  const [events, customers] = await Promise.all([ctx.deps.db.events.list(ctx.tenantId, { since, until }), ctx.deps.db.list<WithId<Customer>>("customers", ctx.tenantId, { limit: 200000 })]);
  const first = new Map(customers.map((c) => [c.id, c.firstOrderAt]));
  const segmentOf = (s: { customerId?: string; start: string }): Cohort => { const f = s.customerId ? first.get(s.customerId) : undefined; return f && f < s.start ? "recorrente" : "novato"; };
  return sessionOutcomes(events, segmentOf);
}

export async function experimentStats(ctx: Ctx, id: string) {
  const e = await A(ctx).get<WithId<Experiment>>("experiments", ctx.tenantId, id);
  if (!e) throw new HttpError(404, "Teste não encontrado");
  const asg = await A(ctx).assignments.list(ctx.tenantId, id);
  const sess = new Map((await sessionsSince(ctx, e.startedAt || e.createdAt)).map((s) => [s.sessionId, s]));
  const stats: ArmStat[] = e.arms.map((a) => {
    const units = asg.filter((x) => x.arm === a.id).map((x) => sess.get(x.unitId)).filter(Boolean) as ReturnType<typeof sessionOutcomes>;
    const pool = e.metric === "conversao_intencao" ? units.filter((u) => u.intent) : units;
    return { arm: a.id, trials: pool.length, successes: pool.filter((u) => (e.metric === "abertura_item" ? u.exit !== "chegada" && u.exit !== "navegacao" : u.converted)).length, control: a.control };
  });
  return { experiment: e, stats, probBest: stats.some((s) => s.trials) ? probBest(stats) : {} };
}

/** Sorteia (uma vez) o braço da sessão/cliente: o controle tem fatia fixa, os demais disputam por Thompson sampling. */
export async function assignArm(ctx: Ctx, id: string, unitId: string) {
  const e = await A(ctx).get<WithId<Experiment>>("experiments", ctx.tenantId, id);
  if (!e) throw new HttpError(404, "Teste não encontrado");
  if (e.status !== "rodando") return { arm: e.winnerArm || e.arms.find((a) => a.control)!.id, config: (e.arms.find((a) => a.id === e.winnerArm) || e.arms.find((a) => a.control))!.config, live: false };
  const prev = (await A(ctx).assignments.list(ctx.tenantId, id)).find((a) => a.unitId === unitId);
  const arm = prev?.arm || pickArm((await experimentStats(ctx, id)).stats, Number((await agentParams(ctx, "G")).controlShare));
  const row = await A(ctx).assignments.assign(ctx.tenantId, { experimentId: id, unitId, arm, ts: now(ctx) });
  return { arm: row.arm, config: e.arms.find((a) => a.id === row.arm)!.config, live: true };
}

/* ---------------- ciclo vivo ---------------- */
const dayIso = (d: Date) => d.toISOString().slice(0, 10);

/** Evasão líquida, vazamentos e recompra de um período, separados por perfil. */
export async function evasionReport(ctx: Ctx, from: string, to: string) {
  const sessions = await sessionsSince(ctx, from, to);
  const orders = await ctx.deps.db.list<WithId<Order>>("orders", ctx.tenantId, { since: from, limit: 100000 });
  markRecovered(sessions, orders.filter((o) => o.status !== "cancelled"), 24);
  const F = await agentParams(ctx, "F");
  const customers = await ctx.deps.db.list<WithId<Customer>>("customers", ctx.tenantId, { limit: 200000 });
  // não volta a pedir: fez o 1º pedido no período, já passou a janela do 2º pedido e não voltou
  const windowMs = Math.max(Number(F.secondOrderHours) * 3600e3, 7 * 864e5);
  const recompraLost = customers.filter((c) => c.orders === 1 && c.firstOrderAt && c.firstOrderAt >= from && c.firstOrderAt <= to && +new Date(to) - +new Date(c.firstOrderAt) > windowMs).length;
  return { todos: evasion(sessions, "todos", recompraLost), novato: evasion(sessions, "novato", recompraLost), recorrente: evasion(sessions, "recorrente", 0) };
}

/**
 * Uma volta do ciclo (rodar 1x por dia pelo /cron/tick ou pelo painel):
 * mede o dia, grava as métricas, redistribui a exploração para o maior vazamento,
 * abre achados para os donos, decide testes maduros e arma o disjuntor.
 */
export async function runCycle(ctx: Ctx, day?: string) {
  const d = day || dayIso(new Date(+ctx.deps.now() - 864e5));
  const from = `${d}T00:00:00.000Z`, to = `${d}T23:59:59.999Z`;
  await ensureAgents(ctx);
  const rep = await evasionReport(ctx, from, to);
  const rows = (["todos", "novato", "recorrente"] as const).flatMap((seg) => {
    const r = rep[seg];
    return [
      { day: d, metric: "evasao_liquida", segment: seg, dim: "", value: r.netEvasion },
      { day: d, metric: "sessoes", segment: seg, dim: "", value: r.sessions },
      { day: d, metric: "sessoes_intencao", segment: seg, dim: "", value: r.intentSessions },
      { day: d, metric: "pedidos_na_sessao", segment: seg, dim: "", value: r.converted },
      { day: d, metric: "recuperados_24h", segment: seg, dim: "", value: r.recovered },
      ...r.leaks.map((l) => ({ day: d, metric: "vazamento", segment: seg, dim: l.key, value: l.lost })),
    ];
  });
  await A(ctx).metrics.upsert(ctx.tenantId, rows);

  // autoajuste 1: maior vazamento → maior fatia de testes (janela de 7 dias)
  const weekFrom = new Date(+new Date(to) - 7 * 864e5).toISOString();
  const week = await evasionReport(ctx, weekFrom, to);
  const pr = prioritizeLeaks(week.todos);
  for (const [code, share] of Object.entries(pr.explorationShare)) await A(ctx).patch("agents", ctx.tenantId, code, { explorationShare: Math.round((share || 0) * 1000) / 1000, lastRunAt: now(ctx) });
  const biggest = week.todos.leaks.find((l) => l.key === pr.order[0]);
  if (biggest && biggest.lost > 0) await upsertFinding(ctx, { agent: biggest.owners[0], checkup: "maior_vazamento", severity: "amarelo", leak: biggest.key, evidence: { text: `${biggest.lost} pessoas saíram em "${biggest.label}" nos últimos 7 dias (${biggest.share}% das saídas)`, value: biggest.lost }, proposal: "Abrir teste numa alavanca deste ponto de saída", actionType: "automatica", dedupeKey: `O:maior_vazamento:${biggest.key}` });

  // testes maduros: vencedor com ≥95% de chance e amostra mínima → decisão
  const G = await agentParams(ctx, "G"); const decided: string[] = [];
  for (const e of await A(ctx).list<WithId<Experiment>>("experiments", ctx.tenantId, { where: { status: "rodando" }, limit: 200 })) {
    const { stats, probBest: pb } = await experimentStats(ctx, e.id);
    const best = Object.entries(pb).sort((a, b) => b[1] - a[1])[0];
    const control = stats.find((s) => s.control);
    if (!best || !stats.every((s) => s.trials >= Number(G.minTrialsPerArm)) || best[1] < 0.95 || best[0] === control?.arm) continue;
    await A(ctx).patch("experiments", ctx.tenantId, e.id, { status: "vencedor", winnerArm: best[0] });
    const s = stats.find((x) => x.arm === best[0])!, c = control!;
    const gain = s.trials && c.trials ? s.successes / s.trials - c.successes / c.trials : 0;
    await A(ctx).put("decisions", ctx.tenantId, { id: uid("dec"), kind: "aplicar", agent: e.agent, title: `Aplicar "${e.arms.find((a) => a.id === best[0])!.name}" (${LEVERS[e.lever].label})`, evidence: `${Math.round(best[1] * 100)}% de chance de ser o melhor; +${Math.round(gain * 1000) / 10} p.p. sobre o controle`, experimentId: e.id, findingId: e.findingId, requiresApproval: LEVERS[e.lever].approval, status: LEVERS[e.lever].approval ? "pendente" : "aplicada", createdAt: now(ctx) } as never);
    const a = await A(ctx).get<WithId<AgentState>>("agents", ctx.tenantId, e.agent);
    if (a) await A(ctx).patch("agents", ctx.tenantId, e.agent, { credit: r2((a.credit || 0) + gain * s.trials) });
    decided.push(e.id);
  }

  // disjuntor: evasão líquida acima da média dos 28 dias anteriores por N dias seguidos
  const O = await agentParams(ctx, "O"); const n = Number(O.breakerDays);
  const hist = await A(ctx).metrics.list(ctx.tenantId, { metric: "evasao_liquida", segment: "todos", from: dayIso(new Date(+new Date(from) - 35 * 864e5)), to: d });
  const lastN = hist.slice(-n), base = hist.slice(0, -n).slice(-28);
  const avg = base.length ? base.reduce((a, m) => a + m.value, 0) / base.length : undefined;
  let breaker = false;
  if (avg != null && base.length >= 7 && lastN.length === n && lastN.every((m) => m.value > avg * 1.1)) {
    breaker = true;
    const top = Object.entries(pr.explorationShare).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0]?.[0] as AgentCode | undefined;
    await upsertFinding(ctx, { agent: "O", checkup: "disjuntor", severity: "vermelho", evidence: { text: `Evasão líquida acima da linha de base há ${n} dias (média recente ${Math.round(avg * 10) / 10}%)` }, proposal: `Voltar as ações automáticas do agente ${top ?? "responsável"} à última versão estável`, actionType: "aprovacao", dedupeKey: "O:disjuntor" });
  }

  // saúde dos agentes = pior achado aberto
  const open = (await A(ctx).list<WithId<Finding>>("findings", ctx.tenantId, { limit: 2000 })).filter((f) => f.status === "aberto" || f.status === "em_teste");
  for (const a of AGENTS) { const w = open.filter((f) => f.agent === a.code).reduce<Severity>((m, f) => (SEV[f.severity] > SEV[m] ? f.severity : m), "verde"); await A(ctx).patch("agents", ctx.tenantId, a.code, { health: w }); }

  return { day: d, evasion: rep.todos.netEvasion, priority: pr.order, decided, breaker };
}

/** Tudo que o cockpit mostra, nos cinco blocos do plano. */
export async function cockpit(ctx: Ctx, from: string, to: string) {
  const db = ctx.deps.db; const adb = A(ctx); const T = ctx.tenantId;
  const agents = await ensureAgents(ctx);
  const [rep, series, findings, decisions, experiments, runs] = await Promise.all([
    evasionReport(ctx, from, to),
    adb.metrics.list(T, { metric: "evasao_liquida", from: from.slice(0, 10), to: to.slice(0, 10) }),
    adb.list<WithId<Finding>>("findings", T, { limit: 2000 }),
    adb.list<WithId<Decision>>("decisions", T, { where: { status: "pendente" }, limit: 200 }),
    adb.list<WithId<Experiment>>("experiments", T, { where: { status: "rodando" }, limit: 200 }),
    adb.list<WithId<SetupRun>>("setup_runs", T, { limit: 1 }),
  ]);
  const open = findings.filter((f) => f.status === "aberto" || f.status === "em_teste");
  return {
    evasion: { ...rep, series },
    leaks: { leaks: rep.todos.leaks, priority: prioritizeLeaks(rep.todos).order },
    agents: agents.map((a) => ({ ...a, info: AGENTS.find((x) => x.code === a.code), openFindings: open.filter((f) => f.agent === a.code).length })),
    approvals: decisions,
    experiments: await Promise.all(experiments.map(async (e) => { const s = await experimentStats(ctx, e.id); return { id: e.id, agent: e.agent, lever: e.lever, hypothesis: e.hypothesis, startedAt: e.startedAt, stats: s.stats, probBest: s.probBest }; })),
    ladder: runs[0]?.ladder ?? (await recomputeLadder(ctx)),
    setup: runs[0] ? { id: runs[0].id, status: runs[0].status } : null,
  };
}

/** Chamado pelo /cron/tick: roda a volta do dia anterior uma única vez. */
export async function maybeRunCycle(ctx: Ctx) {
  const d = dayIso(new Date(+ctx.deps.now() - 864e5));
  const done = await A(ctx).metrics.list(ctx.tenantId, { metric: "evasao_liquida", segment: "todos", from: d, to: d });
  if (done.length) return { day: d, skipped: true };
  return runCycle(ctx, d);
}

/** Custo (CMV) por item, guardado no banco do algoritmo — o cadastro do cardápio não muda. */
export async function setItemCosts(ctx: Ctx, costs: { itemId: string; cost: number }[]) {
  const items = new Set((await ctx.deps.db.list<WithId<Item>>("items", ctx.tenantId)).map((i) => i.id));
  const bad = costs.filter((c) => !items.has(c.itemId)).map((c) => c.itemId);
  if (bad.length) throw new HttpError(422, "Itens não encontrados no cardápio", bad);
  for (const c of costs) await A(ctx).put("item_costs", ctx.tenantId, { id: c.itemId, cost: r2(c.cost), updatedAt: now(ctx) } as never);
  return { saved: costs.length, ladder: await recomputeLadder(ctx) };
}
export const itemCosts = (ctx: Ctx) => A(ctx).list<{ id: string; cost: number }>("item_costs", ctx.tenantId, { limit: 10000 });
