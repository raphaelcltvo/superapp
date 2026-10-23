import { inSegment, normPhone, uid, r2, type AutomationChannel, type Campaign, type Coupon, type Customer, type InboxMessage, type Item, type MessageChannel, type MessageStatus, type MessageTemplate, type OptionGroup, type Order, type Segment, type Tenant } from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";
import { hmac } from "../auth";
import { FakeWhatsApp, MetaWhatsApp, type WhatsAppProvider, type WaPayload, type MetaWebhook } from "../integrations/messaging/whatsapp";
import { BrevoEmail, FakeEmail, ResendEmail, type EmailProvider } from "../integrations/messaging/email";
import { fillVars, instrument, renderEmail } from "../integrations/messaging/render";
import type { EmailConfig, WhatsAppConfig } from "../integrations/messaging/types";
import { findByPhone } from "./customers";
import { draftSnapshot, publishedSnapshot } from "./catalog";

/** Mensagem enviada (ou registrada para o grupo de controle), em qualquer canal. */
export interface Msg {
  id: string;
  channel: MessageChannel;
  automationId?: string;
  campaignId?: string;
  templateId?: string;
  customerId: string;
  to?: string;
  ref: string;
  group: "envio" | "controle";
  text: string;
  subject?: string;
  status: MessageStatus | string;
  providerId?: string;
  links?: string[];
  events?: { status: string; at: string }[];
  deliveredAt?: string; readAt?: string; openedAt?: string; clickedAt?: string;
  error?: string;
  cost?: number;
  createdAt: string;
}

const RANK: Record<string, number> = { controle: -1, queued: 0, sent: 1, delivered: 2, read: 3, played: 3, opened: 3, clicked: 4 };
const TERMINAL = new Set(["failed", "bounced"]);
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 1000; };
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

/* ---------------- configuração ---------------- */
export async function waConfig(ctx: Ctx) { return (await ctx.deps.db.get<{ id: string; config: WhatsAppConfig }>("integrations", ctx.tenantId, "whatsapp"))?.config || null; }
export async function emailConfig(ctx: Ctx) { return (await ctx.deps.db.get<{ id: string; config: EmailConfig }>("integrations", ctx.tenantId, "email"))?.config || null; }

const fakes = new Map<string, { wa: FakeWhatsApp; email: FakeEmail }>();
export function fakeProviders(tenantId: string) { if (!fakes.has(tenantId)) fakes.set(tenantId, { wa: new FakeWhatsApp(), email: new FakeEmail() }); return fakes.get(tenantId)!; }

function waProvider(ctx: Ctx, cfg: WhatsAppConfig): WhatsAppProvider { return cfg.provider === "fake" ? fakeProviders(ctx.tenantId).wa : new MetaWhatsApp(cfg, ctx.deps.messagingFetch); }
function emailProvider(ctx: Ctx, cfg: EmailConfig): EmailProvider {
  if (cfg.provider === "fake") return fakeProviders(ctx.tenantId).email;
  return cfg.provider === "brevo" ? new BrevoEmail(cfg, ctx.deps.messagingFetch) : new ResendEmail(cfg, ctx.deps.messagingFetch);
}

/* ---------------- quem pode receber ---------------- */
export function reachable(c: Customer, ch: MessageChannel) {
  if (ch === "whatsapp") return !!c.optinWhatsapp && !!c.phone;
  return !!c.optinEmail && !!c.email && !["bounced", "complained", "unsubscribed"].includes(c.emailStatus || "");
}
/** Canal efetivo de uma automação para este cliente (WhatsApp com e-mail de reserva). */
export function pickChannel(c: Customer, ch: AutomationChannel): MessageChannel | null {
  if (ch === "whatsapp_then_email") return reachable(c, "whatsapp") ? "whatsapp" : reachable(c, "email") ? "email" : null;
  return reachable(c, ch) ? ch : null;
}

