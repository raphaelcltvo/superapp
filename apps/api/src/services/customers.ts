import { inSegment, normPhone, r2, uid, walletBalance, daysSince, type Customer, type LedgerEntry, type Order, type Segment } from "@cw/core";
import type { Ctx } from "./ctx";

export async function findByPhone(ctx: Ctx, phone: string) {
  const p = normPhone(phone);
  if (!p) return null;
  const r = await ctx.deps.db.list<Customer & { id: string }>("customers", ctx.tenantId, { where: { phone: p }, limit: 1 });
  return r[0] || null;
}

export async function upsertCustomer(ctx: Ctx, data: Partial<Customer> & { phone?: string }): Promise<Customer> {
  const phone = normPhone(data.phone);
  const existing = phone ? await findByPhone(ctx, phone) : null;
  if (existing) {
    const merged = { ...existing, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== "")), phone: phone || existing.phone, id: existing.id } as Customer;
    if (data.externalIds) merged.externalIds = { ...existing.externalIds, ...data.externalIds };
    await ctx.deps.db.put("customers", ctx.tenantId, merged as never);
    return merged;
  }
  const c: Customer = { id: uid("cus"), orders: 0, spent: 0, createdAt: ctx.deps.now().toISOString(), ...data, phone } as Customer;
  await ctx.deps.db.put("customers", ctx.tenantId, c as never);
  return c;
}

/** Recalcula pedidos, gasto, primeira e última compra a partir dos pedidos válidos. */
export async function recomputeStats(ctx: Ctx, customerId: string) {
  const c = await ctx.deps.db.get<Customer & { id: string }>("customers", ctx.tenantId, customerId);
  if (!c) return null;
  const orders = (await ctx.deps.db.list<Order & { id: string }>("orders", ctx.tenantId, { where: { customerId } })).filter((o) => o.status !== "cancelled");
  const dates = orders.map((o) => o.createdAt).sort();
  const upd = { orders: orders.length, spent: r2(orders.reduce((a, o) => a + o.total, 0)), firstOrderAt: dates[0], lastOrderAt: dates[dates.length - 1] };
  return ctx.deps.db.patch<Customer & { id: string }>("customers", ctx.tenantId, customerId, upd);
}

export async function ledgerOf(ctx: Ctx, customerId: string) {
  return ctx.deps.db.list<LedgerEntry & { id: string }>("ledger", ctx.tenantId, { where: { customerId }, orderBy: { field: "createdAt" } });
}

export async function segmentIdsOf(ctx: Ctx, c: Customer) {
  const segs = await ctx.deps.db.list<Segment & { id: string }>("segments", ctx.tenantId);
  return segs.filter((s) => inSegment(s, c, ctx.deps.now())).map((s) => s.id);
}

/** Contexto do cliente para estratégias, cupons e cashback. */
export async function customerContext(ctx: Ctx, c: Customer | null, couponId?: string) {
  if (!c) return { orders: 0, segmentIds: [] as string[], spend90d: 0, walletBalance: 0, couponUses: 0 };
  const now = ctx.deps.now();
  const [ledger, segmentIds, orders] = await Promise.all([ledgerOf(ctx, c.id), segmentIdsOf(ctx, c), ctx.deps.db.list<Order & { id: string }>("orders", ctx.tenantId, { where: { customerId: c.id } })]);
  const valid = orders.filter((o) => o.status !== "cancelled");
  return {
    orders: valid.length,
    daysSinceLastOrder: daysSince(c.lastOrderAt, now),
    segmentIds,
    optinWhatsapp: c.optinWhatsapp,
    spend90d: r2(valid.filter((o) => (+now - +new Date(o.createdAt)) / 864e5 <= 90).reduce((a, o) => a + o.total, 0)),
    walletBalance: walletBalance(ledger, now).balance,
    couponUses: couponId ? valid.filter((o) => o.couponId === couponId).length : 0,
  };
}
