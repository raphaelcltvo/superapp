import { detectProfile, pickBanner, walletBalance, hasVariablePrice, type Customer, type Order, type ProfileKey, type Store, type Weekday } from "@cw/core";
import type { Ctx } from "./ctx";
import type { Snapshot } from "./catalog";
import { customerContext, ledgerOf } from "./customers";

/** Dia da semana e minuto do dia no fuso da marca. */
export function localClock(now: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")!.value) as Weekday;
  const h = Number(p.find((x) => x.type === "hour")!.value) % 24, m = Number(p.find((x) => x.type === "minute")!.value);
  return { weekday: wd, minutes: h * 60 + m };
}
export function isOpen(store: Store, now: Date, tz: string) {
  if (store.status !== "live") return false;
  const { weekday, minutes } = localClock(now, tz);
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  return store.hours.some((w) => {
    const o = toMin(w.open), c = toMin(w.close);
    if (c > o) return w.weekday === weekday && minutes >= o && minutes < c;
    return (w.weekday === weekday && minutes >= o) || (w.weekday === ((weekday + 6) % 7) && minutes < c); // vira a meia-noite
  });
}

export interface VisitorInput { storeId?: string; source?: string; customer?: Customer | null; sessionId?: string }

export async function resolveMenu(ctx: Ctx, snap: Snapshot, v: VisitorInput) {
  const now = ctx.deps.now();
  const store = snap.stores.find((s) => s.id === v.storeId) || snap.stores.find((s) => s.status === "live") || snap.stores[0];
  const cctx = await customerContext(ctx, v.customer || null);
  const visitor = { now, source: v.source, customer: v.customer ? { orders: cctx.orders, lastOrderAt: v.customer.lastOrderAt, spent: v.customer.spent } : undefined, segmentIds: cctx.segmentIds };
  const profile: ProfileKey = detectProfile(visitor);
  const visibleCats = snap.categories.filter((c) => c.visible);
  const order = snap.merch.categoryOrderByProfile[profile] || snap.merch.categoryOrderByProfile.qualquer;
  const cats = [...visibleCats].sort((a, b) => {
    const ia = order?.indexOf(a.id) ?? -1, ib = order?.indexOf(b.id) ?? -1;
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    return a.position - b.position;
  });
  const items = snap.items.filter((i) => i.active && visibleCats.some((c) => c.id === i.categoryId));
  const G = Object.fromEntries(snap.groups.map((g) => [g.id, g]));
  const usedGroups = new Set(items.flatMap((i) => i.groupIds));

  // card do topo por perfil
  let hero: unknown = null;
  const rule = snap.merch.heroRules.filter((r) => r.active && (r.profile === profile || r.profile === "qualquer")).sort((a, b) => a.priority - b.priority)[0];
  if (rule) {
    if (rule.action.kind === "reorder" && v.customer) {
      const last = (await ctx.deps.db.list<Order & { id: string }>("orders", ctx.tenantId, { where: { customerId: v.customer.id }, limit: 1 }))[0];
      if (last) hero = { kicker: rule.kicker, title: last.lines.map((l) => (l.qty > 1 ? `${l.qty}× ` : "") + l.name).join(" + "), sub: rule.sub, action: { kind: "reorder", orderId: last.id, lines: last.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, selection: l.choices.reduce<Record<string, Record<string, number>>>((s, c) => { (s[c.groupId] ||= {})[c.optionId] = c.qty; return s; }, {}), notes: l.notes })) } };
    } else if (rule.action.kind === "open_item") hero = { kicker: rule.kicker, title: rule.title, sub: rule.sub, action: rule.action };
  }

  // mais pedidos: automático pelos últimos 30 dias, com reserva manual
  let mostIds = snap.merch.mostOrdered.itemIds || [];
  if (snap.merch.mostOrdered.auto) {
    const since = new Date(+now - 30 * 864e5).toISOString();
    const recent = await ctx.deps.db.list<Order & { id: string }>("orders", ctx.tenantId, { since, limit: 2000 });
    const count = new Map<string, number>();
    for (const o of recent) if (o.status !== "cancelled") for (const l of o.lines) count.set(l.itemId, (count.get(l.itemId) || 0) + l.qty);
    const auto = [...count.entries()].filter(([id]) => items.some((i) => i.id === id)).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (auto.length >= 3) mostIds = auto.slice(0, 6);
  }

  const banners = {
    menu_top: pickBanner(snap.banners, "menu_top", visitor, profile),
    below_suggested: pickBanner(snap.banners, "below_suggested", visitor, profile),
    bag: pickBanner(snap.banners, "bag", visitor, profile),
    after_order: pickBanner(snap.banners, "after_order", visitor, profile),
  };
  const wallet = v.customer ? walletBalance(await ledgerOf(ctx, v.customer.id), now) : null;
  const couponsById = Object.fromEntries(snap.coupons.map((c) => [c.id, c]));
  const clientStrategies = snap.strategies.filter((s) => s.active).map((s) => ({ ...s, coupon: s.action.kind === "popup_coupon" ? (({ id, name, code, type, value, maxDiscount, minSubtotal }) => ({ id, name, code, type, value, maxDiscount, minSubtotal }))(couponsById[(s.action as { couponId: string }).couponId] || ({} as never)) : undefined }));
  return {
    tenant: snap.tenant,
    store: store && { id: store.id, name: store.name, address: store.address, phone: store.phone, open: isOpen(store, now, snap.tenant.settings.timezone), modes: store.modes, payments: store.payments.filter((p) => p.active).map(({ code, label, online }) => ({ code, label, online })), eta: store.zones.filter((z) => z.active).map((z) => [z.etaMin, z.etaMax]).sort((a, b) => a[0] - b[0])[0], hours: store.hours },
    profile,
    hero,
    banners,
    mostOrdered: snap.merch.mostOrdered.enabled ? { title: snap.merch.mostOrdered.title, itemIds: mostIds.filter((id) => items.some((i) => i.id === id)) } : null,
    categories: cats.map((c) => ({ id: c.id, name: c.name, description: c.description, pricingLocked: !!c.pricingLocked, itemIds: items.filter((i) => i.categoryId === c.id).sort((a, b) => a.position - b.position).map((i) => i.id) })).filter((c) => c.itemIds.length),
    items: Object.fromEntries(items.map((i) => [i.id, { ...i, fromPrice: hasVariablePrice(i, i.groupIds.map((g) => G[g]).filter(Boolean)) }])),
    groups: Object.fromEntries([...usedGroups].filter((g) => G[g]).map((g) => [g, { ...G[g], options: G[g].options.filter((o) => o.active) }])),
    crossSell: snap.merch.crossSell.filter((r) => r.active),
    strategies: clientStrategies,
    hesitationHelpSeconds: snap.merch.hesitationHelpSeconds,
    searchInHeader: snap.merch.searchInHeader,
    loyalty: snap.loyalty.active ? { earnPercent: snap.loyalty.earnPercent, minRedeem: snap.loyalty.minRedeem, maxRedeemPercent: snap.loyalty.maxRedeemPercent, expiresInDays: snap.loyalty.expiresInDays } : null,
    customer: v.customer ? { id: v.customer.id, name: v.customer.name, orders: cctx.orders, daysSinceLastOrder: cctx.daysSinceLastOrder, wallet } : null,
    pages: snap.pages.filter((p) => p.active),
  };
}
