import { BRL, type Customer, type Order, type OrderStatus, type Store } from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";
import { changeStatus, sendToPos } from "./orders";
import { saiposConfig } from "./integrations";
import { ordersSettings, type OrdersSettings } from "./ordersettings";

type O = Order & { id: string; prepMinutes?: number; imported?: boolean; rejectReason?: string };

export type Column = "novos" | "agendados" | "em_preparo" | "prontos" | "em_rota" | "concluidos";
export const COLUMNS: Column[] = ["novos", "agendados", "em_preparo", "prontos", "em_rota", "concluidos"];

export interface BoardCard {
  id: string; displayId: string; createdAt: string; scheduledFor?: string; status: OrderStatus; column: Column;
  customer: { name?: string; phone?: string; orders: number }; isFirstOrder: boolean;
  mode: "DELIVERY" | "TAKEOUT"; address?: string; addressFull?: string;
  lines: { qty: number; name: string; choices: { qty: number; name: string; free?: boolean; fraction?: string; extra?: number }[]; notes?: string; total: number }[];
  subtotal: number; discount: number; deliveryFee: number; fees: { label: string; amount: number }[]; cashbackUsed: number; total: number;
  payment: { code: string; changeFor?: number; online?: string; paid: boolean; line: string };
  notes?: string;
  /** início da fase atual (para o cronômetro) e o tempo esperado dela */
  phaseStartedAt: string; minutesInStatus: number; slaMinutes?: number; late: boolean;
  dueAt?: string; posError?: string; source?: string;
}

const PAY: Record<string, string> = { CARD_ON_DELIVERY: "cartão", CREDIT_ON_DELIVERY: "crédito", DEBIT_ON_DELIVERY: "débito", VR_VA: "VR/VA", CASH: "dinheiro", PIX_ONLINE: "Pix", CARD_ONLINE: "cartão" };

/** "Levar maquininha · crédito (Visa, Master)", "Dinheiro · troco para R$ 100,00", "Pago online · Pix". */
export function paymentLine(o: Order, store?: Store | null) {
  const on = o.payment.online;
  if (on) return on.status === "paid" ? `Pago online · ${on.method === "pix" ? "Pix" : `cartão${on.card?.brand ? " " + on.card.brand : ""}`}` : on.status === "refunded" ? "Estornado" : "Aguardando pagamento online";
  if (o.payment.code === "CASH") return o.payment.changeFor && o.payment.changeFor > o.total ? `Dinheiro · troco para ${BRL(o.payment.changeFor)} (levar ${BRL(o.payment.changeFor - o.total)})` : "Dinheiro · sem troco";
  const brands = store?.payments.find((p) => p.code === o.payment.code)?.brands;
  return `Levar maquininha · ${PAY[o.payment.code] || o.payment.code}${brands?.length ? ` (${brands.slice(0, 4).join(", ")})` : ""}`;
}

const minutes = (from: string, now: Date) => Math.max(0, Math.floor((+now - +new Date(from)) / 60000));
const startOfDay = (now: Date) => { const d = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })); const off = +now - +d; d.setHours(0, 0, 0, 0); return new Date(+d + off); };

export function columnOf(o: O, now: Date, st: OrdersSettings): Column | null {
  if (["awaiting_payment", "payment_failed"].includes(o.status)) return null;
  if (o.status === "concluded" || o.status === "cancelled") return "concluidos";
  const lead = (o.prepMinutes || st.prepMinutes) + (o.mode === "DELIVERY" ? st.deliveryMinutes : 0);
  if (o.scheduledFor && +new Date(o.scheduledFor) - +now > lead * 60000 && ["created", "confirmed", "sent_to_pos", "pos_error"].includes(o.status)) return "agendados";
  if (o.status === "created" || o.status === "pos_error") return "novos";
  if (o.status === "confirmed" || o.status === "sent_to_pos") return "em_preparo";
  if (o.status === "ready") return o.mode === "DELIVERY" ? "prontos" : "prontos";
  if (o.status === "dispatched") return "em_rota";
  return null;
}

function card(o: O, col: Column, now: Date, st: OrdersSettings, cust: Customer | null, store: Store | null): BoardCard {
  const last = o.statusHistory[o.statusHistory.length - 1];
  const phaseStartedAt = last?.at || o.createdAt;
  const sla = col === "novos" ? st.lateAfterMinutes : col === "em_preparo" ? o.prepMinutes || st.prepMinutes : col === "prontos" ? st.lateAfterMinutes : col === "em_rota" ? st.deliveryMinutes : undefined;
  const mins = minutes(phaseStartedAt, now);
  const promise = (o.prepMinutes || st.prepMinutes) + (o.mode === "DELIVERY" ? st.deliveryMinutes : 0);
  const a = o.address;
  return {
    id: o.id, displayId: o.displayId, createdAt: o.createdAt, scheduledFor: o.scheduledFor, status: o.status, column: col,
    customer: { name: cust?.name, phone: cust?.phone, orders: cust?.orders || 0 }, isFirstOrder: !!cust && cust.orders <= 1,
    mode: o.mode, address: a ? `${a.street}, ${a.number}${a.complement ? ` · ${a.complement}` : ""} · ${a.district}` : undefined,
    addressFull: a ? `${a.street}, ${a.number}${a.complement ? ` · ${a.complement}` : ""} · ${a.district} · ${a.city}/${a.state}${a.reference ? ` · ref.: ${a.reference}` : ""}` : undefined,
    lines: o.lines.map((l) => ({ qty: l.qty, name: l.name, notes: l.notes, total: l.total, choices: l.choices.map((c) => ({ qty: c.qty, name: c.name, free: c.free, fraction: c.fraction && c.fraction !== "inteira" ? c.fraction : undefined, extra: c.unitDelta || undefined })) })),
    subtotal: o.subtotal, discount: o.discount, deliveryFee: o.deliveryFee, fees: (o.fees || []).map((f) => ({ label: f.label, amount: f.amount })), cashbackUsed: o.cashbackUsed, total: o.total,
    payment: { code: o.payment.code, changeFor: o.payment.changeFor, online: o.payment.online?.method, paid: o.payment.online?.status === "paid", line: paymentLine(o, store) },
    notes: o.notes, phaseStartedAt, minutesInStatus: mins, slaMinutes: sla, late: sla != null && mins > sla,
    dueAt: col === "concluidos" ? undefined : new Date(+new Date(o.scheduledFor || o.createdAt) + (o.scheduledFor ? 0 : promise * 60000)).toISOString(),
    posError: o.status === "pos_error" ? o.pos?.error : undefined, source: o.source,
  };
}

