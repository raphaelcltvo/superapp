import { Hono } from "hono";
import { z } from "zod";
import { uid, type Customer, type InboxMessage, type MessageTemplate } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { emailConfigSchema, whatsappConfigSchema } from "../schemas";
import { audience, campaignReport, deliver, emailConfig, sendCampaign, tenantOf, unsubToken, waConfig, baseVars, type Msg } from "../services/messaging";
import { renderEmail } from "../integrations/messaging/render";
import { draftSnapshot } from "../services/catalog";
import { FakeWhatsApp, MetaWhatsApp } from "../integrations/messaging/whatsapp";

const mask = (s?: string) => (s ? "••••" + s.slice(-4) : "");
const keep = (v: unknown, prev?: string) => (typeof v === "string" && v.startsWith("••••") ? prev || "" : v);

export function messagingAdminRoutes() {
  const r = new Hono<Env>();

  r.get("/config", async (c) => {
    const ctx = ctxOf(c); const t = await tenantOf(ctx);
    const wa = await waConfig(ctx), em = await emailConfig(ctx);
    return c.json({
      whatsapp: wa ? { ...wa, token: mask(wa.token), appSecret: mask(wa.appSecret) } : null,
      email: em ? { ...em, apiKey: mask(em.apiKey) } : null,
      webhooks: { whatsapp: `${ctx.deps.publicUrl}/webhooks/whatsapp/${t.slug}`, email: `${ctx.deps.publicUrl}/webhooks/email/${t.slug}?token=${em?.webhookToken || "(salve para gerar)"}` },
    });
  });
  r.put("/config/whatsapp", async (c) => {
    const ctx = ctxOf(c); const prev = await waConfig(ctx); const raw = (await c.req.json()) as Record<string, unknown>;
    const cfg = whatsappConfigSchema.parse({ ...raw, token: keep(raw.token, prev?.token), appSecret: keep(raw.appSecret, prev?.appSecret) });
    await ctx.deps.db.put("integrations", ctx.tenantId, { id: "whatsapp", provider: "whatsapp", config: cfg });
    return c.json({ ok: true });
  });
  r.put("/config/email", async (c) => {
    const ctx = ctxOf(c); const prev = await emailConfig(ctx); const raw = (await c.req.json()) as Record<string, unknown>;
    const cfg = emailConfigSchema.parse({ ...raw, apiKey: keep(raw.apiKey, prev?.apiKey), webhookToken: prev?.webhookToken || crypto.randomUUID().replace(/-/g, "") });
    await ctx.deps.db.put("integrations", ctx.tenantId, { id: "email", provider: "email", config: cfg });
    return c.json({ ok: true });
  });

  /** Envio de teste para um número ou e-mail qualquer (não entra nos relatórios). */
  r.post("/test", async (c) => {
    const i = await body(c, z.object({ channel: z.enum(["whatsapp", "email"]), to: z.string().min(5), templateId: z.string().optional(), text: z.string().optional() }));
    const ctx = ctxOf(c); const t = await tenantOf(ctx);
    const tpl = i.templateId ? await ctx.deps.db.get<MessageTemplate & { id: string }>("message_templates", ctx.tenantId, i.templateId) : null;
    if (i.channel === "whatsapp" && !(await waConfig(ctx))?.enabled) throw new HttpError(422, "Ligue o WhatsApp antes de testar");
    if (i.channel === "whatsapp" && !tpl?.waName) {
      // fora da janela de 24h só modelo aprovado; o teste sem modelo usa o hello_world padrão da Meta
      const cfg = (await waConfig(ctx))!;
      const p = cfg.provider === "fake" ? new FakeWhatsApp() : new MetaWhatsApp(cfg, ctx.deps.messagingFetch);
      try { const res = await p.send(i.to.replace(/\D/g, ""), { kind: "template", name: "hello_world", language: "en_US", bodyParams: [] }); return c.json({ ok: true, providerId: res.providerId }); }
      catch (e) { return c.json({ ok: false, error: String((e as Error).message) }); }
    }
    const fake: Customer = { id: "teste", name: c.get("admin")?.sub ? "Teste" : "Teste", phone: i.to.replace(/\D/g, ""), email: i.to.includes("@") ? i.to : undefined, optinEmail: true, optinWhatsapp: true, orders: 0, spent: 0, createdAt: new Date().toISOString() };
    const m = await deliver(ctx, { customer: fake, channel: i.channel, template: tpl, text: i.text, vars: baseVars(fake, t, { cupom: "TESTE10", link: `${ctx.deps.publicUrl}/${t.slug}` }), ref: "teste", group: "envio" });
    await ctx.deps.db.remove("messages", ctx.tenantId, m.id);
    return c.json({ ok: m.status !== "failed", error: m.error, providerId: m.providerId });
  });

  /** Pré-visualização: HTML do e-mail ou texto do WhatsApp com dados de exemplo. */
  r.post("/templates/preview", async (c) => {
    const tpl = (await c.req.json()) as MessageTemplate;
    const ctx = ctxOf(c); const t = await tenantOf(ctx);
    const vars = { nome: "Ana", cupom: "VOLTA15", link: `${ctx.deps.publicUrl}/${t.slug}`, marca: t.name, dias: "32", pedido: "1042", cashback: "12,40", codigo: "4821" };
    if (tpl.channel === "whatsapp") {
      const m: Record<string, string> = {}; (tpl.waVars || []).forEach((v, i) => { m[String(i + 1)] = v.source === "fixo" ? v.value || "" : vars[v.source as keyof typeof vars] ?? ""; });
      return c.json({ text: (tpl.waBody || "").replace(/\{\{(\d+)\}\}/g, (_, n) => m[n] ?? `{{${n}}}`) });
    }
    const snap = await draftSnapshot(ctx);
    const r0 = renderEmail({ brand: t.branding, subject: tpl.subject || "", preheader: tpl.preheader, blocks: tpl.blocks || [], vars, items: Object.fromEntries(snap.items.map((x) => [x.id, x])), groups: Object.fromEntries(snap.groups.map((g) => [g.id, g])), coupons: Object.fromEntries(snap.coupons.map((x) => [x.id, x])), ctaLink: vars.link, unsubscribeUrl: `${ctx.deps.publicUrl}/t/u/${await unsubToken(ctx, "exemplo")}` });
    return c.json({ subject: r0.subject, html: r0.html, text: r0.text });
  });

  r.get("/audience", async (c) => {
    const a = await audience(ctxOf(c), c.req.query("segmentId") || undefined, (c.req.query("channel") as "email") || "whatsapp");
    return c.json({ total: a.total, reachable: a.reachable.length });
  });
  r.post("/campaigns/:id/send", async (c) => c.json(await sendCampaign(ctxOf(c), c.req.param("id"))));
  r.get("/campaigns/:id/report", async (c) => c.json(await campaignReport(ctxOf(c), c.req.param("id"))));

  r.get("/messages", async (c) => {
    const where: Record<string, string> = {};
    for (const k of ["channel", "campaignId", "automationId", "customerId"]) { const v = c.req.query(k); if (v) where[k] = v; }
    return c.json(await c.get("deps").db.list<Msg>("messages", c.get("tenantId"), { where, limit: Number(c.req.query("limit") || 100) }));
  });

  /** Visão por canal nos últimos 30 dias. */
  r.get("/overview", async (c) => {
    const { db, now } = c.get("deps"); const t = c.get("tenantId");
    const msgs = (await db.list<Msg>("messages", t, { since: new Date(+now() - 30 * 864e5).toISOString() })).filter((m) => m.group === "envio");
    const cs = await db.list<Customer & { id: string }>("customers", t);
    const ch = (k: "whatsapp" | "email") => { const l = msgs.filter((m) => (m.channel || "whatsapp") === k); return { sent: l.length, delivered: l.filter((m) => m.deliveredAt).length, read: l.filter((m) => m.readAt || m.openedAt).length, clicked: l.filter((m) => m.clickedAt).length, failed: l.filter((m) => ["failed", "bounced"].includes(m.status)).length }; };
    return c.json({ whatsapp: { ...ch("whatsapp"), optin: cs.filter((x) => x.optinWhatsapp && x.phone).length }, email: { ...ch("email"), optin: cs.filter((x) => x.optinEmail && x.email && !["bounced", "complained", "unsubscribed"].includes(x.emailStatus || "")).length }, customers: cs.length });
  });

  /* ---------- caixa de entrada do WhatsApp ---------- */
  r.get("/inbox", async (c) => c.json(await c.get("deps").db.list<InboxMessage & { id: string }>("inbox", c.get("tenantId"), { where: c.req.query("status") ? { status: c.req.query("status")! } : undefined, limit: 200 })));
  r.post("/inbox/:id/resolve", async (c) => c.json(await c.get("deps").db.patch("inbox", c.get("tenantId"), c.req.param("id"), { status: "resolved" })));
  r.post("/inbox/:id/reply", async (c) => {
    const i = await body(c, z.object({ text: z.string().min(1).max(4096) }));
    const ctx = ctxOf(c); const ib = await ctx.deps.db.get<InboxMessage & { id: string }>("inbox", ctx.tenantId, c.req.param("id"));
    if (!ib) throw new HttpError(404, "Conversa não encontrada");
    if (+ctx.deps.now() - +new Date(ib.at) > 24 * 3600e3) throw new HttpError(422, "Passaram 24h da última mensagem do cliente: responda com um modelo aprovado");
    const cfg = await waConfig(ctx); if (!cfg?.enabled) throw new HttpError(422, "WhatsApp desligado");
    const p = cfg.provider === "fake" ? new FakeWhatsApp() : new MetaWhatsApp(cfg, ctx.deps.messagingFetch);
    let status = "sent";
    try { await p.send(ib.from, { kind: "text", body: i.text }); } catch (e) { status = "failed: " + String((e as Error).message); }
    const replies = [...(ib.replies || []), { text: i.text, at: ctx.deps.now().toISOString(), by: c.get("admin")?.sub || "painel", status }];
    await ctx.deps.db.patch("inbox", ctx.tenantId, ib.id, { replies, status: status === "sent" ? "resolved" : "open" });
    if (status !== "sent") throw new HttpError(502, status);
    return c.json({ ok: true, id: uid("rep") });
  });
  return r;
}
