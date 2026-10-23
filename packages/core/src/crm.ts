import { r2 } from "./pricing";
import { FUNNEL, type Customer, type FunnelEvent, type RfmSegment, type Segment, type SegmentRule, type TrackEvent } from "./types";

export const FUNNEL_LABEL: Record<FunnelEvent, string> = {
  visit: "Visita", item_view: "Abriu item", add_to_cart: "Adicionou", cart_view: "Sacola", checkout_start: "Revisão", order_placed: "Pedido",
};

export interface FunnelRow { stage: FunnelEvent; label: string; sessions: number; pctOfVisits: number; pctOfPrev: number; dropFromPrev: number }

/** Funil por sessão: cada sessão conta uma vez por etapa (etapas posteriores implicam as anteriores). */
export function funnel(events: Pick<TrackEvent, "sessionId" | "name">[]): FunnelRow[] {
  const deepest = new Map<string, number>();
  for (const e of events) {
    const i = FUNNEL.indexOf(e.name as FunnelEvent);
    if (i < 0) continue;
    deepest.set(e.sessionId, Math.max(deepest.get(e.sessionId) ?? -1, i));
  }
  const counts = FUNNEL.map((_, i) => [...deepest.values()].filter((d) => d >= i).length);
  return FUNNEL.map((stage, i) => ({
    stage, label: FUNNEL_LABEL[stage], sessions: counts[i],
    pctOfVisits: counts[0] ? r2((counts[i] / counts[0]) * 100) : 0,
    pctOfPrev: i === 0 ? 100 : counts[i - 1] ? r2((counts[i] / counts[i - 1]) * 100) : 0,
    dropFromPrev: i === 0 ? 0 : counts[i - 1] - counts[i],
  }));
}

/** Funil quebrado por uma dimensão (origem, perfil, dispositivo). */
export function funnelBy<K extends string>(events: TrackEvent[], key: (e: TrackEvent) => K | undefined) {
  const sessionKey = new Map<string, K>();
  for (const e of events) if (e.name === "visit") { const k = key(e); if (k) sessionKey.set(e.sessionId, k); }
  const groups = new Map<K, TrackEvent[]>();
  for (const e of events) { const k = sessionKey.get(e.sessionId); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(e); }
  return [...groups.entries()].map(([k, ev]) => ({ key: k, rows: funnel(ev) }));
}

export interface OrderLite { customerId?: string; total: number; createdAt: string; items: number; status: string }

/** Indicadores do painel. */
export function kpis(orders: OrderLite[], customers: Customer[], events: TrackEvent[], now = new Date()) {
  const valid = orders.filter((o) => o.status !== "cancelled");
  const f = funnel(events);
  const revenue = valid.reduce((a, o) => a + o.total, 0);
  const byCustomer = new Map<string, OrderLite[]>();
  for (const o of valid) if (o.customerId) { if (!byCustomer.has(o.customerId)) byCustomer.set(o.customerId, []); byCustomer.get(o.customerId)!.push(o); }
  // 2º pedido em até 60 dias para clientes cuja 1ª compra foi há 60+ dias
  let cohort = 0, second = 0;
  const intervals: number[] = [];
  for (const list of byCustomer.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = new Date(list[0].createdAt);
    for (let i = 1; i < list.length; i++) intervals.push((+new Date(list[i].createdAt) - +new Date(list[i - 1].createdAt)) / 864e5);
    if ((+now - +first) / 864e5 >= 60) { cohort++; if (list[1] && (+new Date(list[1].createdAt) - +first) / 864e5 <= 60) second++; }
  }
  return {
    visits: f[0].sessions,
    orders: valid.length,
    conversion: f[0].sessions ? r2((f[5].sessions / f[0].sessions) * 100) : 0,
    revenue: r2(revenue),
    avgTicket: valid.length ? r2(revenue / valid.length) : 0,
    upt: valid.length ? r2(valid.reduce((a, o) => a + o.items, 0) / valid.length) : 0,
    secondOrderRate60d: cohort ? r2((second / cohort) * 100) : 0,
    secondOrderCohort: cohort,
    repeatCustomers: [...byCustomer.values()].filter((l) => l.length > 1).length,
    avgIntervalDays: intervals.length ? r2(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0,
    activeCustomers90d: customers.filter((c) => c.lastOrderAt && (+now - +new Date(c.lastOrderAt)) / 864e5 <= 90).length,
    funnel: f,
  };
}

/** RFM simples por quintis de recência e frequência (padrão de mercado em CRM de e-commerce). */
export function rfm(c: Pick<Customer, "orders" | "spent" | "lastOrderAt" | "firstOrderAt">, now = new Date()): RfmSegment {
  if (!c.orders || !c.lastOrderAt) return "novos";
  const days = (+now - +new Date(c.lastOrderAt)) / 864e5;
  const r = days <= 15 ? 5 : days <= 30 ? 4 : days <= 60 ? 3 : days <= 120 ? 2 : 1;
  const f = c.orders >= 10 ? 5 : c.orders >= 6 ? 4 : c.orders >= 3 ? 3 : c.orders === 2 ? 2 : 1;
  if (r >= 4 && f >= 4) return "campeoes";
  if (r >= 3 && f >= 3) return "fieis";
  if (r >= 4 && f <= 2) return c.orders === 1 ? "novos" : "promissores";
  if (r === 3 && f <= 2) return "promissores";
  if (r === 2 && f >= 2) return "em_risco";
  if (r === 2) return "hibernando";
  return f >= 3 ? "em_risco" : "perdidos";
}
export const RFM_LABEL: Record<RfmSegment, string> = { campeoes: "Campeões", fieis: "Fiéis", promissores: "Promissores", novos: "Novos", em_risco: "Em risco", hibernando: "Hibernando", perdidos: "Perdidos" };

export function daysSince(iso?: string, now = new Date()) { return iso ? Math.floor((+now - +new Date(iso)) / 864e5) : undefined; }

export function matchRule(rule: SegmentRule, c: Customer, now = new Date()): boolean {
  const avg = c.orders ? c.spent / c.orders : 0;
  const cmp = (a: number, op: string, b: number) => (op === ">=" ? a >= b : op === "<=" ? a <= b : a === b);
  switch (rule.field) {
    case "orders": return cmp(c.orders, rule.op, rule.value);
    case "days_since_last_order": { const d = daysSince(c.lastOrderAt, now); return d !== undefined && cmp(d, rule.op, rule.value); }
    case "spent": return cmp(c.spent, rule.op, rule.value);
    case "avg_ticket": return cmp(avg, rule.op, rule.value);
    case "rfm": return rule.value.includes(rfm(c, now));
    case "source": return !!c.source && rule.value.includes(c.source);
    case "optin_whatsapp": return !!c.optinWhatsapp === rule.value;
    case "tag": return (c.tags || []).some((t) => rule.value.includes(t));
  }
}
export const inSegment = (s: Segment, c: Customer, now = new Date()) => s.rules.every((r) => matchRule(r, c, now));