/* ---------------- variáveis e links ---------------- */
export async function tenantOf(ctx: Ctx) { return (await ctx.deps.db.tenants.get(ctx.tenantId)) as unknown as Tenant & { publishedVersionId?: string }; }
export function trackedLink(base: string, slug: string, pageId: string | undefined, channel: MessageChannel, campaign: string) {
  return `${base}/${slug}${pageId ? `/p/${pageId}` : ""}?utm_source=${channel}&utm_medium=${channel === "email" ? "email" : "mensagem"}&utm_campaign=${encodeURIComponent(campaign)}`;
}
export function baseVars(c: Customer, t: Tenant, extra: Record<string, string>) {
  return { nome: (c.name || "").split(" ")[0] || "tudo bem", marca: t.name, ...extra };
}

/* ---------------- envio ---------------- */
export interface Deliver {
  customer: Customer;
  channel: MessageChannel;
  template?: MessageTemplate | null;
  /** texto livre (WhatsApp sem modelo ou legado) */
  text?: string;
  vars: Record<string, string>;
  ref: string;
  group: "envio" | "controle";
  automationId?: string;
  campaignId?: string;
  couponId?: string;
}

/** Envia uma mensagem (ou registra o controle) e grava o histórico com status. */
export async function deliver(ctx: Ctx, d: Deliver): Promise<Msg> {
  const now = ctx.deps.now().toISOString();
  const t = await tenantOf(ctx);
  const base: Msg = { id: uid("msg"), channel: d.channel, automationId: d.automationId, campaignId: d.campaignId, templateId: d.template?.id, customerId: d.customer.id, ref: d.ref, group: d.group, text: "", status: "queued", events: [], createdAt: now };
  if (d.channel === "whatsapp") {
    base.to = d.customer.phone;
    const cfg = await waConfig(ctx);
    const tpl = d.template?.channel === "whatsapp" ? d.template : null;
    base.text = tpl?.waBody ? fillVars(waBodyVars(tpl.waBody), tplVarMap(tpl, d.vars)) : fillVars(d.text || "", d.vars);
    if (d.group === "controle") return save(ctx, { ...base, status: "controle" });
    try {
      if (cfg?.enabled) {
        let payload: WaPayload;
        if (tpl?.waName) payload = { kind: "template", name: tpl.waName, language: tpl.waLanguage || "pt_BR", bodyParams: (tpl.waVars || []).map((v) => (v.source === "fixo" ? v.value || "" : d.vars[v.source] ?? "")), headerImage: tpl.waHeaderImage };
        else {
          if (!(await windowOpen(ctx, d.customer))) throw new HttpError(422, "Fora da janela de 24h: use um modelo aprovado pela Meta");
          payload = { kind: "text", body: base.text };
        }
        const r = await waProvider(ctx, cfg).send(d.customer.phone!, payload);
        Object.assign(base, { providerId: r.providerId, status: "sent", cost: cfg.costPerMessage, events: [{ status: "sent", at: now }] });
        const saved = await save(ctx, base);
        if (cfg.provider === "fake") await simulate(ctx, saved);
        return saved;
      }
      // sem WhatsApp configurado: provedor legado (registro)
      const r = await ctx.deps.messenger.send(ctx.tenantId, d.customer.phone!, base.text);
      return save(ctx, { ...base, status: r.status, providerId: r.id, events: [{ status: r.status, at: now }] });
    } catch (e) { return save(ctx, { ...base, status: "failed", error: String((e as Error).message || e) }); }
  }
  // e-mail
  base.to = d.customer.email;
  const cfg = await emailConfig(ctx);
  const tpl = d.template?.channel === "email" ? d.template : null;
  if (!tpl) return save(ctx, { ...base, status: "failed", error: "Escolha um modelo de e-mail" });
  base.subject = fillVars(tpl.subject || "", d.vars);
  base.text = base.subject;
  if (d.group === "controle") return save(ctx, { ...base, status: "controle" });
  if (!cfg?.enabled) return save(ctx, { ...base, status: "failed", error: "E-mail não configurado" });
  try {
    const snap = (await publishedSnapshot(ctx)) || (await draftSnapshot(ctx));
    const coupons = Object.fromEntries(snap.coupons.map((c) => [c.id, c])) as Record<string, Coupon>;
    const unsub = `${ctx.deps.publicUrl}/t/u/${await unsubToken(ctx, d.customer.id)}`;
    const store = snap.stores[0];
    const rendered = renderEmail({ brand: t.branding, subject: tpl.subject || "", preheader: tpl.preheader, blocks: tpl.blocks || [], vars: d.vars, items: Object.fromEntries(snap.items.map((i) => [i.id, i])) as Record<string, Item>, groups: Object.fromEntries(snap.groups.map((g) => [g.id, g])) as Record<string, OptionGroup>, coupons, couponId: d.couponId, ctaLink: d.vars.link || `${ctx.deps.publicUrl}/${t.slug}`, unsubscribeUrl: unsub, address: store ? `${store.address.street}, ${store.address.number} · ${store.address.city}/${store.address.state}` : undefined });
    const mid = `${ctx.tenantId}~${base.id}`;
    const ins = instrument(rendered.html, { clickBase: `${ctx.deps.publicUrl}/t/c/${mid}`, pixelUrl: `${ctx.deps.publicUrl}/t/o/${mid}.gif`, skip: (u) => u === unsub });
    base.links = ins.links;
    const r = await emailProvider(ctx, cfg).send({ to: d.customer.email!, toName: d.customer.name, subject: rendered.subject, html: ins.html, text: rendered.text, headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, tags: { message_id: base.id, campaign: d.campaignId || d.automationId || "avulsa" }, idempotencyKey: base.id });
    Object.assign(base, { providerId: r.providerId, status: "sent", events: [{ status: "sent", at: now }] });
    const saved = await save(ctx, base);
    if (cfg.provider === "fake") await simulate(ctx, saved);
    return saved;
  } catch (e) { return save(ctx, { ...base, status: "failed", error: String((e as Error).message || e) }); }
}

