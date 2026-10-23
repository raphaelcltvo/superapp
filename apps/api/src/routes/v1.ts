import { Hono } from "hono";
import { z } from "zod";
import { uid } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { sha256 } from "../auth";
import { upsertCustomer, recomputeStats } from "../services/customers";
import { publishedSnapshot } from "../services/catalog";

/** API pública para conectar bases externas (ERP, CRM, PDV, planilhas automatizadas). Autenticação: Authorization: Bearer cw_live_... */
export function v1Routes() {
  const r = new Hono<Env>();
  r.use("*", async (c, next) => {
    const raw = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!raw.startsWith("cw_")) throw new HttpError(401, "Chave de API ausente");
    const hit = await c.get("deps").db.findGlobal<{ id: string; scopes: string[] }>("api_keys", "keyHash", await sha256(raw));
    if (!hit) throw new HttpError(401, "Chave de API inválida");
    c.set("tenantId", hit.tenantId); c.set("scopes", hit.doc.scopes);
    await next();
  });
  const need = (c: import("hono").Context<Env>, s: string) => { if (!c.get("scopes")?.includes(s)) throw new HttpError(403, `Chave sem permissão ${s}`); };

  r.post("/customers", async (c) => {
    need(c, "customers:write");
    const list = await body(c, z.array(z.object({ phone: z.string(), name: z.string().optional(), email: z.string().email().optional(), document: z.string().optional(), birthday: z.string().optional(), optinWhatsapp: z.boolean().optional(), externalId: z.string().optional(), source: z.string().optional(), tags: z.array(z.string()).optional() })).max(1000));
    const ctx = ctxOf(c); let ok = 0; const errors: { index: number; error: string }[] = [];
    for (const [i, x] of list.entries()) {
      try { const { externalId, ...rest } = x; await upsertCustomer(ctx, { ...rest, externalIds: externalId ? { api: externalId } : undefined }); ok++; }
      catch (e) { errors.push({ index: i, error: String((e as Error).message) }); }
    }
    return c.json({ upserted: ok, errors });
  });

  r.post("/orders", async (c) => {
    need(c, "orders:write");
    const list = await body(c, z.array(z.object({ externalId: z.string(), createdAt: z.string(), total: z.number(), channel: z.string().optional(), status: z.enum(["concluded", "cancelled"]).default("concluded"), customer: z.object({ phone: z.string(), name: z.string().optional() }).optional(), items: z.array(z.object({ name: z.string(), qty: z.number(), unit: z.number() })).optional() })).max(1000));
    const ctx = ctxOf(c); const touched = new Set<string>();
    for (const o of list) {
      const cust = o.customer ? await upsertCustomer(ctx, { phone: o.customer.phone, name: o.customer.name, source: o.channel }) : null;
      if (cust) touched.add(cust.id);
      await ctx.deps.db.put("orders", ctx.tenantId, { id: `api_${o.externalId}`, imported: true, displayId: o.externalId, storeId: "", customerId: cust?.id, mode: "DELIVERY", lines: (o.items || []).map((x) => ({ itemId: "", name: x.name, qty: x.qty, unit: x.unit, total: x.qty * x.unit, base: x.unit, choices: [] })), subtotal: o.total, discount: 0, deliveryFee: 0, fees: [], strategiesApplied: [], cashbackUsed: 0, total: o.total, cashbackEarned: 0, payment: { code: "PIX_ONLINE" }, status: o.status, statusHistory: [], source: "api:" + (o.channel || "externo"), createdAt: new Date(o.createdAt).toISOString() } as never);
    }
    for (const id of touched) await recomputeStats(ctx, id);
    return c.json({ imported: list.length });
  });

  r.get("/menu", async (c) => { need(c, "menu:read"); const s = await publishedSnapshot(ctxOf(c)); if (!s) throw new HttpError(404, "Nada publicado"); return c.json({ categories: s.categories, items: s.items, groups: s.groups }); });

  r.post("/events", async (c) => {
    need(c, "events:write");
    const list = await body(c, z.array(z.object({ sessionId: z.string(), name: z.string(), ts: z.string(), customerPhone: z.string().optional(), source: z.string().optional(), props: z.record(z.unknown()).optional() })).max(5000));
    await c.get("deps").db.events.insert(c.get("tenantId"), list.map((e) => ({ id: uid("ev"), sessionId: e.sessionId, name: e.name, ts: new Date(e.ts).toISOString(), source: e.source, props: e.props })));
    return c.json({ inserted: list.length });
  });
  return r;
}
