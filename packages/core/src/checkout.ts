import { priceLine, r2, validateSelection, type ValidationIssue } from "./pricing";
import { evaluateCoupon, type CouponResult } from "./offers";
import { applyStrategies, type FeeOutcome } from "./strategies";
import { cashbackEarn, cashbackRedeemable } from "./loyalty";
import { availableAt } from "./cuisines";
import type { CartLineInput, Category, Coupon, DeliveryZone, Item, LoyaltyProgram, OptionGroup, PricedLine, Strategy } from "./types";

export interface Catalog { items: Record<string, Item>; groups: Record<string, OptionGroup>; categories?: Record<string, Category> }

export interface QuoteInput {
  now: Date;
  lines: CartLineInput[];
  catalog: Catalog;
  mode: "DELIVERY" | "TAKEOUT";
  zone?: DeliveryZone;
  strategies: Strategy[];
  coupon?: Coupon;
  customer?: { orders: number; daysSinceLastOrder?: number; segmentIds: string[]; optinWhatsapp?: boolean; spend90d: number; walletBalance: number; couponUses?: number };
  loyalty?: LoyaltyProgram;
  useCashback?: boolean;
  source?: string;
  /** pedido agendado (ISO): janela de venda e encomenda são conferidas nessa data */
  scheduledFor?: string;
  tz?: string;
}

export interface Quote {
  lines: PricedLine[];
  issues: { line: number; issues: ValidationIssue[] }[];
  subtotal: number;
  coupon?: CouponResult & { id: string; name: string };
  discount: number;
  deliveryFee: number;
  baseDeliveryFee: number;
  deliveryLabel?: string;
  fees: FeeOutcome["fees"];
  progress?: FeeOutcome["progress"];
  applied: string[];
  cashbackAvailable: number;
  cashbackUsed: number;
  cashbackEarned: number;
  total: number;
  outOfArea: boolean;
}

export function quote(q: QuoteInput): Quote {
  const lines: PricedLine[] = [];
  const issues: Quote["issues"] = [];
  q.lines.forEach((l, i) => {
    const item = q.catalog.items[l.itemId];
    if (!item || !item.active || !item.available) { issues.push({ line: i, issues: [{ groupId: "", need: 0, message: "Item indisponível" }] }); return; }
    const groups = item.groupIds.map((g) => q.catalog.groups[g]).filter(Boolean);
    const when = q.scheduledFor ? new Date(q.scheduledFor) : q.now;
    const win = [item.availability, q.catalog.categories?.[item.categoryId]?.availability].map((a) => availableAt(a, when, q.tz)).find((r) => !r.ok);
    if (win) { issues.push({ line: i, issues: [{ groupId: "", need: 0, message: `${item.name}: ${win.label}` }] }); return; }
    if (item.leadTimeHours && +when < +q.now + item.leadTimeHours * 3600e3 - 60e3) {
      const first = new Date(+q.now + item.leadTimeHours * 3600e3);
      issues.push({ line: i, issues: [{ groupId: "", need: 0, message: `${item.name} é encomenda: agende para ${first.toLocaleString("pt-BR", { timeZone: q.tz || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ou depois` }] });
      return;
    }
    const v = validateSelection(item, groups, l.selection);
    if (v.length) issues.push({ line: i, issues: v });
    lines.push(priceLine(item, groups, l));
  });
  const subtotal = r2(lines.reduce((a, l) => a + l.total, 0));
  const c = q.customer || { orders: 0, segmentIds: [], spend90d: 0, walletBalance: 0 };
  const outOfArea = q.mode === "DELIVERY" && !q.zone;
  const fee = applyStrategies(q.strategies, { now: q.now, subtotal, lines, items: q.catalog.items, customerOrders: c.orders, daysSinceLastOrder: c.daysSinceLastOrder, segmentIds: c.segmentIds, zoneId: q.zone?.id, source: q.source, mode: q.mode }, q.zone?.fee ?? 0);
  let discount = 0, couponOut: Quote["coupon"];
  let deliveryFee = fee.deliveryFee;
  if (q.coupon) {
    const res = evaluateCoupon(q.coupon, { now: q.now, subtotal, lines, items: q.catalog.items, deliveryFee, customerOrders: c.orders, customerUses: c.couponUses || 0, customerSegmentIds: c.segmentIds, optinWhatsapp: c.optinWhatsapp });
    couponOut = { ...res, id: q.coupon.id, name: q.coupon.name };
    if (res.ok) { discount = res.discount; if (res.freeDelivery) deliveryFee = 0; }
  }
  const afterDiscount = r2(subtotal - discount);
  const cashbackAvailable = q.loyalty ? cashbackRedeemable(q.loyalty, c.walletBalance, afterDiscount) : 0;
  const cashbackUsed = q.useCashback ? cashbackAvailable : 0;
  const feesTotal = fee.fees.reduce((a, f) => a + f.amount, 0);
  const total = r2(Math.max(0, afterDiscount - cashbackUsed) + deliveryFee + feesTotal);
  const eligible = q.loyalty?.excludedCategoryIds?.length ? lines.filter((l) => !q.loyalty!.excludedCategoryIds!.includes(q.catalog.items[l.itemId]?.categoryId)).reduce((a, l) => a + l.total, 0) - discount : afterDiscount;
  const cashbackEarned = q.loyalty ? cashbackEarn(q.loyalty, Math.max(0, eligible - cashbackUsed), c.spend90d) : 0;
  return { lines, issues, subtotal, coupon: couponOut, discount, deliveryFee, baseDeliveryFee: fee.baseDeliveryFee, deliveryLabel: deliveryFee === 0 && fee.baseDeliveryFee > 0 ? fee.deliveryLabel || (couponOut?.freeDelivery ? "Frete grátis (cupom)" : "Frete grátis") : undefined, fees: fee.fees, progress: deliveryFee > 0 ? fee.progress : undefined, applied: fee.applied, cashbackAvailable, cashbackUsed, cashbackEarned, total, outOfArea };
}
