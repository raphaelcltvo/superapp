import { uid, type Coupon, type Customer, type OnlinePayment, type OnlinePaymentStatus, type Order } from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";
import { GATEWAYS, DEFAULT_PAYMENTS_CONFIG, PaymentError, type CardInput, type PaymentsConfig, type PublicPaymentsConfig, type Fetch } from "../integrations/payments";
import { changeStatus, sendToPos } from "./orders";
import { saiposConfig, emit } from "./integrations";

type O = Order & { id: string };
const http = (ctx: Ctx): Fetch => ctx.deps.paymentsFetch || ((u, i) => fetch(u, i));

export async function paymentsConfig(ctx: Ctx): Promise<PaymentsConfig | null> {
  const d = await ctx.deps.db.get<{ id: string; config: PaymentsConfig }>("integrations", ctx.tenantId, "payments");
  return d ? { ...DEFAULT_PAYMENTS_CONFIG, ...d.config, methods: { ...DEFAULT_PAYMENTS_CONFIG.methods, ...d.config.methods } } : null;
}
export async function activePayments(ctx: Ctx) {
  const cfg = await paymentsConfig(ctx);
  if (!cfg?.enabled) return null;
  const gw = GATEWAYS[cfg.gateway];
  return gw ? { cfg, gw } : null;
}
export async function publicPayments(ctx: Ctx): Promise<PublicPaymentsConfig | null> {
  const a = await activePayments(ctx);
  if (!a) return null;
  const p = a.gw.publicConfig(a.cfg);
  return { ...p, methods: { pix: p.methods.pix && a.gw.supports.pix, card: p.methods.card && a.gw.supports.card } };
}
export const isOnlineCode = (c: string) => c === "PIX_ONLINE" || c === "CARD_ONLINE";

export function notificationUrl(ctx: Ctx, slug: string, cfg: PaymentsConfig) {
  return `${ctx.deps.publicUrl}/webhooks/payments/${cfg.gateway}/${slug}?token=${cfg.webhookToken}`;
}

/** Cria a cobrança antes de gravar o pedido. Cartão recusado não vira pedido. */
export async function chargeNewOrder(ctx: Ctx, order: Order, customer: Customer, card?: CardInput): Promise<OnlinePayment> {
  const a = await activePayments(ctx);
  if (!a) throw new HttpError(422, "Pagamento online indisponível");
  const t = await ctx.deps.db.tenants.get(ctx.tenantId);
  const base = { order, customer, cfg: a.cfg, http: http(ctx), notificationUrl: notificationUrl(ctx, t!.slug, a.cfg), now: ctx.deps.now(), description: `${t!.name} · pedido #${order.displayId}` };
  try {
    if (order.payment.code === "PIX_ONLINE") {
      if (!a.cfg.methods.pix || !a.gw.supports.pix) throw new HttpError(422, "Pix online indisponível");
      const r = await a.gw.createPix(base);
      return { gateway: a.gw.id, chargeId: r.chargeId, method: "pix", status: "pending", pix: { qrText: r.qrText, qrImage: r.qrImage, expiresAt: r.expiresAt } };
    }
    if (!a.cfg.methods.card || !a.gw.supports.card) throw new HttpError(422, "Cartão online indisponível");
    if (!card?.token) throw new HttpError(422, "Dados do cartão ausentes");
    const installments = Math.max(1, Math.min(card.installments || 1, a.cfg.maxInstallments || 1));
    const r = await a.gw.createCard(base, { ...card, installments });
    return { gateway: a.gw.id, chargeId: r.chargeId, method: "card", status: r.status === "paid" ? "paid" : r.status === "failed" ? "failed" : "pending", card: { brand: r.brand, last4: r.last4, installments }, failureReason: r.failureReason, paidAt: r.status === "paid" ? ctx.deps.now().toISOString() : undefined };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof PaymentError) throw new HttpError(e.status >= 500 ? 502 : 422, `Pagamento: ${e.message}`);
    throw new HttpError(502, "Não foi possível falar com o gateway de pagamento");
  }
}

/** Pagamento confirmado: libera o pedido para a cozinha (e para a SAIPOS). Idempotente. */
export async function markPaid(ctx: Ctx, orderId: string, by: string) {
  const o = await ctx.deps.db.get<O>("orders", ctx.tenantId, orderId);
  if (!o?.payment.online) return o;
  if (o.payment.online.status === "paid" && o.status !== "awaiting_payment" && o.status !== "payment_failed") return o;
  const at = ctx.deps.now().toISOString();
  const online = { ...o.payment.online, status: "paid" as const, paidAt: o.payment.online.paidAt || at, failureReason: undefined };
  const releasing = o.status === "awaiting_payment" || o.status === "payment_failed";
  await ctx.deps.db.patch("orders", ctx.tenantId, orderId, { payment: { ...o.payment, online }, ...(releasing ? { status: "created", statusHistory: [...o.statusHistory, { status: "created", at, by, note: o.payment.online.method === "pix" ? "Pix pago" : "Cartão aprovado" }] } : {}) });
  await ctx.deps.db.events.insert(ctx.tenantId, [{ id: uid("ev"), sessionId: o.sessionId || o.id, customerId: o.customerId, name: "payment_paid", ts: at, props: { orderId, method: o.payment.online.method, gateway: o.payment.online.gateway } }]);
  await emit(ctx, "order.status", { id: orderId, status: "paid" });
  if (releasing) {
    const sc = await saiposConfig(ctx, o.storeId);
    if (sc?.enabled && sc.autoSend) return sendToPos(ctx, orderId);
  }
  return ctx.deps.db.get<O>("orders", ctx.tenantId, orderId);
}

