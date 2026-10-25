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
import { publicPayments, renewPix, sweepPayment, markPaid, activePayments } from "../services/payments";
import { fakeState } from "../integrations/payments/fake";
import { fakeProviders, waConfig } from "../services/messaging";
import { MetaWhatsApp } from "../integrations/messaging/whatsapp";
import { personalizeMenu } from "../services/engagement";
import { registerEngagePublic } from "./engage";
import { issueOtp, consumeOtp } from "../services/otp";
import { applyFirstVisit, mergeLead } from "../services/firstvisit";
import { registerFirstVisitPublic, requireOnlineAuth } from "./firstvisit";


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
    const cust = await me(c);
    const menu = await personalizeMenu(ctx, await resolveMenu(ctx, snap, { storeId: c.req.query("store"), source: c.req.query("source"), customer: cust }), cust);
    return c.json(await applyFirstVisit(ctx, menu, snap, { customer: cust, leadId: c.req.header("x-lead-id"), source: c.req.query("source"), campaign: c.req.query("campaign"), content: c.req.query("content") }));
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
    const code = issueOtp(c.get("tenantId"), p, deps.demo);
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
    const i = await body(c, z.object({ phone: z.string(), code: z.string(), name: z.string().optional(), optinWhatsapp: z.boolean().optional(), leadId: z.string().max(40).optional() }));
    const p = normPhone(i.phone); if (!p) throw new HttpError(422, "Telefone inválido");
    consumeOtp(c.get("tenantId"), p, i.code);
    const ctx = ctxOf(c);
    const existed = await findByPhone(ctx, p);
    let cust = await upsertCustomer(ctx, { phone: p, name: i.name || existed?.name, optinWhatsapp: i.optinWhatsapp ?? existed?.optinWhatsapp });
    // o lead da primeira visita (respostas, origem, consentimento) passa para o cliente agora que o telefone foi confirmado
    if (i.leadId) cust = (await mergeLead(ctx, i.leadId, cust)) || cust;
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
    await requireOnlineAuth(c, input.payment.code);
    const { order, customer } = await placeOrder(ctxOf(c), input, await me(c));
    return c.json({ order, customerToken: await signCustomer({ cid: customer.id, tid: c.get("tenantId") }, c.get("deps").jwtSecret) }, 201);
  });
  r.get("/orders/:id", async (c) => {
    let o = await c.get("deps").db.get<Order & { id: string }>("orders", c.get("tenantId"), c.req.param("id"));
    if (!o || (o.customerId && o.customerId !== c.get("customerId"))) throw new HttpError(404, "Pedido não encontrado");
    o = (await sweepPayment(ctxOf(c), o)) as Order & { id: string };
    const on = o.payment.online;
    return c.json({ id: o.id, displayId: o.displayId, status: o.status, statusHistory: o.statusHistory, total: o.total, lines: o.lines, cashbackEarned: o.cashbackEarned, mode: o.mode, feedback: o.feedback ? { nps: o.feedback.nps, kind: o.feedback.kind } : null,
      payment: { code: o.payment.code, online: on && { gateway: on.gateway, method: on.method, status: on.status, pix: on.status === "pending" || on.status === "expired" ? on.pix : undefined, card: on.card, failureReason: on.failureReason, paidAt: on.paidAt } } });
  });
  /** Configuração pública de pagamento (chave pública para gerar o token do cartão no navegador). */
  r.get("/payments/config", async (c) => c.json(await publicPayments(ctxOf(c))));
  r.post("/orders/:id/pix", async (c) => {
    const o = await c.get("deps").db.get<Order & { id: string }>("orders", c.get("tenantId"), c.req.param("id"));
    if (!o || (o.customerId && o.customerId !== c.get("customerId"))) throw new HttpError(404, "Pedido não encontrado");
    const n = await renewPix(ctxOf(c), o.id);
    return c.json({ id: n!.id, status: n!.status, payment: { code: n!.payment.code, online: n!.payment.online } });
  });
  /** Só no gateway de teste: simula o banco confirmando o Pix. */
  r.post("/payments/fake/:chargeId/pay", async (c) => {
    const ctx = ctxOf(c); const a = await activePayments(ctx);
    if (a?.cfg.gateway !== "fake") throw new HttpError(404, "Disponível só no gateway de teste");
    const o = (await ctx.deps.db.list<Order & { id: string }>("orders", ctx.tenantId, { where: { "payment.online.chargeId": c.req.param("chargeId") }, limit: 1 }))[0];
    if (!o) throw new HttpError(404, "Cobrança não encontrada");
    fakeState.set(c.req.param("chargeId"), "paid");
    const n = await markPaid(ctx, o.id, "fake");
    return c.json({ ok: true, status: n?.status });
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
  registerEngagePublic(r);
  registerFirstVisitPublic(r);
  return r;
}
