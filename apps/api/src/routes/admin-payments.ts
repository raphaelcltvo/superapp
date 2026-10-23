import { Hono } from "hono";
import { z } from "zod";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { paymentsConfigSchema } from "../schemas";
import { GATEWAYS, PaymentError } from "../integrations/payments";
import { paymentsConfig, paymentsReport, refundOrder, notificationUrl } from "../services/payments";

const SECRET_KEYS = ["accessToken", "secretKey", "apiKey", "webhookSecret"] as const;
const mask = (v?: string) => (v ? "••••" + v.slice(-4) : "");

export function paymentsAdminRoutes() {
  const r = new Hono<Env>();
  r.get("/integrations/payments", async (c) => {
    const ctx = ctxOf(c); const cfg = await paymentsConfig(ctx); const t = await ctx.deps.db.tenants.get(ctx.tenantId);
    const out = cfg ? { ...cfg, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, mask(cfg[k])])) } : null;
    return c.json({ config: out, webhookUrl: cfg ? notificationUrl(ctx, t!.slug, cfg) : null, gateways: Object.values(GATEWAYS).map((g) => ({ id: g.id, label: g.label, supports: g.supports })) });
  });
  r.put("/integrations/payments", async (c) => {
    const ctx = ctxOf(c); const prev = await paymentsConfig(ctx);
    const raw = (await c.req.json()) as Record<string, unknown>;
    for (const k of SECRET_KEYS) if (typeof raw[k] === "string" && (raw[k] as string).startsWith("••••")) raw[k] = prev?.[k]; // não sobrescreve segredo mascarado
    const cfg = paymentsConfigSchema.parse(raw);
    if (cfg.methods.card && !GATEWAYS[cfg.gateway].supports.card) throw new HttpError(422, `${GATEWAYS[cfg.gateway].label} não está habilitado para cartão online aqui`);
    if (cfg.enabled && cfg.gateway === "mercadopago" && !cfg.accessToken) throw new HttpError(422, "Informe o Access Token do Mercado Pago");
    if (cfg.enabled && cfg.gateway === "pagarme" && !cfg.secretKey) throw new HttpError(422, "Informe a chave secreta do Pagar.me");
    if (cfg.enabled && cfg.gateway === "asaas" && !cfg.apiKey) throw new HttpError(422, "Informe a chave de API do Asaas");
    if (cfg.enabled && cfg.methods.card && ["mercadopago", "pagarme"].includes(cfg.gateway) && !cfg.publicKey) throw new HttpError(422, "Cartão online precisa da chave pública (o navegador usa para gerar o token)");
    const doc = { ...cfg, webhookToken: prev?.webhookToken || crypto.randomUUID().replace(/-/g, "") };
    await ctx.deps.db.put("integrations", ctx.tenantId, { id: "payments", provider: cfg.gateway, config: doc });
    return c.json({ ok: true });
  });
  r.post("/integrations/payments/test", async (c) => {
    const ctx = ctxOf(c); const cfg = await paymentsConfig(ctx);
    if (!cfg) throw new HttpError(422, "Salve a configuração primeiro");
    try { return c.json({ ok: true, message: await GATEWAYS[cfg.gateway].test(cfg, ctx.deps.paymentsFetch || ((u, i) => fetch(u, i))) }); }
    catch (e) { return c.json({ ok: false, message: e instanceof PaymentError || e instanceof HttpError ? e.message : String(e) }); }
  });
  r.get("/payments", async (c) => c.json(await paymentsReport(ctxOf(c), Math.min(365, Number(c.req.query("days") || 30)))));
  r.post("/orders/:id/refund", async (c) => {
    const i = await body(c, z.object({ amount: z.number().positive().optional() }));
    return c.json(await refundOrder(ctxOf(c), c.req.param("id"), i.amount, c.get("admin")!.sub));
  });
  return r;
}