/** Pix vencido ou cartão recusado depois: o pedido fica aguardando nova tentativa por 60 min e depois é cancelado. */
export async function markUnpaid(ctx: Ctx, orderId: string, status: "expired" | "failed", reason?: string) {
  const o = await ctx.deps.db.get<O>("orders", ctx.tenantId, orderId);
  if (!o?.payment.online || o.payment.online.status === "paid" || o.payment.online.status === "refunded") return o;
  const at = ctx.deps.now().toISOString();
  return ctx.deps.db.patch<O>("orders", ctx.tenantId, orderId, { status: "payment_failed", payment: { ...o.payment, online: { ...o.payment.online, status, failureReason: reason || (status === "expired" ? "Pix expirado" : "Pagamento recusado") } }, statusHistory: [...o.statusHistory, { status: "payment_failed", at, by: o.payment.online.gateway, note: status === "expired" ? "Pix expirado" : reason }] });
}

/** Aplica um status vindo do gateway (webhook, consulta ou pagamento de teste). */
export async function applyGatewayStatus(ctx: Ctx, order: O, status: OnlinePaymentStatus, by: string) {
  if (status === "paid") return markPaid(ctx, order.id, by);
  if (status === "expired" || status === "failed") return markUnpaid(ctx, order.id, status);
  if (status === "refunded" && order.payment.online?.status !== "refunded") {
    await ctx.deps.db.patch("orders", ctx.tenantId, order.id, { payment: { ...order.payment, online: { ...order.payment.online!, status: "refunded", refundedAt: ctx.deps.now().toISOString() } } });
    if (order.status !== "cancelled") await changeStatus(ctx, order.id, "cancelled", by, "Estornado no gateway");
  }
  return ctx.deps.db.get<O>("orders", ctx.tenantId, order.id);
}

export async function findByCharge(ctx: Ctx, chargeId: string) {
  return (await ctx.deps.db.list<O>("orders", ctx.tenantId, { where: { "payment.online.chargeId": chargeId }, limit: 1 }))[0] || null;
}

/** Nova cobrança Pix para um pedido que expirou (botão "Gerar novo Pix"). */
export async function renewPix(ctx: Ctx, orderId: string) {
  const o = await ctx.deps.db.get<O>("orders", ctx.tenantId, orderId);
  if (!o) throw new HttpError(404, "Pedido não encontrado");
  if (o.status !== "payment_failed" && o.status !== "awaiting_payment") throw new HttpError(422, "Este pedido não está aguardando pagamento");
  const cust = o.customerId ? await ctx.deps.db.get<Customer & { id: string }>("customers", ctx.tenantId, o.customerId) : null;
  const online = await chargeNewOrder(ctx, { ...o, payment: { ...o.payment, code: "PIX_ONLINE" } }, cust!);
  const at = ctx.deps.now().toISOString();
  return ctx.deps.db.patch<O>("orders", ctx.tenantId, orderId, { status: "awaiting_payment", payment: { ...o.payment, code: "PIX_ONLINE", online }, statusHistory: [...o.statusHistory, { status: "awaiting_payment", at, by: "cliente", note: "Novo Pix gerado" }] });
}

/**
 * Manutenção leve (chamada ao consultar pedidos): Pix vencido vira "payment_failed" e, depois de 60 min sem pagamento,
 * o pedido é cancelado (estorna cashback e libera o cupom). No gateway de teste, paga sozinho após fakeAutoPaySeconds.
 */