/** No corpo aprovado o WhatsApp usa {{1}}, {{2}}… */
const waBodyVars = (body: string) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => `{{v${n}}}`);
function tplVarMap(tpl: MessageTemplate, vars: Record<string, string>) {
  const m: Record<string, string> = {};
  (tpl.waVars || []).forEach((v, i) => { m[`v${i + 1}`] = v.source === "fixo" ? v.value || "" : vars[v.source] ?? ""; });
  return m;
}

async function save(ctx: Ctx, m: Msg) { await ctx.deps.db.put("messages", ctx.tenantId, m as never); return m; }

/** Janela de atendimento: texto livre só até 24h depois da última mensagem do cliente. */
export async function windowOpen(ctx: Ctx, c: Customer) {
  const ib = await ctx.deps.db.list<InboxMessage & { id: string }>("inbox", ctx.tenantId, { where: { customerId: c.id }, limit: 200 });
  const last = Math.max(0, ...ib.map((x) => +new Date(x.at)));
  return +ctx.deps.now() - last < 24 * 3600e3;
}

/** Provedor de teste: marca entregue/lido/aberto/clicado com taxas plausíveis e determinísticas. */
async function simulate(ctx: Ctx, m: Msg) {
  const h = hash(m.id), t0 = +new Date(m.createdAt);
  const at = (min: number) => new Date(t0 + min * 60e3).toISOString();
  if (m.channel === "whatsapp") {
    if (h < 960) await setStatus(ctx, m.id, "delivered", at(1));
    if (h < 700) await setStatus(ctx, m.id, "read", at(9));
    if (h < 180 && m.links?.length) await setStatus(ctx, m.id, "clicked", at(12));
  } else {
    if (h < 970) await setStatus(ctx, m.id, "delivered", at(1)); else await setStatus(ctx, m.id, "bounced", at(1));
    if (h < 420) await setStatus(ctx, m.id, "opened", at(30));
    if (h < 110) await setStatus(ctx, m.id, "clicked", at(32));
  }
}

