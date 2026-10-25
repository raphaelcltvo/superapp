import { quote, resolveZone, uid, r2, type Coupon, type Customer, type LedgerEntry, type Order, type OrderStatus, type Store } from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";
import type { CheckoutInput } from "../schemas";
import { catalogOf, publishedSnapshot, draftSnapshot, type Snapshot } from "./catalog";
import { customerContext, recomputeStats, upsertCustomer } from "./customers";
import { saiposConfig, emit } from "./integrations";
import { activePayments, chargeNewOrder, isOnlineCode, refundOrder } from "./payments";
import { SaiposClient } from "../integrations/saipos/client";
import { toSaiposOrder, EVENT_TO_STATUS } from "../integrations/saipos/mapper";
import { SaiposError, type SaiposEvent } from "../integrations/saipos/types";

export async function snapshotFor(ctx: Ctx, preview = false): Promise<Snapshot> {
  const s = preview ? await draftSnapshot(ctx) : await publishedSnapshot(ctx);
  if (!s) throw new HttpError(404, "Cardápio ainda não publicado");
  return s;
}

/** Cotação autoritativa: o cardápio do cliente mostra exatamente o que será cobrado. */
export async function quoteFor(ctx: Ctx, input: Omit<CheckoutInput, "payment"> & { payment?: CheckoutInput["payment"] }, customer: Customer | null, preview = false) {
  const snap = await snapshotFor(ctx, preview);
  const store = snap.stores.find((s) => s.id === input.storeId);
  if (!store) throw new HttpError(404, "Loja não encontrada");
  const zone = input.mode === "DELIVERY" && input.address?.lat != null && input.address?.lng != null
    ? resolveZone(store.zones, [input.address.lat, input.address.lng], store.address.lat != null ? [store.address.lat, store.address.lng!] : undefined)
    : input.mode === "DELIVERY" ? store.zones.find((z) => z.active) : undefined; // sem coordenadas: zona padrão (cotação prévia)
  const coupon = input.couponCode ? snap.coupons.find((c) => c.code && c.code.toUpperCase() === input.couponCode!.toUpperCase()) : undefined;
  if (input.couponCode && !coupon) throw new HttpError(422, "Cupom não encontrado");
  // usos atuais do cupom ficam no rascunho (contador vivo)
  const liveCoupon = coupon ? ((await ctx.deps.db.get<Coupon & { id: string }>("coupons", ctx.tenantId, coupon.id)) || coupon) : undefined;
  const cctx = await customerContext(ctx, customer, coupon?.id);
  const q = quote({ now: ctx.deps.now(), lines: input.lines, catalog: catalogOf(snap), mode: input.mode, zone, strategies: snap.strategies, coupon: liveCoupon, customer: cctx, loyalty: snap.loyalty, useCashback: input.useCashback, source: input.source, scheduledFor: input.scheduledFor, tz: snap.tenant.settings.timezone });
  return { q, snap, store, zone, coupon: liveCoupon };
}

async function nextDisplayId(ctx: Ctx) {
  const n = await ctx.deps.db.count("orders", ctx.tenantId);
  return String(1001 + n);
}

