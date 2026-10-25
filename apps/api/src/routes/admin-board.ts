import { Hono } from "hono";
import { z } from "zod";
import type { Store } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { acceptOrder, board, rejectOrder } from "../services/board";
import { ordersSettings, ordersSettingsSchema, putOrdersSettings } from "../services/ordersettings";

/** Gestor de pedidos ao vivo: quadro, aceite, recusa, pausa da loja e configurações. Montado antes de /orders/:id. */
export function boardRoutes() {
  const r = new Hono<Env>();
  r.get("/settings/orders", async (c) => c.json(await ordersSettings(ctxOf(c))));
  r.put("/settings/orders", async (c) => c.json(await putOrdersSettings(ctxOf(c), await body(c, ordersSettingsSchema))));
  r.get("/orders/board", async (c) => c.json(await board(ctxOf(c), { storeId: c.req.query("storeId") || undefined, cursor: c.req.query("cursor") || undefined })));
  r.post("/orders/:id/accept", async (c) => {
    const i = await body(c, z.object({ prepMinutes: z.number().int().min(1).max(600).optional() }));
    return c.json(await acceptOrder(ctxOf(c), c.req.param("id"), c.get("admin")!.sub, i.prepMinutes));
  });
  r.post("/orders/:id/reject", async (c) => {
    const i = await body(c, z.object({ reason: z.string().min(2).max(200) }));
    return c.json(await rejectOrder(ctxOf(c), c.req.param("id"), c.get("admin")!.sub, i.reason));
  });
  /** Pausa ou reabre a loja (atalho do gestor). */
  r.post("/stores/:id/pause", async (c) => {
    const i = await body(c, z.object({ paused: z.boolean(), reason: z.string().max(120).optional() }));
    const db = c.get("deps").db; const s = await db.get<Store & { id: string }>("stores", c.get("tenantId"), c.req.param("id"));
    if (!s) throw new HttpError(404, "Loja não encontrada");
    return c.json(await db.patch("stores", c.get("tenantId"), s.id, { status: i.paused ? "paused" : "live", pausedReason: i.paused ? i.reason || "Pausa pelo gestor de pedidos" : null }));
  });
  return r;
}
