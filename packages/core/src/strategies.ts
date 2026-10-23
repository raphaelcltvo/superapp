import { r2 } from "./pricing";
import type { Condition, PricedLine, Item, Strategy, Weekday } from "./types";

export interface StrategyContext {
  now: Date;
  subtotal: number;
  lines: PricedLine[];
  items: Record<string, Item>;
  customerOrders: number;
  daysSinceLastOrder?: number; // undefined = nunca comprou
  segmentIds: string[];
  zoneId?: string;
  source?: string;
  mode: "DELIVERY" | "TAKEOUT";
  idleSecondsWithoutAdd?: number;
}

const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };

export function matchCondition(c: Condition, x: StrategyContext): boolean {
  switch (c.field) {
    case "subtotal": return c.op === ">=" ? x.subtotal >= c.value : x.subtotal < c.value;
    case "cart_has_item": return x.lines.some((l) => c.itemIds.includes(l.itemId));
    case "cart_has_category": return x.lines.some((l) => c.categoryIds.includes(x.items[l.itemId]?.categoryId));
    case "customer_orders": return c.op === "=" ? x.customerOrders === c.value : c.op === ">=" ? x.customerOrders >= c.value : x.customerOrders <= c.value;
    case "days_since_last_order": {
      const d = x.daysSinceLastOrder;
      if (d === undefined) return false;
      if (c.op === "between") return d >= c.min && d <= c.max;
      return c.op === ">=" ? d >= c.value : d <= c.value;
    }
    case "weekday": return c.values.includes(x.now.getDay() as Weekday);
    case "time": {
      const t = x.now.getHours() * 60 + x.now.getMinutes(), a = hm(c.from), b = hm(c.to);
      return a <= b ? t >= a && t < b : t >= a || t < b; // janela que vira a meia-noite
    }
    case "zone": return !!x.zoneId && c.zoneIds.includes(x.zoneId);
    case "segment": return c.segmentIds.some((s) => x.segmentIds.includes(s));
    case "source": return !!x.source && c.values.includes(x.source);
    case "mode": return c.values.includes(x.mode);
    case "idle_seconds_without_add": return (x.idleSecondsWithoutAdd ?? 0) >= c.value;
  }
}

export const isLive = (s: Strategy, now: Date) => s.active && (!s.startsAt || now >= new Date(s.startsAt)) && (!s.endsAt || now <= new Date(s.endsAt));
export const matches = (s: Strategy, x: StrategyContext) => isLive(s, x.now) && s.conditions.every((c) => matchCondition(c, x));

export interface FeeOutcome {
  deliveryFee: number;
  baseDeliveryFee: number;
  deliveryLabel?: string;
  fees: { label: string; amount: number; feeType: "MIN_ORDER_FEE" | "SERVICE_FEE"; strategyId: string }[];
  applied: string[];
  /** próxima conquista: "faltam R$ X para frete grátis" */
  progress?: { strategyId: string; label: string; missing: number; target: number; pct: number };
}

/**
 * Calcula frete e taxas a partir da taxa da zona e das estratégias.
 * Frete: a primeira estratégia de frete que bate (por prioridade) decide. Taxas de serviço: todas as que batem somam.
 */
