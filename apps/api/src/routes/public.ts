import { Hono } from "hono";
import { z } from "zod";
import { normPhone, resolveZone, uid, type Coupon, type Customer, type Page, type Order } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { readToken, signCustomer, type CustomerClaims, type AdminClaims } from "../auth";
import { resolveMenu } from "../services/menu";
import { placeOrder, quoteFor, snapshotFor } from "../services/orders";
import { findByPhone, upsertCustomer, ledgerOf } from "../services/customers";
import { checkoutSchema } from "../schemas";
import { walletBalance } from "@cw/core";
import { emit } from "../services/integrations";
import { fakeProviders, waConfig } from "../services/messaging";
import { MetaWhatsApp } from "../integrations/messaging/whatsapp";

const otps = new Map<string, { code: string; exp: number; tries: number }>();

export function publicRoutes() {
  const r = new Hono<Env>();
  r.use("*", async (c, next) => {
    const t = await c.get("deps").db.tenants.bySlug(c.req.param("slug")!);
    if (!t) throw new HttpError(404, "Marca não encontrada");
    c.set("tenantId", t.id);
    const tok = await readToken<CustomerClaims>(c.req.header("x-customer-token"), c.get("deps").jwtSecret);
    if (tok?.kind === "customer" && tok.tid === t.id) c.set("customerId", tok.cid);
    await next();
  });
  const me = async (c: import("hono").Context<Env>) => { const id = c.get("customerId"); return id ? c.get("deps").db.get<Customer & { id: string }>("customers", c.get("tenantId"), id) : null; };
  const isPreview = async (c: import("hono").Context<Env>) => {
    if (c.req.query("preview") !== "1") return false;
    const a = await readToken<AdminClaims>(c.req.header("authorization"), c.get("deps").jwtSecret);
    return !!a && a.tid === c.get("tenantId");
  };

  r.get("/menu", async (c) => {
    const ctx = ctxOf(c);
    const snap = await snapshotFor(ctx, await isPreview(c));
    return c.json(await resolveMenu(ctx, snap, { storeId: c.req.query("store"), source: c.req.query("source"), customer: await me(c) }));
  });

  r.post("/events", async (c) => {
    const ev = await body(c, z.object({ sessionId: z.string().min(4), source: z.string().optional(), device: z.string().optional(), events: z.array(z.object({ name: z.string().max(40), ts: z.string().optional(), props: z.record(z.unknown()).optional() })).max(100) }));
    const now = c.get("deps").now().toISOString();
    await c.get("deps").db.events.insert(c.get("tenantId"), ev.events.map((e) => ({ id: uid("ev"), sessionId: ev.sessionId, customerId: c.get("customerId"), name: e.name, ts: e.ts && e.ts <= now ? e.ts : now, source: ev.source, device: ev.device, props: e.props })));
    return c.json({ ok: true });
  });

  r.post("/quote", async (c) => {
    const input = await body(c, checkoutSchema.omit({ payment: true, customer: true }));
    const { q } = await quoteFor(ctxOf(c), input, await me(c), await isPreview(c));
    return c.json(q);
  });

  r.post("/zone", async (c) => {
    const i = await body(c, z.object({ storeId: z.string(), lat: z.number(), lng: z.number() }));
    const snap = await snapshotFor(ctxOf(c), await isPreview(c));
    const st = snap.stores.find((s) => s.id === i.storeId);
    if (!st) throw new HttpError(404, "Loja não encontrada");
    const z0 = resolveZone(st.zones, [i.lat, i.lng], st.address.lat != null ? [st.address.lat, st.address.lng!] : undefined);
    return c.json(z0 ? { ok: true, zone: { id: z0.id, name: z0.name, fee: z0.fee, etaMin: z0.etaMin, etaMax: z0.etaMax } } : { ok: false });
  });

  /** Geocodifica o endereço e já devolve a área, a taxa e o tempo. */
  r.post("/geocode", async (c) => {
    const i = await body(c, z.object({ storeId: z.string(), street: z.string().default(""), number: z.string().default(""), district: z.string(), city: z.string().default(""), state: z.string().default(""), postalCode: z.string().default("") }));
    const snap = await snapshotFor(ctxOf(c), await isPreview(c));
    const st = snap.stores.find((s) => s.id === i.storeId);
    if (!st) throw new HttpError(404, "Loja não encontrada");
    let pt = c.get("deps").geocode ? await c.get("deps").geocode!(i) : null;
    if (!pt) {
      const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const z0 = st.zones.find((z) => z.active && z.kind === "polygon" && norm(z.name).includes(norm(i.district).trim()) && i.district.trim().length > 2);
      if (z0?.polygon) pt = { lat: z0.polygon.reduce((a, p) => a + p[0], 0) / z0.polygon.length, lng: z0.polygon.reduce((a, p) => a + p[1], 0) / z0.polygon.length };
    }
    if (!pt) return c.json({ ok: false, reason: "Não encontramos esse endereço na área de entrega" });
    const z1 = resolveZone(st.zones, [pt.lat, pt.lng], st.address.lat != null ? [st.address.lat, st.address.lng!] : undefined);
    return c.json(z1 ? { ok: true, lat: pt.lat, lng: pt.lng, zone: { id: z1.id, name: z1.name, fee: z1.fee, etaMin: z1.etaMin, etaMax: z1.etaMax } } : { ok: false, lat: pt.lat, lng: pt.lng, reason: "Endereço fora da área de entrega" });
  });

  r.post("/auth/otp", async (c) => {
    const { phone } = await body(c, z.object({ phone: z.string() }));
    const p = normPhone(phone); if (!p) throw new HttpError(422, "Telefone inválido");
    const deps = c.get("deps");
    const code = deps.demo ? "1234" : String(Math.floor(1000 + Math.random() * 9000));
    otps.set(`${c.get("tenantId")}|${p}`, { code, exp: Date.now() + 10 * 60e3, tries: 0 });
    const wa = await waConfig(ctxOf(c));
    if (wa?.enabled && wa.otpTemplate?.name) {
      // código pelo modelo de autenticação aprovado na Meta (botão "copiar código")
      const prov = wa.provider === "fake" ? fakeProviders(c.get("tenantId")).wa : new MetaWhatsApp(wa, deps.messagingFetch);
      try { await prov.send(p, { kind: "otp", name: wa.otpTemplate.name, language: wa.otpTemplate.language || "pt_BR", code }); }
      catch { throw new HttpError(502, "Não conseguimos enviar o código pelo WhatsApp agora. Tente de novo em instantes."); }
    } else await deps.sendOtp(c.get("tenantId"), p, code);
    return c.json({ ok: true, demoCode: deps.demo ? code : undefined, known: !!(await findByPhone(ctxOf(c), p)) });
  });
  r.post("/auth/verify", async (c) => {
    const i = await body(c, z.object({ phone: z.string(), code: z.string(), name: z.string().optional(), optinWhatsapp: z.boolean().optional() }));
    const p = normPhone(i.phone)!; const key = `${c.get("tenantId")}|${p}`; const o = otps.get(key);
    if (!o || o.exp < Date.now()) throw new HttpError(422, "Código expirado, peça outro");
    if (++o.tries > 5) { otps.delete(key); throw new HttpError(429, "Muitas tentativas"); }
    if (o.code !== i.code) throw new HttpError(422, "Código incorreto");
    otps.delete(key);
    const ctx = ctxOf(c);
    const existed = await findByPhone(ctx, p);
    const cust = await upsertCustomer(ctx, { phone: p, name: i.name || existed?.name, optinWhatsapp: i.optinWhatsapp ?? existed?.optinWhatsapp });
    if (!existed) await emit(ctx, "customer.created", cust);
    return c.json({ token: await signCustomer({ cid: cust.id, tid: c.get("tenantId") }, c.get("deps").jwtSecret), customer: { id: cust.id, name: cust.name, orders: cust.orders } });
  });

  r.get("/me", async (c) => {
    const cust = await me(c); if (!cust) throw new HttpError(401, "Entre com seu telefone");
    const ctx = ctxOf(c);
    const orders = await ctx.deps.db.list<Order & { id: string }>("orders", ctx.tenantId, { where: { customerId: cust.id }, limit: 10 });
    return c.json({ customer: cust, wallet: walletBalance(await ledgerOf(ctx, cust.id), ctx.deps.now()), orders: orders.map((o) => ({ id: o.id, displayId: o.displayId, total: o.total, status: o.status, createdAt: o.createdAt })) });
  });

  r.post("/orders", async (c) => {
    const input = await body(c, checkoutSchema);
    const { order, customer } = await placeOrder(ctxOf(c), input, await me(c));
    return c.json({ order, customerToken: await signCustomer({ cid: customer.id, tid: c.get("tenantId") }, c.get("deps").jwtSecret) }, 201);
  });
  r.get("/orders/:id", async (c) => {
    const o = await c.get("deps").db.get<Order & { id: string }>("orders", c.get("tenantId"), c.req.param("id"));
    if (!o || (o.customerId && o.customerId !== c.get("customerId"))) throw new HttpError(404, "Pedido não encontrado");
    return c.json({ id: o.id, displayId: o.displayId, status: o.status, statusHistory: o.statusHistory, total: o.total, lines: o.lines, cashbackEarned: o.cashbackEarned, mode: o.mode });
  });

  r.get("/pages/:pageSlug", async (c) => {
    const p = (await c.get("deps").db.list<Page & { id: string }>("pages", c.get("tenantId"), { where: { slug: c.req.param("pageSlug") }, limit: 1 }))[0];
    if (!p || !p.active) throw new HttpError(404, "Página não encontrada");
    // cupons citados na página: expõe só o código e o benefício
    const coupons = await c.get("deps").db.list<Coupon & { id: string }>("coupons", c.get("tenantId"));
    return c.json({ ...p, blocks: p.blocks.map((b) => (b.kind === "coupon" ? { ...b, coupon: (({ code, name, type, value }) => ({ code, name, type, value }))(coupons.find((x) => x.id === b.couponId && x.active) || ({} as Coupon)) } : b)) });
  });
  r.post("/pages/:pageSlug/responses", async (c) => {
    const ctx = ctxOf(c);
    const p = (await ctx.deps.db.list<Page & { id: string }>("pages", ctx.tenantId, { where: { slug: c.req.param("pageSlug") }, limit: 1 }))[0];
    if (!p) throw new HttpError(404, "Página não encontrada");
    const i = await body(c, z.object({ sessionId: z.string().optional(), answers: z.record(z.union([z.string().max(1000), z.number(), z.array(z.string())])) }));
    const ids = new Set(p.blocks.filter((b) => "id" in b).map((b) => (b as { id: string }).id));
    const answers = Object.fromEntries(Object.entries(i.answers).filter(([k]) => ids.has(k)));
    const resp = { id: uid("rsp"), pageId: p.id, customerId: c.get("customerId"), sessionId: i.sessionId, answers, createdAt: ctx.deps.now().toISOString() };
    await ctx.deps.db.put("page_responses", ctx.tenantId, resp as never);
    await emit(ctx, "page.response", resp);
    return c.json({ ok: true, thankYou: p.thankYou || "Obrigado!" }, 201);
  });
  return r;
}
