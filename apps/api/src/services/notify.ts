import { uid, type Customer, type Order, type OrderStatus, type Store } from "@cw/core";
import type { Ctx } from "./ctx";
import { fillVars } from "../integrations/messaging/render";
import type { WaPayload } from "../integrations/messaging/whatsapp";
import { saveMsg, simulate, tenantOf, waConfig, waProvider, type Msg } from "./messaging";

/** Avisos de pedido pelo WhatsApp (transacionais): saem para o telefone do pedido, com ou sem aceite de marketing. */
export type NotifyEvent = "confirmed" | "ready" | "dispatched" | "concluded" | "cancelled";
export const NOTIFY_EVENTS: NotifyEvent[] = ["confirmed", "ready", "dispatched", "concluded", "cancelled"];
export interface NotifyRule { enabled: boolean; text: string; /** modelo aprovado na Meta (obrigatório no provedor oficial) */ waName?: string; waLanguage?: string }
export interface NotificationSettings { enabled: boolean; events: Record<NotifyEvent, NotifyRule> }

export const NOTIFY_LABEL: Record<NotifyEvent, string> = {
  confirmed: "Pedido aceito", ready: "Pronto para retirada", dispatched: "Saiu para entrega", concluded: "Entregue", cancelled: "Cancelado",
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  events: {
    confirmed: { enabled: true, text: "Oi, {{nome}}! Seu pedido #{{pedido}} na {{marca}} foi aceito e já está sendo preparado. Previsão: {{tempo}}." },
    ready: { enabled: true, text: "{{nome}}, seu pedido #{{pedido}} está pronto para retirada na {{marca}}. Te esperamos!" },
    dispatched: { enabled: true, text: "Seu pedido #{{pedido}} saiu para entrega e chega em {{tempo}}. Acompanhe: {{link}}" },
    concluded: { enabled: false, text: "Pedido #{{pedido}} entregue. Bom apetite, {{nome}}! Se puder, conta pra gente como foi: {{link}}" },
    cancelled: { enabled: true, text: "{{nome}}, seu pedido #{{pedido}} na {{marca}} foi cancelado. Se o pagamento foi online, o estorno já foi solicitado. Ficou alguma dúvida? É só responder aqui." },
  },
};

export async function notificationSettings(ctx: Ctx): Promise<NotificationSettings> {
  const d = await ctx.deps.db.get<{ id: string; value: Partial<NotificationSettings> }>("settings", ctx.tenantId, "notifications");
  const v = d?.value || {};
  return { enabled: v.enabled ?? DEFAULT_NOTIFICATIONS.enabled, events: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, { ...DEFAULT_NOTIFICATIONS.events[e], ...(v.events?.[e] || {}) }])) as NotificationSettings["events"] };
}
export async function putNotificationSettings(ctx: Ctx, v: NotificationSettings) {
  await ctx.deps.db.put("settings", ctx.tenantId, { id: "notifications", value: v });
  return v;
}

/** Variáveis na ordem em que aparecem no texto: é a ordem dos {{1}}, {{2}}… do modelo aprovado na Meta. */
export function varsInOrder(text: string) { return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]); }

export async function orderVars(ctx: Ctx, order: Order, customer: Customer | null) {
  const t = await tenantOf(ctx);
  const store = await ctx.deps.db.get<Store & { id: string }>("stores", ctx.tenantId, order.storeId);
  const zone = store?.zones.find((z) => z.id === (order as Order & { zoneId?: string }).zoneId) || store?.zones.find((z) => z.active);
  const tempo = order.mode === "TAKEOUT" ? "cerca de 25 min" : zone ? `${zone.etaMin}–${zone.etaMax} min` : "breve";
  return {
    nome: (customer?.name || "").split(" ")[0] || "tudo bem", pedido: order.displayId, marca: t.name, tempo,
    link: `${ctx.deps.publicUrl}/${t.slug}?pedido=${order.displayId}&utm_source=whatsapp&utm_medium=aviso`,
  } as Record<string, string>;
}

/**
 * Avisa o cliente da mudança de status. Nunca lança erro: falhas viram mensagem com status "failed"
 * (ou { skipped } quando não há o que enviar). Cada etapa do pedido é avisada uma vez só.
 */
export async function notifyOrderStatus(ctx: Ctx, order: Order, status: OrderStatus): Promise<{ sent?: boolean; skipped?: string; msgId?: string }> {
  try {
    if (!(NOTIFY_EVENTS as string[]).includes(status)) return { skipped: "status sem aviso" };
    const ev = status as NotifyEvent;
    if (ev === "ready" && order.mode !== "TAKEOUT") return { skipped: "pronto só avisa retirada" };
    const s = await notificationSettings(ctx); const rule = s.events[ev];
    if (!s.enabled || !rule.enabled) return { skipped: "aviso desligado" };
    const cfg = await waConfig(ctx);
    if (!cfg?.enabled) return { skipped: "WhatsApp desligado" };
    if (cfg.provider === "meta" && !rule.waName) return { skipped: "API oficial exige modelo aprovado para este aviso" };
    if (!order.customerId) return { skipped: "pedido sem cliente" };
    const customer = await ctx.deps.db.get<Customer & { id: string }>("customers", ctx.tenantId, order.customerId);
    if (!customer?.phone) return { skipped: "cliente sem telefone" };
    const ref = `pedido:${order.id}`;
    const prev = await ctx.deps.db.list<Msg>("messages", ctx.tenantId, { where: { ref } });
    if (prev.some((m) => m.orderEvent === ev && m.status !== "failed")) return { skipped: "já avisado" };
    const vars = await orderVars(ctx, order, customer);
    const text = fillVars(rule.text, vars);
    const now = ctx.deps.now().toISOString();
    const base: Msg = { id: uid("msg"), channel: "whatsapp", customerId: customer.id, to: customer.phone, ref, group: "envio", text, status: "queued", events: [], transactional: true, orderId: order.id, orderEvent: ev, createdAt: now };
    const payload: WaPayload = cfg.provider === "meta"
      ? { kind: "template", name: rule.waName!, language: rule.waLanguage || "pt_BR", bodyParams: varsInOrder(rule.text).map((k) => vars[k] ?? ""), text }
      : { kind: "text", body: text }; // QR code e teste: texto puro, sem janela de 24 h
    try {
      const r = await waProvider(ctx, cfg).send(customer.phone, payload);
      const saved = await saveMsg(ctx, { ...base, providerId: r.providerId, status: "sent", events: [{ status: "sent", at: now }] });
      if (cfg.provider === "fake") await simulate(ctx, saved);
      return { sent: true, msgId: saved.id };
    } catch (e) {
      const saved = await saveMsg(ctx, { ...base, status: "failed", error: String((e as Error).message || e) });
      return { sent: false, msgId: saved.id };
    }
  } catch (e) {
    ctx.deps.log?.("aviso de pedido falhou", String(e));
    return { skipped: "erro: " + String((e as Error).message || e) };
  }
}