export function applyStrategies(strategies: Strategy[], x: StrategyContext, zoneFee: number): FeeOutcome {
  const list = [...strategies].filter((s) => isLive(s, x.now)).sort((a, b) => a.priority - b.priority);
  const out: FeeOutcome = { deliveryFee: x.mode === "DELIVERY" ? zoneFee : 0, baseDeliveryFee: zoneFee, fees: [], applied: [] };
  let feeDecided = x.mode !== "DELIVERY";
  for (const s of list) {
    const ok = s.conditions.every((c) => matchCondition(c, x));
    if (s.action.kind === "delivery_fee" && !feeDecided && ok) {
      const a = s.action;
      out.deliveryFee = a.mode === "free" ? 0 : a.mode === "fixed" ? a.value ?? zoneFee : r2(zoneFee * (1 - (a.value ?? 0) / 100));
      out.deliveryLabel = a.label || (a.mode === "free" ? "Frete grátis" : undefined);
      out.applied.push(s.id);
      feeDecided = true;
    }
    if (s.action.kind === "service_fee" && ok) {
      out.fees.push({ label: s.action.label, amount: s.action.amount, feeType: s.action.feeType, strategyId: s.id });
      out.applied.push(s.id);
    }
  }
  // barra de progresso: estratégia de frete grátis que só falha pelo subtotal mínimo
  if (x.mode === "DELIVERY" && out.deliveryFee > 0) {
    for (const s of list) {
      if (s.action.kind !== "delivery_fee" || s.action.mode !== "free" || s.showProgress === false) continue;
      const sub = s.conditions.find((c) => c.field === "subtotal" && c.op === ">=") as { value: number } | undefined;
      if (!sub) continue;
      const others = s.conditions.filter((c) => !(c.field === "subtotal" && c.op === ">="));
      if (!others.every((c) => matchCondition(c, x))) continue;
      const missing = r2(sub.value - x.subtotal);
      if (missing > 0) { out.progress = { strategyId: s.id, label: s.progressLabel || "para frete grátis", missing, target: sub.value, pct: Math.min(100, Math.round((x.subtotal / sub.value) * 100)) }; break; }
    }
  }
  return out;
}

/** Pop-up de cupom por comportamento (avaliado no navegador a cada segundo). */
export function pickPopup(strategies: Strategy[], x: StrategyContext, alreadyShown: (s: Strategy) => boolean) {
  return [...strategies].sort((a, b) => a.priority - b.priority).find((s) => s.action.kind === "popup_coupon" && matches(s, x) && !alreadyShown(s));
}

/** Modelos prontos para o painel. */
export function strategyTemplates(): Omit<Strategy, "id">[] {
  return [
    { name: "Frete grátis acima de R$ 120", active: true, priority: 10, conditions: [{ field: "subtotal", op: ">=", value: 120 }], action: { kind: "delivery_fee", mode: "free" }, showProgress: true, progressLabel: "para ganhar frete grátis" },
    { name: "Frete grátis no 1º pedido", active: true, priority: 20, conditions: [{ field: "customer_orders", op: "=", value: 0 }], action: { kind: "delivery_fee", mode: "free", label: "Frete grátis no 1º pedido" } },
    { name: "Frete grátis para quem voltou entre 7 e 10 dias", active: true, priority: 30, conditions: [{ field: "days_since_last_order", op: "between", min: 7, max: 10 }], action: { kind: "delivery_fee", mode: "free", label: "Frete grátis: você voltou na hora certa" } },
    { name: "Frete grátis com item específico", active: false, priority: 40, conditions: [{ field: "cart_has_item", itemIds: [] }], action: { kind: "delivery_fee", mode: "free" } },
    { name: "Frete grátis de segunda a quarta, 18h–20h", active: false, priority: 50, conditions: [{ field: "weekday", values: [1, 2, 3] }, { field: "time", from: "18:00", to: "20:00" }], action: { kind: "delivery_fee", mode: "free" } },
    { name: "Taxa de serviço abaixo do pedido mínimo", description: "Não bloqueia a compra: abaixo do mínimo cobra a taxa; acima, some.", active: true, priority: 100, conditions: [{ field: "subtotal", op: "<", value: 50 }, { field: "mode", values: ["DELIVERY"] }], action: { kind: "service_fee", amount: 15, label: "Taxa de serviço", feeType: "MIN_ORDER_FEE" } },
    { name: "Cupom após 1 min sem adicionar (novos)", active: true, priority: 200, conditions: [{ field: "idle_seconds_without_add", value: 60 }, { field: "customer_orders", op: "=", value: 0 }], action: { kind: "popup_coupon", couponId: "", title: "Ganhe 10% agora", text: "Use no seu primeiro pedido nos próximos 30 minutos.", position: "top-right", frequency: "session" } },
    { name: "Cupom após 1 min sem adicionar (sem comprar há 30+ dias)", active: true, priority: 210, conditions: [{ field: "idle_seconds_without_add", value: 60 }, { field: "days_since_last_order", op: ">=", value: 30 }], action: { kind: "popup_coupon", couponId: "", title: "Sentimos sua falta", text: "Um desconto para voltar hoje.", position: "top-right", frequency: "session" } },
  ];
}
