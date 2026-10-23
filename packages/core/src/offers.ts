import { r2 } from "./pricing";
import type { Coupon, PricedLine, Item } from "./types";

export interface CouponContext {
  now: Date;
  subtotal: number;
  lines: PricedLine[];
  items: Record<string, Item>;
  deliveryFee: number;
  customerOrders: number; // pedidos anteriores do cliente nesta marca
  customerUses: number; // usos deste cupom pelo cliente
  customerSegmentIds: string[];
  optinWhatsapp?: boolean;
}

export interface CouponResult { ok: boolean; discount: number; freeDelivery: boolean; reason?: string }

export function evaluateCoupon(c: Coupon, ctx: CouponContext): CouponResult {
  const no = (reason: string): CouponResult => ({ ok: false, discount: 0, freeDelivery: false, reason });
  if (!c.active) return no("Cupom inativo");
  if (c.validFrom && ctx.now < new Date(c.validFrom)) return no("Cupom ainda não começou");
  if (c.validTo && ctx.now > new Date(c.validTo)) return no("Cupom expirado");
  if (c.weekdays?.length && !c.weekdays.includes(ctx.now.getDay() as never)) return no("Cupom não vale hoje");
  if (c.maxUses != null && (c.uses || 0) >= c.maxUses) return no("Cupom esgotado");
  if (c.maxUsesPerCustomer != null && ctx.customerUses >= c.maxUsesPerCustomer) return no("Você já usou este cupom");
  if (c.firstOrderOnly && ctx.customerOrders > 0) return no("Válido só no primeiro pedido");
  if (c.segmentIds?.length && !c.segmentIds.some((s) => ctx.customerSegmentIds.includes(s))) return no("Cupom não disponível para você");
  if (c.requiresOptinWhatsapp && !ctx.optinWhatsapp) return no("Ative os avisos no WhatsApp para usar");
  // base elegível: itens/categorias restritos
  let base = ctx.subtotal;
  if (c.itemIds?.length || c.categoryIds?.length) {
    base = ctx.lines.filter((l) => c.itemIds?.includes(l.itemId) || c.categoryIds?.includes(ctx.items[l.itemId]?.categoryId)).reduce((a, l) => a + l.total, 0);
    if (!base) return no("Nenhum item elegível na sacola");
  }
  if (c.minSubtotal && ctx.subtotal < c.minSubtotal) return no(`Pedido mínimo de R$ ${c.minSubtotal.toFixed(2).replace(".", ",")}`);
  if (c.type === "free_delivery") return { ok: true, discount: 0, freeDelivery: true };
  let d = c.type === "percent" ? (base * c.value) / 100 : Math.min(c.value, base);
  if (c.maxDiscount) d = Math.min(d, c.maxDiscount);
  return { ok: true, discount: r2(d), freeDelivery: false };
}

/**
 * Ponto de equilíbrio de um desconto: quanto o volume precisa crescer para a margem total empatar.
 * c = desconto em fração do preço, m = margem de contribuição em fração. Fator = 1 / (1 - c/m).
 */
export function breakEven(discountFraction: number, margin: number) {
  if (margin <= 0 || discountFraction >= margin) return { factor: Infinity, extraPct: Infinity };
  const factor = 1 / (1 - discountFraction / margin);
  return { factor: r2(factor), extraPct: r2((factor - 1) * 100) };
}
