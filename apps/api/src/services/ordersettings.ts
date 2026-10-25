import { z } from "zod";
import type { Ctx } from "./ctx";

/** Configuração do gestor de pedidos (kanban). "manager" = o painel é a cozinha; "pdv" = a SAIPOS comanda e o painel só acompanha. */
export const ordersSettingsSchema = z.object({
  mode: z.enum(["manager", "pdv"]),
  autoAccept: z.boolean(),
  prepMinutes: z.number().int().min(1).max(240),
  deliveryMinutes: z.number().int().min(1).max(240),
  lateAfterMinutes: z.number().int().min(1).max(120),
  sound: z.boolean(),
  printOnAccept: z.boolean(),
  rejectReasons: z.array(z.string().min(2).max(80)).max(12),
});
export type OrdersSettings = z.infer<typeof ordersSettingsSchema>;

export const DEFAULT_ORDERS: OrdersSettings = {
  mode: "manager", autoAccept: false, prepMinutes: 25, deliveryMinutes: 30, lateAfterMinutes: 10, sound: true, printOnAccept: false,
  rejectReasons: ["Item em falta", "Loja fechando", "Fora da área de entrega", "Muitos pedidos agora", "Pedido duplicado", "Cliente pediu para cancelar"],
};

export async function ordersSettings(ctx: Ctx): Promise<OrdersSettings> {
  const d = await ctx.deps.db.get<{ id: string; value: Partial<OrdersSettings> }>("settings", ctx.tenantId, "orders");
  return { ...DEFAULT_ORDERS, ...(d?.value || {}) };
}
export async function putOrdersSettings(ctx: Ctx, v: OrdersSettings) {
  await ctx.deps.db.put("settings", ctx.tenantId, { id: "orders", value: v });
  return v;
}