/** Avança o status sem regredir (lido não volta a entregue) e registra o horário de cada etapa. */
export async function setStatus(ctx: Ctx, msgId: string, status: string, at?: string, error?: string) {
  const m = await ctx.deps.db.get<Msg>("messages", ctx.tenantId, msgId);
  if (!m) return null;
  // a Meta e os provedores reenviam avisos (até 7 dias): cada etapa conta uma vez só
  if ((m.events || []).some((e) => e.status === status)) return m;
  const when = at || ctx.deps.now().toISOString();
  const upd: Partial<Msg> = { events: [...(m.events || []), { status, at: when }] };
  const field = ({ delivered: "deliveredAt", read: "readAt", played: "readAt", opened: "openedAt", clicked: "clickedAt" } as const)[status as "read"];
  if (field && !m[field]) (upd as Record<string, string>)[field] = when;
  if (status === "clicked" && !m.openedAt && m.channel === "email") upd.openedAt = when;
  if (TERMINAL.has(status)) { upd.status = status; upd.error = error; }
  else if (!TERMINAL.has(m.status) && (RANK[status] ?? 0) > (RANK[m.status] ?? 0)) upd.status = status;
  return ctx.deps.db.patch<Msg>("messages", ctx.tenantId, msgId, upd as Record<string, unknown>);
}
async function byProviderId(ctx: Ctx, providerId: string) { return (await ctx.deps.db.list<Msg>("messages", ctx.tenantId, { where: { providerId }, limit: 1 }))[0] || null; }

/* ---------------- webhooks ---------------- */
const OPTOUT = /^\s*(sair|parar|pare|stop|cancelar|descadastrar)\s*[.!]?\s*$/i;

/** Webhook da Meta: status das mensagens, respostas na caixa de entrada e descadastro por palavra-chave. */
export async function handleMetaWebhook(ctx: Ctx, body: MetaWebhook) {
  let statuses = 0, inbound = 0, optouts = 0;
  for (const e of body.entry || []) for (const ch of e.changes || []) {
    const v = ch.value || {};
    for (const s of v.statuses || []) {
      const m = await byProviderId(ctx, s.id);
      if (m) { await setStatus(ctx, m.id, s.status, s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : undefined, s.errors?.[0]?.message || s.errors?.[0]?.title); statuses++; }
    }
    for (const msg of v.messages || []) {
      const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || `[${msg.type}]`;
      const phone = normPhone(msg.from) || msg.from;
      const cust = await findByPhone(ctx, phone);
      const name = v.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
      const at = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : ctx.deps.now().toISOString();
      const item: InboxMessage = { id: "in_" + msg.id.replace(/[^A-Za-z0-9]/g, "").slice(-24), from: phone, customerId: cust?.id, name: name || cust?.name, text, at, status: "open" };
      if (await ctx.deps.db.get("inbox", ctx.tenantId, item.id)) continue; // reenvio do mesmo aviso
      await ctx.deps.db.put("inbox", ctx.tenantId, item as never);
      inbound++;
      if (cust && OPTOUT.test(text)) {
        await ctx.deps.db.patch("customers", ctx.tenantId, cust.id, { optinWhatsapp: false });
        await ctx.deps.db.patch("inbox", ctx.tenantId, item.id, { status: "resolved", optout: true });
        optouts++;
        const cfg = await waConfig(ctx);
        if (cfg?.enabled) { try { await waProvider(ctx, cfg).send(phone, { kind: "text", body: "Pronto, você não vai mais receber nossas mensagens por aqui. Para voltar, é só responder VOLTAR." }); } catch { /* resposta é cortesia */ } }
      } else if (cust && /^\s*voltar\s*$/i.test(text)) await ctx.deps.db.patch("customers", ctx.tenantId, cust.id, { optinWhatsapp: true });
    }
  }
  return { statuses, inbound, optouts };
}

/** Eventos do provedor de e-mail (Resend ou Brevo): entregue, devolvido, marcado como spam. */
export async function handleEmailEvent(ctx: Ctx, body: Record<string, unknown>) {
  const resend = body.type as string | undefined;
  const providerId = (resend ? (body.data as { email_id?: string })?.email_id : (body["message-id"] as string)) || "";
  const ev = resend ? resend.replace(/^email\./, "") : String(body.event || "");
  const map: Record<string, string> = { delivered: "delivered", bounced: "bounced", hard_bounce: "bounced", complained: "complained", spam: "complained", opened: "opened", clicked: "clicked", unique_opened: "opened", click: "clicked" };
  const status = map[ev];
  if (!status || !providerId) return { ok: false };
  const m = await byProviderId(ctx, providerId);
  if (!m) return { ok: false };
  if (status === "complained" || status === "bounced") await ctx.deps.db.patch("customers", ctx.tenantId, m.customerId, { emailStatus: status, ...(status === "complained" ? { optinEmail: false } : {}) });
  await setStatus(ctx, m.id, status === "complained" ? "failed" : status, undefined, status === "complained" ? "marcado como spam" : undefined);
  return { ok: true };
}

