import type { Customer, Order, Store } from "@cw/core";
import { onlyDigits, r2 } from "@cw/core";
import { DEFAULT_PAYMENTS, type SaiposConfig, type SaiposOrder } from "./types";

export interface MapIssue { field: string; message: string }

const fmtLocal = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Converte o pedido do cardápio no JSON de POST /order da SAIPOS. */
export function toSaiposOrder(order: Order, customer: Customer | null, store: Store, cfg: SaiposConfig): { payload: SaiposOrder; issues: MapIssue[] } {
  const issues: MapIssue[] = [];
  const notes = [order.notes, order.scheduledFor ? `AGENDADO PARA ${fmtLocal(order.scheduledFor)}` : "", order.cashbackUsed ? `Cashback usado: R$ ${order.cashbackUsed.toFixed(2)}` : ""].filter(Boolean).join(" | ");
  const items = order.lines.map((l, i) => {
    if (!l.integrationCode) issues.push({ field: `items[${i}].integration_code`, message: `${l.name} sem código PDV` });
    return {
      integration_code: l.integrationCode || "",
      desc_item: l.name,
      quantity: l.qty,
      unit_price: r2(l.base),
      notes: l.notes || "",
      choice_items: l.choices.map((c, j) => {
        if (!c.integrationCode) issues.push({ field: `items[${i}].choice_items[${j}]`, message: `${c.name} sem código PDV` });
        return { integration_code: c.integrationCode || "", desc_item_choice: c.fraction && c.fraction !== "inteira" ? `${c.fraction} ${c.name}` : c.name, aditional_price: r2(c.unitDelta), quantity: c.qty, notes: "" };
      }),
    };
  });
  let pay = cfg.payments[order.payment.code] || DEFAULT_PAYMENTS[order.payment.code]!;
  // pago online pelo gateway: a SAIPOS registra como pagamento do parceiro, com Pix ou a bandeira no complemento
  if (order.payment.online?.status === "paid") pay = { code: "PARTNER_PAYMENT", type: "ONLINE", complement: order.payment.online.method === "pix" ? (cfg.payments.PIX_ONLINE?.complement ?? "pix") : (order.payment.online.card?.brand || "").toUpperCase() };
  let phone = onlyDigits(customer?.phone || "");
  if (phone.startsWith("55") && phone.length > 11) phone = phone.slice(2);
  const fees = order.fees || [];
  const payload: SaiposOrder = {
    order_id: order.id,
    display_id: order.displayId,
    cod_store: cfg.codStore,
    created_at: order.createdAt,
    notes,
    total_increase: r2(fees.reduce((a, f) => a + f.amount, 0)),
    otherFees: fees.length ? fees.map((f) => ({ description: f.label, type: f.feeType, liability: "RESTAURANT" as const, value: f.amount })) : undefined,
    total_discount: r2(order.discount + order.cashbackUsed),
    total_amount: order.total,
    customer: customer ? { id: customer.id, name: customer.name || "Cliente", phone, email: customer.email, document_number: customer.document } : { id: "-1", name: "Cliente não identificado", phone: "" },
    order_method: order.mode === "DELIVERY"
      ? { mode: "DELIVERY", delivery_by: cfg.deliveryBy, delivery_fee: order.deliveryFee, scheduled: !!order.scheduledFor, delivery_date_time: order.scheduledFor || order.createdAt }
      : { mode: "TAKEOUT", scheduled: !!order.scheduledFor, delivery_date_time: order.scheduledFor || order.createdAt },
    items,
    payment_types: [{ code: pay.code, amount: order.total, change_for: order.payment.code === "CASH" ? order.payment.changeFor || 0 : 0, complement: pay.complement || "", type: pay.type }],
  };
  if (order.mode === "DELIVERY") {
    const a = order.address;
    if (!a) issues.push({ field: "delivery_address", message: "Pedido de entrega sem endereço" });
    else payload.delivery_address = { country: "BR", state: a.state, city: a.city, district: a.district, street_name: a.street, street_number: a.number, postal_code: onlyDigits(a.postalCode), reference: a.reference, complement: a.complement, coordinates: a.lat != null && a.lng != null ? { latitude: a.lat, longitude: a.lng } : undefined };
  }
  if (!store) issues.push({ field: "cod_store", message: "Loja não encontrada" });
  if (!cfg.codStore) issues.push({ field: "cod_store", message: "Código da loja na Saipos não configurado" });
  // conferência: a Saipos recalcula o total; garantimos que bate com o nosso
  const saiposItems = items.reduce((a, it) => a + (it.unit_price + it.choice_items.reduce((b, c) => b + c.aditional_price * c.quantity, 0)) * it.quantity, 0);
  const saiposTotal = r2(saiposItems - payload.total_discount + payload.total_increase + (order.mode === "DELIVERY" ? order.deliveryFee : 0));
  if (Math.abs(saiposTotal - order.total) > 0.011) issues.push({ field: "total_amount", message: `Total recalculado pela Saipos (${saiposTotal}) difere do pedido (${order.total})` });
  return { payload, issues };
}

/** Evento do webhook SAIPOS -> status interno. */
export const EVENT_TO_STATUS = { CONFIRMED: "confirmed", READY_TO_DELIVER: "ready", DISPATCHED: "dispatched", CONCLUDED: "concluded", CANCELLED: "cancelled" } as const;