export async function placeOrder(ctx: Ctx, input: CheckoutInput, customerFromToken: Customer | null) {
  const now = ctx.deps.now();
  let customer = customerFromToken;
  if (input.customer) customer = await upsertCustomer(ctx, { ...input.customer, ...(customer ? { phone: customer.phone } : {}), source: customer?.source || input.source });
  if (!customer) throw new HttpError(422, "Informe nome e telefone");
  const { q, store, zone } = await quoteFor(ctx, input, customer);
  if (q.issues.length) throw new HttpError(422, "Revise os itens", q.issues);
  if (input.mode === "DELIVERY" && !input.address) throw new HttpError(422, "Informe o endereço de entrega");
  if (input.scheduledFor && (isNaN(+new Date(input.scheduledFor)) || +new Date(input.scheduledFor) < +now - 10 * 60e3)) throw new HttpError(422, "Horário agendado inválido ou já passou");
  if (input.mode === "DELIVERY" && q.outOfArea) throw new HttpError(422, "Endereço fora da área de entrega");
  if (input.couponCode && q.coupon && !q.coupon.ok) throw new HttpError(422, q.coupon.reason || "Cupom inválido");
  const pay = await activePayments(ctx);
  const online = !!pay && isOnlineCode(input.payment.code) && (input.payment.code === "CARD_ONLINE" ? pay.cfg.methods.card : pay.cfg.methods.pix);
  if (input.payment.code === "CARD_ONLINE" && !online) throw new HttpError(422, "Cartão online indisponível");
  if (!online && !store.payments.some((p) => p.active && p.code === input.payment.code)) throw new HttpError(422, "Forma de pagamento indisponível");
  if (online && pay!.cfg.captureOnlyIfStoreOpen && store.status !== "live") throw new HttpError(422, "Loja fechada no momento");
  if (input.customerDocument) customer = await upsertCustomer(ctx, { phone: customer.phone, document: input.customerDocument.replace(/\D/g, "") });
  const order: Order = {
    id: uid("ord"), displayId: await nextDisplayId(ctx), storeId: store.id, customerId: customer.id, sessionId: input.sessionId, mode: input.mode,
    lines: q.lines, subtotal: q.subtotal, discount: q.discount, deliveryFee: q.deliveryFee, baseDeliveryFee: q.baseDeliveryFee, fees: q.fees.map(({ label, amount, feeType }) => ({ label, amount, feeType })), strategiesApplied: q.applied,
    cashbackUsed: q.cashbackUsed, total: q.total, cashbackEarned: q.cashbackEarned, couponId: q.coupon?.ok ? q.coupon.id : undefined,
    payment: { code: input.payment.code, changeFor: input.payment.changeFor }, address: input.address as Order["address"], notes: input.notes, scheduledFor: input.scheduledFor,
    status: online ? "awaiting_payment" : "created", statusHistory: [{ status: online ? "awaiting_payment" : "created", at: now.toISOString(), by: "cliente" }], source: input.source, createdAt: now.toISOString(),
  };
  if (online) {
    // cobra antes de gravar: cartão recusado não vira pedido
    order.payment.online = await chargeNewOrder(ctx, order, customer, input.payment.code === "CARD_ONLINE" ? { token: input.payment.cardToken || "", installments: input.payment.installments || 1, brand: input.payment.cardBrand, last4: input.payment.cardLast4, issuerId: input.payment.issuerId } : undefined);
    if (order.payment.online.status === "failed") {
      await ctx.deps.db.events.insert(ctx.tenantId, [{ id: uid("ev"), sessionId: input.sessionId || order.id, customerId: customer.id, name: "payment_declined", ts: now.toISOString(), source: input.source, props: { reason: order.payment.online.failureReason } }]);
      throw new HttpError(402, order.payment.online.failureReason || "Pagamento recusado");
    }
    if (order.payment.online.status === "paid") { order.status = "created"; order.statusHistory.push({ status: "created", at: now.toISOString(), by: order.payment.online.gateway, note: "Cartão aprovado" }); }
  }
  (order as Order & { zoneId?: string }).zoneId = zone?.id;
  await ctx.deps.db.put("orders", ctx.tenantId, order as never);
  if (order.cashbackUsed > 0) await ctx.deps.db.put("ledger", ctx.tenantId, { id: uid("led"), customerId: customer.id, type: "redeem", amount: -order.cashbackUsed, orderId: order.id, createdAt: order.createdAt } as never);
  if (order.couponId) { const c = await ctx.deps.db.get<Coupon & { id: string }>("coupons", ctx.tenantId, order.couponId); if (c) await ctx.deps.db.patch("coupons", ctx.tenantId, c.id, { uses: (c.uses || 0) + 1 }); }
  await recomputeStats(ctx, customer.id);
  await ctx.deps.db.events.insert(ctx.tenantId, [{ id: uid("ev"), sessionId: input.sessionId || order.id, customerId: customer.id, name: "order_placed", ts: order.createdAt, source: input.source, props: { orderId: order.id, total: order.total } }]);
  await emit(ctx, "order.created", order);
  if (order.status === "awaiting_payment") return { order, customer }; // a SAIPOS só recebe depois do pagamento
  const cfg = await saiposConfig(ctx, store.id);
  if (cfg?.enabled && cfg.autoSend) return { order: await sendToPos(ctx, order.id), customer };
  return { order, customer };
}

