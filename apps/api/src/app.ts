import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { slugify, uid, type Tenant } from "@cw/core";
import type { Deps } from "./deps";
import { body, onError, type Env } from "./http";
import { HttpError } from "./services/ctx";
import { checkPassword, hashPassword, signAdmin } from "./auth";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { v1Routes } from "./routes/v1";
import { onSaiposEvent } from "./services/orders";
import { saiposConfig } from "./services/integrations";
import { onPaymentWebhook } from "./services/payments";
import { mountMessaging } from "./routes/messaging-public";
import { mountMenuImportPublic } from "./routes/menuimport";

export function createApp(deps: Deps) {
  const app = new Hono<Env>();
  app.onError(onError);
  app.use("*", cors({ origin: (o) => o || "*", allowHeaders: ["authorization", "content-type", "x-customer-token", "x-lead-id", "x-online-token"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });

  app.get("/health", (c) => c.json({ ok: true, db: deps.db.kind, time: deps.now().toISOString() }));

  /** Cria a marca e o primeiro usuário (dono). */
  app.post("/auth/signup", async (c) => {
    const i = await body(c, z.object({ brand: z.string().min(2), slug: z.string().optional(), name: z.string().min(2), email: z.string().email(), password: z.string().min(8) }));
    const slug = slugify(i.slug || i.brand);
    if (await deps.db.tenants.bySlug(slug)) throw new HttpError(409, "Endereço da marca já existe");
    if (await deps.db.findGlobal("users", "email", i.email)) throw new HttpError(409, "E-mail já cadastrado");
    const t: Tenant = { id: uid("ten"), slug, name: i.brand, branding: { name: i.brand, colors: { brand: "#A3191F", brandDeep: "#6F0E12", brandSoft: "#FBE9E8", ink: "#1B1716" } }, settings: { currency: "BRL", timezone: "America/Sao_Paulo", priceParity: true } };
    await deps.db.tenants.put(t as never);
    const u = { id: uid("usr"), name: i.name, email: i.email.toLowerCase(), role: "owner", passwordHash: await hashPassword(i.password), createdAt: deps.now().toISOString() };
    await deps.db.put("users", t.id, u);
    return c.json({ token: await signAdmin({ sub: u.id, tid: t.id, role: "owner" }, deps.jwtSecret), tenant: t }, 201);
  });
  app.post("/auth/login", async (c) => {
    const i = await body(c, z.object({ email: z.string().email(), password: z.string() }));
    const hit = await deps.db.findGlobal<{ id: string; passwordHash: string; role: "owner" }>("users", "email", i.email);
    if (!hit || !(await checkPassword(i.password, hit.doc.passwordHash))) throw new HttpError(401, "E-mail ou senha incorretos");
    return c.json({ token: await signAdmin({ sub: hit.doc.id, tid: hit.tenantId, role: hit.doc.role }, deps.jwtSecret), tenant: await deps.db.tenants.get(hit.tenantId) });
  });

  app.route("/admin", adminRoutes());
  app.route("/public/:slug", publicRoutes());
  app.route("/v1", v1Routes());
  mountMessaging(app);
  mountMenuImportPublic(app);

  /** Webhook que a SAIPOS chama a cada mudança de status (configure a URL no Saipos Developer > Configuração). */
  app.post("/webhooks/saipos/:slug/:storeId", async (c) => {
    const t = await deps.db.tenants.bySlug(c.req.param("slug"));
    if (!t) throw new HttpError(404, "Marca não encontrada");
    const ctx = { deps, tenantId: t.id };
    const cfg = await saiposConfig(ctx, c.req.param("storeId"));
    if (!cfg || c.req.query("token") !== cfg.webhookSecret) throw new HttpError(401, "Token do webhook inválido");
    const b = await body(c, z.object({ event: z.enum(["CONFIRMED", "READY_TO_DELIVER", "DISPATCHED", "CONCLUDED", "CANCELLED"]), cod_store: z.string(), order_id: z.string() }));
    if (b.cod_store !== cfg.codStore) throw new HttpError(400, "cod_store não confere");
    await onSaiposEvent(ctx, b);
    return c.json({ ok: true }); // responder 200 rápido: a SAIPOS registra erro 918 se o parceiro falhar
  });
  /** Webhook dos gateways de pagamento (Mercado Pago, Pagar.me, Asaas). A URL completa, com o token, aparece em Pagamentos no painel. */
  app.post("/webhooks/payments/:gateway/:slug", async (c) => {
    const t = await deps.db.tenants.bySlug(c.req.param("slug"));
    if (!t) throw new HttpError(404, "Marca não encontrada");
    const headers: Record<string, string> = {}; c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const r = await onPaymentWebhook({ deps, tenantId: t.id }, c.req.param("gateway"), { headers, body: await c.req.text(), query: c.req.query() });
    return c.json(r);
  });
  return app;
}
