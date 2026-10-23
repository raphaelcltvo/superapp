import type { Ctx } from "./ctx";
import { DEFAULT_PAYMENTS, type SaiposConfig } from "../integrations/saipos/types";
import { hmac } from "../auth";
import { uid } from "@cw/core";

export async function saiposConfig(ctx: Ctx, storeId: string): Promise<SaiposConfig | null> {
  const d = await ctx.deps.db.get<{ id: string; config: SaiposConfig }>("integrations", ctx.tenantId, `saipos:${storeId}`);
  return d ? { ...d.config, payments: { ...DEFAULT_PAYMENTS, ...d.config.payments } } : null;
}

/** Webhooks de saída: avisam o sistema do cliente (ERP, BI, CRM externo) a cada evento. Assinatura HMAC no header. */
export async function emit(ctx: Ctx, event: string, data: unknown) {
  const hooks = await ctx.deps.db.list<{ id: string; url: string; events: string[]; secret: string; active: boolean }>("webhooks", ctx.tenantId);
  const body = JSON.stringify({ id: uid("evt"), event, createdAt: ctx.deps.now().toISOString(), data });
  await Promise.all(hooks.filter((h) => h.active && h.events.includes(event)).map(async (h) => {
    try {
      const f = ctx.deps.saiposFetch && ctx.deps.demo ? ctx.deps.saiposFetch : fetch;
      await f(h.url, { method: "POST", headers: { "content-type": "application/json", "x-superapp-signature": await hmac(h.secret, body) }, body });
    } catch (e) { ctx.deps.log?.("webhook falhou", { url: h.url, e: String(e) }); }
  }));
}
