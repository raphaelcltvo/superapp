import type { Hono } from "hono";
import type { Env } from "../http";
import { HttpError } from "../services/ctx";
import { verifyMetaSignature } from "../integrations/messaging/whatsapp";
import { emailConfig, handleEmailEvent, handleMetaWebhook, parseMid, readUnsubToken, tick, trackClick, trackOpen, waConfig } from "../services/messaging";
import { runAutomations } from "../services/automations";

const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

/** Rotas sem login: webhooks da Meta e do provedor de e-mail, rastreio de abertura/clique, descadastro e agendador. */
export function mountMessaging(app: Hono<Env>) {
  const tenantBySlug = async (c: import("hono").Context<Env>) => { const t = await c.get("deps").db.tenants.bySlug(c.req.param("slug")!); if (!t) throw new HttpError(404, "Marca não encontrada"); return { deps: c.get("deps"), tenantId: t.id }; };

  // verificação do webhook na Meta (hub.challenge)
  app.get("/webhooks/whatsapp/:slug", async (c) => {
    const ctx = await tenantBySlug(c); const cfg = await waConfig(ctx);
    if (c.req.query("hub.mode") === "subscribe" && cfg && c.req.query("hub.verify_token") === cfg.verifyToken) return c.text(c.req.query("hub.challenge") || "");
    return c.text("token inválido", 403);
  });
  app.post("/webhooks/whatsapp/:slug", async (c) => {
    const ctx = await tenantBySlug(c); const cfg = await waConfig(ctx);
    const raw = await c.req.text();
    if (!cfg || !(await verifyMetaSignature(cfg.appSecret, raw, c.req.header("x-hub-signature-256")))) return c.text("assinatura inválida", 401);
    return c.json(await handleMetaWebhook(ctx, JSON.parse(raw)));
  });
  app.post("/webhooks/email/:slug", async (c) => {
    const ctx = await tenantBySlug(c); const cfg = await emailConfig(ctx);
    if (!cfg?.webhookToken || c.req.query("token") !== cfg.webhookToken) return c.text("token inválido", 401);
    const b = await c.req.json();
    const list = Array.isArray(b) ? b : [b];
    for (const ev of list) await handleEmailEvent(ctx, ev);
    return c.json({ ok: true });
  });

  app.get("/t/o/:mid", async (c) => {
    const p = parseMid(c.req.param("mid"));
    if (p) { try { await trackOpen({ deps: c.get("deps"), tenantId: p.tenantId }, p.msgId); } catch { /* pixel nunca falha */ } }
    return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } });
  });
  app.get("/t/c/:mid", async (c) => {
    const p = parseMid(c.req.param("mid")); const u = c.req.query("u") || "";
    const ok = p ? await trackClick({ deps: c.get("deps"), tenantId: p.tenantId }, p.msgId, u) : null;
    if (!ok) return c.text("Link inválido", 400);
    return c.redirect(ok, 302);
  });
  const unsub = async (c: import("hono").Context<Env>) => {
    const tk = await readUnsubToken(c.get("deps"), c.req.param("token")!);
    if (!tk) return c.text("Link inválido", 400);
    await c.get("deps").db.patch("customers", tk.tenantId, tk.customerId, { optinEmail: false, emailStatus: "unsubscribed" });
    return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descadastro</title><body style="font-family:system-ui,sans-serif;max-width:460px;margin:15vh auto;padding:0 20px;line-height:1.5"><h1 style="font-size:22px">Pronto, você saiu da lista.</h1><p>Não vamos mais mandar e-mails de novidades. Avisos dos seus pedidos continuam chegando normalmente.</p></body>`);
  };
  app.get("/t/u/:token", unsub);
  app.post("/t/u/:token", unsub); // List-Unsubscribe-Post (um clique)

  /** Agendador: chame a cada 5 minutos (Supabase cron, Render cron, GitHub Actions) com o header x-cron-secret. */
  app.post("/cron/tick", async (c) => {
    const deps = c.get("deps");
    if (!deps.cronSecret || c.req.header("x-cron-secret") !== deps.cronSecret) return c.text("não autorizado", 401);
    const out: Record<string, unknown> = {};
    for (const t of await deps.db.tenants.list()) out[t.slug] = await tick({ deps, tenantId: t.id }, runAutomations);
    return c.json(out);
  });
}