/** Quadro do gestor: pedidos ativos por coluna e os concluídos de hoje. `cursor` muda só quando algum pedido muda. */
export async function board(ctx: Ctx, opts: { storeId?: string; cursor?: string } = {}) {
  const now = ctx.deps.now();
  const st = await ordersSettings(ctx);
  const since = new Date(+now - 35 * 864e5).toISOString();
  let rows = (await ctx.deps.db.list<O>("orders", ctx.tenantId, { since, limit: 2000 })).filter((o) => !o.imported);
  if (opts.storeId) rows = rows.filter((o) => o.storeId === opts.storeId);
  const today = startOfDay(now).toISOString();
  const placed = rows.map((o) => ({ o, col: columnOf(o, now, st) })).filter((x) => x.col && !(x.col === "concluidos" && (x.o.statusHistory[x.o.statusHistory.length - 1]?.at || x.o.createdAt) < today));
  const sig = placed.map(({ o, col }) => `${o.id}:${o.status}:${o.statusHistory.length}:${col}`).sort().join("|") + "|" + today.slice(0, 10) + "|" + JSON.stringify(st);
  let h = 2166136261; for (let i = 0; i < sig.length; i++) h = Math.imul(h ^ sig.charCodeAt(i), 16777619);
  const cursor = (h >>> 0).toString(36) + "." + placed.length;
  if (opts.cursor && opts.cursor === cursor) return { unchanged: true as const, cursor, now: now.toISOString() };
  const custIds = [...new Set(placed.map((x) => x.o.customerId).filter(Boolean) as string[])];
  const custs = Object.fromEntries((await Promise.all(custIds.map((id) => ctx.deps.db.get<Customer & { id: string }>("customers", ctx.tenantId, id)))).filter(Boolean).map((c) => [c!.id, c!]));
  const stores = Object.fromEntries((await ctx.deps.db.list<Store & { id: string }>("stores", ctx.tenantId)).map((s) => [s.id, s]));
  const columns = Object.fromEntries(COLUMNS.map((c) => [c, [] as BoardCard[]])) as Record<Column, BoardCard[]>;
  for (const { o, col } of placed) columns[col!].push(card(o, col!, now, st, o.customerId ? custs[o.customerId] || null : null, stores[o.storeId] || null));
  const byTime = (a: BoardCard, b: BoardCard) => a.createdAt.localeCompare(b.createdAt);
  for (const c of COLUMNS) columns[c].sort(c === "agendados" ? (a, b) => (a.scheduledFor || "").localeCompare(b.scheduledFor || "") : c === "concluidos" ? (a, b) => b.phaseStartedAt.localeCompare(a.phaseStartedAt) : byTime);
  columns.concluidos = columns.concluidos.slice(0, 30);
  const pending = rows.filter((o) => o.status === "awaiting_payment").length;
  return { unchanged: false as const, cursor, now: now.toISOString(), settings: st, columns, counts: Object.fromEntries(COLUMNS.map((c) => [c, columns[c].length])), awaitingPayment: pending, stores: Object.values(stores).map((s) => ({ id: s.id, name: s.name, status: s.status, pausedReason: s.pausedReason })) };
}

/** Aceitar: SAIPOS ligada sem envio automático → manda ao PDV; senão, confirma (em preparo). */
export async function acceptOrder(ctx: Ctx, id: string, by: string, prepMinutes?: number) {
  const o = await ctx.deps.db.get<O>("orders", ctx.tenantId, id);
  if (!o) throw new HttpError(404, "Pedido não encontrado");
  if (!["created", "pos_error"].includes(o.status)) throw new HttpError(409, "Pedido já foi aceito ou encerrado");
  if (prepMinutes) await ctx.deps.db.patch("orders", ctx.tenantId, id, { prepMinutes });
  const cfg = await saiposConfig(ctx, o.storeId);
  if (cfg?.enabled && o.status === "created") return sendToPos(ctx, id);
  return changeStatus(ctx, id, "confirmed", by, o.status === "pos_error" ? "Aceito no gestor (sem PDV)" : prepMinutes ? `Preparo em ${prepMinutes} min` : undefined);
}

export async function rejectOrder(ctx: Ctx, id: string, by: string, reason: string) {
  const o = await ctx.deps.db.get<O>("orders", ctx.tenantId, id);
  if (!o) throw new HttpError(404, "Pedido não encontrado");
  if (["concluded", "cancelled"].includes(o.status)) throw new HttpError(409, "Pedido já encerrado");
  await ctx.deps.db.patch("orders", ctx.tenantId, id, { rejectReason: reason });
  return changeStatus(ctx, id, "cancelled", by, `Recusado: ${reason}`);
}