/* ---------------- rastreio de e-mail ---------------- */
export function parseMid(mid: string) { const [tenantId, msgId] = mid.replace(/\.gif$/, "").split("~"); return tenantId && msgId ? { tenantId, msgId } : null; }
export async function trackOpen(ctx: Ctx, msgId: string) { const m = await ctx.deps.db.get<Msg>("messages", ctx.tenantId, msgId); if (m && !m.openedAt) await setStatus(ctx, msgId, "opened"); }
/** Só redireciona para links que estavam no próprio e-mail (evita redirecionamento aberto). */
export async function trackClick(ctx: Ctx, msgId: string, url: string) {
  const m = await ctx.deps.db.get<Msg>("messages", ctx.tenantId, msgId);
  if (!m || !m.links?.includes(url)) return null;
  await setStatus(ctx, msgId, "clicked");
  return url;
}
export async function unsubToken(ctx: Ctx, customerId: string) {
  const payload = b64url(`${ctx.tenantId}.${customerId}`);
  const sig = (await hmac(ctx.deps.jwtSecret, payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
  return `${payload}.${sig}`;
}
export async function readUnsubToken(deps: Ctx["deps"], token: string) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = (await hmac(deps.jwtSecret, payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
  if (want !== sig) return null;
  const [tenantId, customerId] = unb64url(payload).split(".");
  return { tenantId, customerId };
}

/* ---------------- campanhas ---------------- */
export async function audience(ctx: Ctx, segmentId: string | undefined, channel: MessageChannel) {
  const now = ctx.deps.now();
  let cs = await ctx.deps.db.list<Customer & { id: string }>("customers", ctx.tenantId);
  if (segmentId) { const s = await ctx.deps.db.get<Segment & { id: string }>("segments", ctx.tenantId, segmentId); if (!s) throw new HttpError(404, "Segmento não encontrado"); cs = cs.filter((c) => inSegment(s, c, now)); }
  return { total: cs.length, reachable: cs.filter((c) => reachable(c, channel)) };
}

function inQuiet(q: [number, number] | undefined, h: number) { return !!q && (q[0] <= q[1] ? h >= q[0] && h < q[1] : h >= q[0] || h < q[1]); }

/** Envia em lotes; pode ser chamada várias vezes (retoma de onde parou). */
export async function sendCampaign(ctx: Ctx, id: string, batch = 500) {
  const { db } = ctx.deps; const now = ctx.deps.now();
  const camp = await db.get<Campaign & { id: string }>("campaigns", ctx.tenantId, id);
  if (!camp) throw new HttpError(404, "Campanha não encontrada");
  if (camp.status === "done") return { sent: 0, controle: 0, done: true };
  const tpl = await db.get<MessageTemplate & { id: string }>("message_templates", ctx.tenantId, camp.templateId);
  if (!tpl || tpl.channel !== camp.channel) throw new HttpError(422, "Modelo inválido para o canal da campanha");
  if (camp.channel === "email" && !(await emailConfig(ctx))?.enabled) throw new HttpError(422, "Configure o e-mail antes de enviar");
  if (camp.channel === "whatsapp" && !tpl.waName) throw new HttpError(422, "Campanha de WhatsApp precisa de modelo aprovado pela Meta");
  if (inQuiet(camp.quietHours, now.getHours())) { await db.patch("campaigns", ctx.tenantId, id, { status: "scheduled" }); return { sent: 0, controle: 0, done: false, waiting: "horário de silêncio" }; }
  if (camp.status !== "sending") await db.patch("campaigns", ctx.tenantId, id, { status: "sending", startedAt: camp.startedAt || now.toISOString() });
  const t = await tenantOf(ctx);
  const coupon = camp.couponId ? await db.get<Coupon & { id: string }>("coupons", ctx.tenantId, camp.couponId) : null;
  const { reachable: people } = await audience(ctx, camp.segmentId, camp.channel);
  const already = new Set((await db.list<Msg>("messages", ctx.tenantId, { where: { campaignId: id } })).map((m) => m.customerId));
  const recent = await db.list<Msg>("messages", ctx.tenantId, { since: new Date(+now - 7 * 864e5).toISOString() });
  const weekCount = new Map<string, number>(); for (const m of recent) if (m.group === "envio") weekCount.set(m.customerId, (weekCount.get(m.customerId) || 0) + 1);
  let sent = 0, controle = 0, n = 0;
  for (const c of people) {
    if (already.has(c.id)) continue;
    if (n >= batch) break;
    const group = hash(c.id + id) % 100 < camp.holdoutPercent ? "controle" : "envio";
    if (group === "envio" && (weekCount.get(c.id) || 0) >= camp.maxPerCustomerPerWeek) continue;
    n++;
    const link = trackedLink(ctx.deps.publicUrl, t.slug, camp.pageId, camp.channel, id);
    await deliver(ctx, { customer: c, channel: camp.channel, template: tpl, vars: baseVars(c, t, { cupom: coupon?.code || "", link }), ref: `camp:${id}`, group, campaignId: id, couponId: camp.couponId });
    if (group === "envio") sent++; else controle++;
  }
  const left = people.filter((c) => !already.has(c.id)).length - n;
  const done = left <= 0;
  if (done) await db.patch("campaigns", ctx.tenantId, id, { status: "done", finishedAt: now.toISOString() });
  return { sent, controle, done };
}

/** Relatório: funil da mensagem e pedidos em 7 dias, comparando com o grupo de controle (mesmo público, sem envio). */
export async function campaignReport(ctx: Ctx, id: string) {
  const { db } = ctx.deps;
  const [msgs, orders] = await Promise.all([db.list<Msg>("messages", ctx.tenantId, { where: { campaignId: id } }), db.list<Order & { id: string }>("orders", ctx.tenantId, { since: new Date(+ctx.deps.now() - 60 * 864e5).toISOString() })]);
  const conv = (list: Msg[]) => {
    let n = 0, revenue = 0;
    for (const m of list) {
      const o = orders.find((x) => x.customerId === m.customerId && x.status !== "cancelled" && +new Date(x.createdAt) > +new Date(m.createdAt) && +new Date(x.createdAt) - +new Date(m.createdAt) <= 7 * 864e5);
      if (o) { n++; revenue += o.total; }
    }
    return { n, revenue: r2(revenue), rate: list.length ? r2((n / list.length) * 100) : 0 };
  };
  const env = msgs.filter((m) => m.group === "envio"), ctl = msgs.filter((m) => m.group === "controle");
  const count = (f: (m: Msg) => boolean) => env.filter(f).length;
  const ok = env.filter((m) => !["failed", "bounced"].includes(m.status));
  const e = conv(env), k = conv(ctl);
  return {
    envio: env.length, controle: ctl.length,
    sent: ok.length, failed: env.length - ok.length,
    delivered: count((m) => !!m.deliveredAt), read: count((m) => !!(m.readAt || m.openedAt)), clicked: count((m) => !!m.clickedAt),
    orders: e.n, revenue: e.revenue, conversion: e.rate, controlConversion: k.rate,
    lift: ctl.length ? r2(e.rate - k.rate) : null,
    incrementalOrders: ctl.length ? Math.round((e.rate - k.rate) / 100 * env.length) : null,
    cost: r2(env.reduce((a, m) => a + (m.cost || 0), 0)),
  };
}

/** Chamado pelo agendador (cron): dispara campanhas agendadas e roda as automações. */
export async function tick(ctx: Ctx, runAutomations: (c: Ctx) => Promise<{ created: number; controle: number }>) {
  const now = ctx.deps.now();
  const camps = await ctx.deps.db.list<Campaign & { id: string }>("campaigns", ctx.tenantId);
  const due = camps.filter((c) => c.status === "sending" || (c.status === "scheduled" && (!c.scheduleAt || new Date(c.scheduleAt) <= now)));
  const results: Record<string, unknown> = {};
  for (const c of due) { try { results[c.id] = await sendCampaign(ctx, c.id); } catch (e) { results[c.id] = { error: String((e as Error).message) }; } }
  return { campaigns: results, automations: await runAutomations(ctx) };
}