export async function sweepPayment(ctx: Ctx, o: O) {
  const on = o.payment.online;
  if (!on || (o.status !== "awaiting_payment" && o.status !== "payment_failed")) return o;
  const a = await activePayments(ctx);
  const now = +ctx.deps.now();
  if (a?.cfg.gateway === "fake" && on.gateway === "fake" && on.method === "pix" && on.status === "pending" && a.cfg.fakeAutoPaySeconds) {
    const created = o.statusHistory.filter((h) => h.status === "awaiting_payment").pop()?.at || o.createdAt;
    if (now - +new Date(created) >= a.cfg.fakeAutoPaySeconds * 1000) return (await markPaid(ctx, o.id, "fake"))!;
  }
  if (on.status === "pending" && on.pix && now > +new Date(on.pix.expiresAt)) {
    if (a) { try { const st = await a.gw.status(a.cfg, http(ctx), on.chargeId); if (st === "paid") return (await markPaid(ctx, o.id, on.gateway))!; } catch { /* segue para expirar */ } }
    return (await markUnpaid(ctx, o.id, "expired"))!;
  }
  const failedAt = o.statusHistory.filter((h) => h.status === "payment_failed").pop()?.at;
  if (o.status === "payment_failed" && failedAt && now - +new Date(failedAt) > 60 * 60e3) {
    if (o.couponId) { const c = await ctx.deps.db.get<Coupon & { id: string }>("coupons", ctx.tenantId, o.couponId); if (c?.uses) await ctx.deps.db.patch("coupons", ctx.tenantId, c.id, { uses: c.uses - 1 }); }
    return changeStatus(ctx, o.id, "cancelled", "sistema", "Sem pagamento em 60 minutos");
  }
  return o;
}

/** Estorno total ou parcial. Usado no cancelamento de pedido pago e pelo botão do painel. */
export async function refundOrder(ctx: Ctx, orderId: string, amount?: number, by = "sistema") {
  const o = await ctx.deps.db.get<O>("orders", ctx.tenantId, orderId);
  if (!o?.payment.online) throw new HttpError(422, "Pedido sem pagamento online");
  if (o.payment.online.status !== "paid") throw new HttpError(422, "Só é possível estornar pagamento aprovado");
  const gw = GATEWAYS[o.payment.online.gateway];
  const cfg = await paymentsConfig(ctx);
  if (!cfg) throw new HttpError(422, "Gateway não configurado");
  try { await gw.refund(cfg, http(ctx), o.payment.online.chargeId, amount); }
  catch (e) { throw new HttpError(502, `Estorno recusado pelo gateway: ${(e as Error).message}`); }
  const at = ctx.deps.now().toISOString();
  await ctx.deps.db.patch("orders", ctx.tenantId, orderId, { payment: { ...o.payment, online: { ...o.payment.online, status: "refunded", refundedAt: at } }, statusHistory: [...o.statusHistory, { status: o.status, at, by, note: amount ? `Estorno parcial de R$ ${amount.toFixed(2)}` : "Estorno total" }] });
  return ctx.deps.db.get<O>("orders", ctx.tenantId, orderId);
}

/** Webhook de qualquer gateway: valida, acha o pedido pela cobrança e aplica o status. */
export async function onPaymentWebhook(ctx: Ctx, gateway: string, req: { headers: Record<string, string>; body: string; query: Record<string, string> }) {
  const cfg = await paymentsConfig(ctx);
  if (!cfg || cfg.gateway !== gateway) throw new HttpError(404, "Gateway não configurado para esta marca");
  if (req.query.token !== cfg.webhookToken) throw new HttpError(401, "Token do webhook inválido");
  let parsed;
  try { parsed = await GATEWAYS[cfg.gateway].parseWebhook(req, cfg, http(ctx)); }
  catch (e) { if (e instanceof PaymentError) throw new HttpError(e.status === 401 ? 401 : 400, e.message); throw e; }
  if (!parsed) return { ignored: true };
  const o = await findByCharge(ctx, parsed.chargeId);
  if (!o) return { ignored: true, reason: "cobrança sem pedido" };
  await applyGatewayStatus(ctx, o, parsed.status, cfg.gateway);
  return { ok: true, orderId: o.id, status: parsed.status };
}

/** Resumo para a tela de pagamentos. */
export async function paymentsReport(ctx: Ctx, days: number) {
  const since = new Date(+ctx.deps.now() - days * 864e5).toISOString();
  const os = (await ctx.deps.db.list<O>("orders", ctx.tenantId, { since, limit: 5000 })).filter((o) => o.payment.online);
  const sum = (f: (o: O) => boolean) => { const l = os.filter(f); return { count: l.length, amount: Math.round(l.reduce((a, o) => a + o.total, 0) * 100) / 100 }; };
  const paid = sum((o) => o.payment.online!.status === "paid"), refunded = sum((o) => o.payment.online!.status === "refunded");
  const failed = sum((o) => ["failed", "expired"].includes(o.payment.online!.status)), pending = sum((o) => o.payment.online!.status === "pending");
  const attempts = paid.count + refunded.count + failed.count;
  return {
    totals: { paid, refunded, failed, pending, approvalRate: attempts ? Math.round(((paid.count + refunded.count) / attempts) * 1000) / 10 : 0, pix: sum((o) => o.payment.online!.method === "pix" && o.payment.online!.status === "paid"), card: sum((o) => o.payment.online!.method === "card" && o.payment.online!.status === "paid") },
    rows: os.map((o) => ({ orderId: o.id, displayId: o.displayId, createdAt: o.createdAt, total: o.total, orderStatus: o.status, ...o.payment.online! })),
  };
}