export async function sendToPos(ctx: Ctx, orderId: string) {
  const order = await ctx.deps.db.get<Order & { id: string }>("orders", ctx.tenantId, orderId);
  if (!order) throw new HttpError(404, "Pedido não encontrado");
  const cfg = await saiposConfig(ctx, order.storeId);
  if (!cfg?.enabled) throw new HttpError(422, "Integração SAIPOS desligada para esta loja");
  const store = await ctx.deps.db.get<Store & { id: string }>("stores", ctx.tenantId, order.storeId);
  const customer = order.customerId ? await ctx.deps.db.get<Customer & { id: string }>("customers", ctx.tenantId, order.customerId) : null;
  const { payload, issues } = toSaiposOrder(order, customer, store!, cfg);
  const blocking = issues.filter((i) => i.field !== "total_amount");
  const at = ctx.deps.now().toISOString();
  if (blocking.length) {
    return (await ctx.deps.db.patch<Order & { id: string }>("orders", ctx.tenantId, order.id, { status: "pos_error", pos: { provider: "saipos", error: blocking.map((i) => i.message).join("; "), payload }, statusHistory: [...order.statusHistory, { status: "pos_error", at, by: "saipos", note: "Dados incompletos para o PDV" }] }))!;
  }
  try {
    const response = await new SaiposClient(cfg, ctx.deps.saiposFetch).createOrder(payload);
    return (await ctx.deps.db.patch<Order & { id: string }>("orders", ctx.tenantId, order.id, { status: "sent_to_pos", pos: { provider: "saipos", sentAt: at, payload, response }, statusHistory: [...order.statusHistory, { status: "sent_to_pos", at, by: "saipos" }] }))!;
  } catch (e) {
    const msg = e instanceof SaiposError ? `${e.code ?? e.status}: ${e.message}` : String(e);
    if (e instanceof SaiposError && e.code === 904) // já importado: idempotente
      return (await ctx.deps.db.patch<Order & { id: string }>("orders", ctx.tenantId, order.id, { status: "sent_to_pos", pos: { provider: "saipos", sentAt: at, payload, response: { alreadyImported: true } } }))!;
    return (await ctx.deps.db.patch<Order & { id: string }>("orders", ctx.tenantId, order.id, { status: "pos_error", pos: { provider: "saipos", error: msg, payload }, statusHistory: [...order.statusHistory, { status: "pos_error", at, by: "saipos", note: msg }] }))!;
  }
}

/** Muda o status, credita/estorna cashback e avisa a SAIPOS quando a entrega é do parceiro. */
export async function changeStatus(ctx: Ctx, orderId: string, status: OrderStatus, by: string, note?: string) {
  const order = await ctx.deps.db.get<Order & { id: string }>("orders", ctx.tenantId, orderId);
  if (!order) throw new HttpError(404, "Pedido não encontrado");
  if (order.status === status) return order;
  const at = ctx.deps.now().toISOString();
  const upd = await ctx.deps.db.patch<Order & { id: string }>("orders", ctx.tenantId, orderId, { status, statusHistory: [...order.statusHistory, { status, at, by, note }] });
  const snap = await publishedSnapshot(ctx);
  if (status === "concluded" && order.customerId && order.cashbackEarned > 0) {
    const exp = new Date(+ctx.deps.now() + (snap?.loyalty.expiresInDays || 60) * 864e5).toISOString();
    await ctx.deps.db.put("ledger", ctx.tenantId, { id: uid("led"), customerId: order.customerId, type: "earn", amount: order.cashbackEarned, orderId, createdAt: at, expiresAt: exp } as LedgerEntry as never);
  }
  if (status === "cancelled" && order.payment.online?.status === "paid") {
    try { await refundOrder(ctx, orderId, undefined, by); } catch (e) { ctx.deps.log?.("estorno automático falhou", String(e)); }
  }
  if (status === "cancelled" && order.customerId) {
    const entries = await ctx.deps.db.list<LedgerEntry & { id: string }>("ledger", ctx.tenantId, { where: { orderId } });
    const net = r2(entries.reduce((a, e) => a + e.amount, 0));
    if (net !== 0) await ctx.deps.db.put("ledger", ctx.tenantId, { id: uid("led"), customerId: order.customerId, type: "reverse", amount: -net, orderId, createdAt: at, note: "Pedido cancelado" } as never);
    await recomputeStats(ctx, order.customerId);
  }
  const cfg = await saiposConfig(ctx, order.storeId);
  if (cfg?.enabled && by !== "saipos" && order.pos?.sentAt && cfg.deliveryBy === "PARTNER" && ["dispatched", "concluded", "cancelled"].includes(status)) {
    const client = new SaiposClient(cfg, ctx.deps.saiposFetch);
    try { await client.updateStatus(order.id, status.toUpperCase() as "DISPATCHED"); } catch (e) { ctx.deps.log?.("saipos update-order-status falhou", String(e)); }
  } else if (cfg?.enabled && by !== "saipos" && order.pos?.sentAt && status === "cancelled") {
    try { await new SaiposClient(cfg, ctx.deps.saiposFetch).cancel(order.id); } catch (e) { ctx.deps.log?.("saipos cancel-order falhou", String(e)); }
  }
  await emit(ctx, "order.status", { id: orderId, status });
  return upd;
}

export async function onSaiposEvent(ctx: Ctx, body: { event: SaiposEvent; cod_store: string; order_id: string }) {
  const status = EVENT_TO_STATUS[body.event];
  if (!status) throw new HttpError(400, "Evento desconhecido");
  return changeStatus(ctx, body.order_id, status, "saipos");
}
