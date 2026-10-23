import { Hono } from "hono";
import { z } from "zod";
import type { Item, Order, OptionGroup, Store } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { changeStatus, sendToPos } from "../services/orders";
import { createImport, commitImport, FIELDS, type ImportKind } from "../services/imports";
import { saiposConfig } from "../services/integrations";
import { saiposConfigSchema } from "../schemas";
import { SaiposClient } from "../integrations/saipos/client";
import { groupCatalog, suggestMapping } from "../integrations/saipos/catalog";
import { SaiposError } from "../integrations/saipos/types";

type O = Order & { id: string };

export function opsRoutes() {
  const r = new Hono<Env>();

  /* ---------- pedidos ---------- */
  r.get("/orders", async (c) => {
    const st = c.req.query("status");
    const rows = await c.get("deps").db.list<O>("orders", c.get("tenantId"), { where: st ? { status: st } : undefined, limit: Number(c.req.query("limit") || 100) });
    return c.json(rows.filter((o) => !(o as unknown as { imported?: boolean }).imported || c.req.query("imported") === "1"));
  });
  r.get("/orders/:id", async (c) => { const o = await c.get("deps").db.get<O>("orders", c.get("tenantId"), c.req.param("id")); if (!o) throw new HttpError(404, "Pedido não encontrado"); return c.json(o); });
  r.post("/orders/:id/status", async (c) => {
    const i = await body(c, z.object({ status: z.enum(["confirmed", "ready", "dispatched", "concluded", "cancelled"]), note: z.string().optional() }));
    return c.json(await changeStatus(ctxOf(c), c.req.param("id"), i.status, c.get("admin")!.sub, i.note));
  });
  r.post("/orders/:id/send-pos", async (c) => c.json(await sendToPos(ctxOf(c), c.req.param("id"))));

  /* ---------- importação de bases ---------- */
  r.get("/imports/fields", (c) => c.json(FIELDS));
  r.get("/imports", async (c) => c.json((await c.get("deps").db.list<{ id: string; rows?: unknown }>("imports", c.get("tenantId"), { limit: 50 })).map(({ rows: _r, ...x }) => x)));
  r.post("/imports", async (c) => {
    const form = await c.req.formData(); const f = form.get("file"); const kind = String(form.get("kind") || "customers") as ImportKind;
    if (!(f instanceof File)) throw new HttpError(400, "Envie o arquivo no campo file");
    if (!["customers", "orders"].includes(kind)) throw new HttpError(400, "Tipo inválido");
    if (f.size > 25e6) throw new HttpError(413, "Arquivo acima de 25 MB");
    return c.json(await createImport(ctxOf(c), kind, new Uint8Array(await f.arrayBuffer()), f.name), 201);
  });
  r.post("/imports/:id/commit", async (c) => {
    const i = await body(c, z.object({ mapping: z.record(z.string()) }));
    return c.json(await commitImport(ctxOf(c), c.req.param("id"), i.mapping));
  });

  /* ---------- SAIPOS ---------- */
  const store = async (c: import("hono").Context<Env>) => { const s = await c.get("deps").db.get<Store & { id: string }>("stores", c.get("tenantId"), c.req.param("storeId")!); if (!s) throw new HttpError(404, "Loja não encontrada"); return s; };
  const hidden = (cfg: { secret?: string }) => ({ ...cfg, secret: cfg.secret ? "••••" + cfg.secret.slice(-4) : "" });

  r.get("/integrations/saipos/:storeId", async (c) => {
    const s = await store(c); const cfg = await saiposConfig(ctxOf(c), s.id); const t = await c.get("deps").db.tenants.get(c.get("tenantId"));
    const webhookUrl = `${c.get("deps").publicUrl}/webhooks/saipos/${t!.slug}/${s.id}?token=${cfg?.webhookSecret || "(salve para gerar)"}`;
    return c.json({ config: cfg ? hidden(cfg) : null, webhookUrl });
  });
  r.put("/integrations/saipos/:storeId", async (c) => {
    const s = await store(c); const prev = await saiposConfig(ctxOf(c), s.id);
    const raw = (await c.req.json()) as Record<string, unknown>;
    if (typeof raw.secret === "string" && raw.secret.startsWith("••••") && prev) raw.secret = prev.secret; // não sobrescreve o segredo mascarado
    const cfg = saiposConfigSchema.parse({ ...raw, webhookSecret: prev?.webhookSecret || crypto.randomUUID().replace(/-/g, "") });
    await c.get("deps").db.put("integrations", c.get("tenantId"), { id: `saipos:${s.id}`, provider: "saipos", storeId: s.id, config: cfg });
    return c.json({ config: hidden(cfg) });
  });
  r.post("/integrations/saipos/:storeId/test", async (c) => {
    const s = await store(c); const cfg = await saiposConfig(ctxOf(c), s.id); if (!cfg) throw new HttpError(422, "Salve a configuração primeiro");
    try { await new SaiposClient(cfg, c.get("deps").saiposFetch).token(true); return c.json({ ok: true, message: "Autenticado na SAIPOS (" + cfg.env + ")" }); }
    catch (e) { return c.json({ ok: false, message: e instanceof SaiposError ? `${e.code ?? e.status}: ${e.message}` : String(e) }); }
  });
  /** Baixa o cardápio da SAIPOS e sugere o de-para de códigos PDV. */
  r.post("/integrations/saipos/:storeId/catalog", async (c) => {
    const s = await store(c); const ctx = ctxOf(c); const cfg = await saiposConfig(ctx, s.id); if (!cfg) throw new HttpError(422, "Salve a configuração primeiro");
    let rows;
    try { rows = await new SaiposClient(cfg, ctx.deps.saiposFetch).catalog(); } catch (e) { throw new HttpError(502, e instanceof SaiposError ? `SAIPOS ${e.code ?? e.status}: ${e.message}` : String(e)); }
    const grouped = groupCatalog(rows);
    const items = await ctx.deps.db.list<Item & { id: string }>("items", ctx.tenantId);
    const groups = Object.fromEntries((await ctx.deps.db.list<OptionGroup & { id: string }>("option_groups", ctx.tenantId)).map((g) => [g.id, g]));
    return c.json({ saipos: grouped, suggestions: suggestMapping(items, groups, grouped) });
  });
  r.post("/integrations/saipos/apply-mapping", async (c) => {
    const i = await body(c, z.object({ items: z.array(z.object({ itemId: z.string(), code: z.string() })), options: z.array(z.object({ groupId: z.string(), optionId: z.string(), code: z.string() })) }));
    const { db } = c.get("deps"); const t = c.get("tenantId");
    for (const x of i.items) await db.patch("items", t, x.itemId, { integrationCode: x.code });
    const byGroup = new Map<string, typeof i.options>(); for (const o of i.options) { if (!byGroup.has(o.groupId)) byGroup.set(o.groupId, []); byGroup.get(o.groupId)!.push(o); }
    for (const [gid, list] of byGroup) {
      const g = await db.get<OptionGroup & { id: string }>("option_groups", t, gid); if (!g) continue;
      await db.put("option_groups", t, { ...g, options: g.options.map((o) => ({ ...o, integrationCode: list.find((x) => x.optionId === o.id)?.code ?? o.integrationCode })) });
    }
    return c.json({ ok: true, items: i.items.length, options: i.options.length });
  });
  /** Checklist dos critérios de homologação da SAIPOS (módulo Delivery e Balcão), marcado pelos pedidos já enviados. */
  r.get("/integrations/saipos/:storeId/homologation", async (c) => {
    const s = await store(c);
    const os = (await c.get("deps").db.list<O>("orders", c.get("tenantId"), { where: { storeId: s.id } })).filter((o) => o.pos?.payload);
    const P = os.map((o) => o.pos!.payload as unknown as { order_method: { mode: string; delivery_by?: string; delivery_fee?: number; scheduled: boolean }; customer: { id: string; phone: string }; payment_types: { code: string; type?: string; complement?: string; change_for: number }[]; items: { notes: string }[]; notes: string; total_discount: number; total_increase: number });
    const has = (f: (p: (typeof P)[number]) => boolean) => P.some(f);
    const custIds = P.map((p) => p.customer.id).filter((x) => x !== "-1");
    const crit = [
      ["Delivery com entrega pelo parceiro", has((p) => p.order_method.mode === "DELIVERY" && p.order_method.delivery_by === "PARTNER")],
      ["Delivery com entrega pela loja", has((p) => p.order_method.mode === "DELIVERY" && p.order_method.delivery_by === "RESTAURANT")],
      ["Pedido agendado com data nas observações", has((p) => p.order_method.scheduled && /AGENDADO/.test(p.notes))],
      ["Mesmo order_id reenviado (idempotência, erro 904 tratado)", os.some((o) => (o.pos?.response as { alreadyImported?: boolean })?.alreadyImported)],
      ["Dois pedidos com o mesmo ID de cliente", new Set(custIds).size < custIds.length],
      ["Consumidor não identificado (customer.id -1)", has((p) => p.customer.id === "-1")],
      ["Pedido sem telefone do cliente", has((p) => !p.customer.phone)],
      ["Mais de uma forma de pagamento", has((p) => p.payment_types.length > 1)],
      ["Pagamento online (PARTNER_PAYMENT/ONLINE)", has((p) => p.payment_types.some((x) => x.code === "PARTNER_PAYMENT" && x.type === "ONLINE"))],
      ["Pagamento offline", has((p) => p.payment_types.some((x) => x.type === "OFFLINE"))],
      ["Cartão com bandeira no complemento", has((p) => p.payment_types.some((x) => ["CRE", "DEB"].includes(x.code) && !!x.complement))],
      ["Pix pago no parceiro (complement pix)", has((p) => p.payment_types.some((x) => x.code === "PARTNER_PAYMENT" && /pix/i.test(x.complement || "")))],
      ["Dinheiro com troco", has((p) => p.payment_types.some((x) => x.code === "DIN" && x.change_for > 0))],
      ["Observação no item", has((p) => p.items.some((i) => !!i.notes))],
      ["Observação no pedido", has((p) => !!p.notes)],
      ["Desconto (total_discount)", has((p) => p.total_discount > 0)],
      ["Acréscimo (total_increase)", has((p) => p.total_increase > 0)],
      ["Entrega pela loja sem taxa", has((p) => p.order_method.delivery_by === "RESTAURANT" && p.order_method.delivery_fee === 0)],
      ["Status cancelado/despachado/entregue enviados (entrega parceiro)", os.some((o) => o.statusHistory.some((h) => ["dispatched", "concluded", "cancelled"].includes(h.status) && h.by !== "saipos"))],
    ].map(([label, ok]) => ({ label, ok }));
    return c.json({ sent: os.length, criteria: crit, done: crit.filter((x) => x.ok).length });
  });
  return r;
}
