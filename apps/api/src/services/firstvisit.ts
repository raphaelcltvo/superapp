import {
  computePersonas, matchCampaign, matchPersona, normPhone, targetFromAnswers, uid,
  type Coupon, type Customer, type CustomerPreferences, type FvCatalog, type FvQuestion, type FvTarget, type Order, type PersonaModel,
} from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";
import type { Snapshot } from "./catalog";
import { engagementSettings } from "./engagement";
import { findByPhone } from "./customers";
import { emit } from "./integrations";

type C = Customer & { id: string };
type O = Order & { id: string };

export interface Lead {
  id: string;
  sessionId?: string;
  answers: Record<string, string>;
  skipped?: boolean;
  target?: FvTarget;
  questionSource?: "personas" | "playbook";
  source?: string; campaign?: string;
  contact?: { name?: string; phone?: string; email?: string };
  consent?: { whatsapp: boolean; email: boolean; text: string; at: string };
  /** cliente criado como lead (telefone ainda não confirmado) */
  customerId?: string;
  couponUnlocked?: boolean; couponCode?: string;
  createdAt: string; updatedAt?: string; mergedAt?: string;
}

export const CONSENT_TEXT = "Aceito receber da marca ofertas e avisos pelo WhatsApp e/ou e-mail marcados. Posso cancelar quando quiser.";

export const catalogFromSnap = (snap: Snapshot): FvCatalog => ({
  items: snap.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, categoryId: i.categoryId, kind: i.kind, price: i.price, isDrink: i.isDrink })),
  categories: snap.categories.filter((c) => c.visible).map((c) => ({ id: c.id, name: c.name, pricingLocked: c.pricingLocked })),
});

/* ---------- personas da base (cache por marca, recalcula quando entram pedidos) ---------- */
const cache = new Map<string, { key: string; at: number; model: PersonaModel | null }>();
export async function personaModel(ctx: Ctx, snap: Snapshot, opts: { maxQuestions?: number; playbook?: FvQuestion[] } = {}) {
  const since = new Date(+ctx.deps.now() - 180 * 864e5).toISOString();
  const n = await ctx.deps.db.count("orders", ctx.tenantId, { since });
  const key = `${n}|${snap.items.length}|${opts.maxQuestions}|${JSON.stringify(opts.playbook?.map((q) => [q.id, q.title, q.enabled, q.options.map((o) => o.label)]) || [])}`;
  const hit = cache.get(ctx.tenantId);
  if (hit && hit.key === key && Date.now() - hit.at < 10 * 60e3) return hit.model;
  const orders = await ctx.deps.db.list<O>("orders", ctx.tenantId, { since, limit: 20000 });
  const model = computePersonas(orders, catalogFromSnap(snap), opts);
  cache.set(ctx.tenantId, { key, at: Date.now(), model });
  return model;
}

/** Perguntas da vez: personas da base quando houver (e a marca permitir), senão o roteiro do segmento. */
export async function firstVisitQuestions(ctx: Ctx, snap: Snapshot) {
  const s = (await engagementSettings(ctx)).firstVisit;
  const playbook = s.playbook.filter((q) => q.enabled !== false);
  const model = s.source === "auto" ? await personaModel(ctx, snap, { maxQuestions: s.maxQuestions, playbook: s.playbook }) : null;
  if (model) return { settings: s, model, source: "personas" as const, questions: model.questions.slice(0, s.maxQuestions) };
  return { settings: s, model: null, source: "playbook" as const, questions: playbook.slice(0, s.maxQuestions) };
}

const couponPublic = (c?: Coupon) => (c && c.active ? { name: c.name, type: c.type, value: c.value, maxDiscount: c.maxDiscount, minSubtotal: c.minSubtotal } : null);

interface MenuShape {
  hero: unknown;
  items: Record<string, { id: string; name: string; categoryId: string }>;
  categories: { id: string; name: string; itemIds: string[] }[];
  customer: unknown;
}

/**
 * Topo por jornada para quem não é cliente identificado:
 * campanha (utm) → produto do anúncio; lead que respondeu → o que pedem os clientes parecidos;
 * primeira vez → a triagem (a pergunta vai junto do cardápio).
 */
export async function applyFirstVisit<M extends MenuShape>(ctx: Ctx, menu: M, snap: Snapshot, v: { customer: C | null; leadId?: string; source?: string; campaign?: string; content?: string }) {
  const es = await engagementSettings(ctx);
  const out = menu as M & { firstVisit?: unknown; lead?: unknown; [k: string]: unknown };
  const nameOf = (id: string) => menu.items[id]?.name.split(" · ")[0];

  // 1) campanha: o criativo decide o topo
  const camp = matchCampaign(es.campaigns || [], { source: v.source, campaign: v.campaign, content: v.content });
  let campaignHit = false;
  if (camp) {
    if (camp.target.kind === "item" && menu.items[camp.target.itemId]) { out.hero = { kicker: camp.kicker, title: nameOf(camp.target.itemId), sub: camp.sub, action: { kind: "open_item", itemId: camp.target.itemId }, campaign: camp.id }; campaignHit = true; }
    if (camp.target.kind === "category") { const cid = camp.target.categoryId; const cat = menu.categories.find((c) => c.id === cid); if (cat) { out.hero = { kicker: camp.kicker, title: cat.name, sub: camp.sub, action: { kind: "category", categoryId: cid }, campaign: camp.id }; out.categories = [cat, ...menu.categories.filter((c) => c.id !== cid)]; campaignHit = true; } }
  }

  // 2) lead que já respondeu: clientes parecidos
  let lead: Lead | null = null;
  if (!v.customer && v.leadId) lead = await ctx.deps.db.get<Lead>("leads", ctx.tenantId, v.leadId);
  if (lead?.target && !campaignHit) {
    const t = lead.target;
    if (t.itemId && menu.items[t.itemId]) out.hero = { kicker: t.personaName ? "Quem pede parecido com você" : "Separamos pra você", title: t.title || nameOf(t.itemId), sub: t.personaName ? `Clientes como você: ${t.personaName.toLowerCase()}` : "Pelo que você respondeu agora", action: { kind: "open_item", itemId: t.itemId, selection: t.selection }, personal: true };
    const rank = (id: string) => { const i = t.categoryOrder.indexOf(id); return i < 0 ? 999 : i; };
    out.categories = [...(out.categories as M["categories"])].sort((a, b) => rank(a.id) - rank(b.id));
  }

  // 3) primeira visita: a triagem vai junto (só para quem não é cliente e ainda não respondeu/pulou)
  out.firstVisit = null;
  if (!v.customer && !lead && es.firstVisit.enabled && (!campaignHit || es.firstVisit.afterCampaignSeconds > 0)) {
    const q = await firstVisitQuestions(ctx, snap);
    if (q.questions.length) {
      const cp = es.firstVisit.couponId ? snap.coupons.find((c) => c.id === es.firstVisit.couponId) : undefined;
      out.firstVisit = {
        mode: es.firstVisit.mode, source: q.source,
        coupon: couponPublic(cp),
        questions: q.questions.map((x) => ({ id: x.id, title: x.title, options: x.options.map((o) => ({ id: o.id, label: o.label })) })),
        afterSeconds: campaignHit ? es.firstVisit.afterCampaignSeconds : 0,
        consentText: CONSENT_TEXT,
      };
    }
  }
  out.lead = lead ? { id: lead.id, couponUnlocked: !!lead.couponUnlocked, couponCode: lead.couponCode } : null;
  return out as M & { firstVisit: unknown; lead: unknown };
}

const emailOk = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export interface FirstVisitInput {
  leadId?: string; sessionId?: string; skip?: boolean; answers: Record<string, string>;
  contact?: { name?: string; phone?: string; email?: string; optinWhatsapp?: boolean; optinEmail?: boolean };
  source?: string; campaign?: string;
}

/** Grava as respostas, acha os clientes parecidos, libera o cupom e (se veio contato) cria o lead no CRM. */
export async function saveFirstVisit(ctx: Ctx, snap: Snapshot, i: FirstVisitInput) {
  const { db } = ctx.deps; const t = ctx.tenantId; const now = ctx.deps.now().toISOString();
  const prev = i.leadId ? await db.get<Lead>("leads", t, i.leadId) : null;
  if (prev?.mergedAt) throw new HttpError(409, "Você já respondeu");
  const lead: Lead = prev || { id: uid("lead"), answers: {}, createdAt: now };
  lead.sessionId = i.sessionId || lead.sessionId; lead.source = lead.source || i.source; lead.campaign = lead.campaign || i.campaign; lead.updatedAt = now;
  const ev = (name: string, props?: Record<string, unknown>) => db.events.insert(t, [{ id: uid("ev"), sessionId: i.sessionId || lead.id, customerId: lead.customerId, name, ts: now, source: i.source, props: { leadId: lead.id, ...props } }]);

  if (i.skip) {
    lead.skipped = true; await db.put("leads", t, lead as never); await ev("fv_skip");
    return { leadId: lead.id, skipped: true, couponUnlocked: false, coupon: null, message: "" };
  }

  const { settings, model, source, questions } = await firstVisitQuestions(ctx, snap);
  // só respostas às perguntas da vez, com opções válidas
  const answers: Record<string, string> = { ...lead.answers };
  for (const q of questions) { const a = i.answers[q.id]; if (a && q.options.some((o) => o.id === a)) answers[q.id] = a; }
  const answeredAll = questions.every((q) => answers[q.id]);
  if (!Object.keys(answers).length) throw new HttpError(422, "Responda pelo menos uma pergunta");
  lead.answers = answers; lead.questionSource = source; lead.skipped = false;

  // clientes parecidos (base) ou roteiro (sem base)
  const catalog = catalogFromSnap(snap);
  const persona = model ? matchPersona(model, answers, questions) : null;
  const fallback = targetFromAnswers(catalog, questions, answers);
  lead.target = persona && persona.topItemId && catalog.items.some((x) => x.id === persona.topItemId)
    ? { itemId: persona.topItemId, selection: persona.topSelection, title: persona.topTitle || catalog.items.find((x) => x.id === persona.topItemId)!.name.split(" · ")[0], categoryOrder: persona.categoryOrder, personaId: persona.id, personaName: persona.name }
    : fallback;

  // contato (sem senha): alimenta o CRM; WhatsApp só vale depois de confirmar o telefone
  const c = i.contact;
  const phone = c?.phone ? normPhone(c.phone) : undefined;
  if (c?.phone && !phone) throw new HttpError(422, "Celular inválido");
  if (c?.email && !emailOk(c.email)) throw new HttpError(422, "E-mail inválido");
  if (c && (phone || c.email)) {
    lead.contact = { name: c.name?.trim() || undefined, phone, email: c.email?.trim().toLowerCase() || undefined };
    lead.consent = { whatsapp: !!c.optinWhatsapp, email: !!c.optinEmail, text: CONSENT_TEXT, at: now };
    if (phone && !lead.customerId) {
      const existing = await findByPhone(ctx, phone);
      // telefone já é de um cliente: não mexe no cadastro dele sem a confirmação por código
      if (!existing) {
        const cust: C = { id: uid("cus"), name: lead.contact.name, phone, email: lead.contact.email, optinEmail: lead.consent.email, optinWhatsapp: false, source: lead.source, orders: 0, spent: 0, tags: ["lead"], createdAt: now, preferences: { firstVisit: { answers, personaId: lead.target.personaId, personaName: lead.target.personaName, at: now } } } as C;
        await db.put("customers", t, cust as never);
        lead.customerId = cust.id;
        await emit(ctx, "customer.created", { ...cust, lead: true });
      }
    }
  }

  // cupom: reward = respondeu; gate = respondeu tudo + celular + e-mail
  const cp = settings.couponId ? snap.coupons.find((x) => x.id === settings.couponId && x.active) : undefined;
  const unlock = !!cp && (settings.mode === "reward" ? answeredAll : answeredAll && !!phone && emailOk(lead.contact?.email));
  if (unlock && cp) { lead.couponUnlocked = true; lead.couponCode = cp.code; }
  await db.put("leads", t, lead as never);
  await ev("fv_answered", { answers, personaId: lead.target.personaId, source });
  if (lead.contact) await ev("fv_lead", { phone: !!phone, email: !!lead.contact.email });
  if (unlock) await ev("fv_coupon", { code: cp!.code });

  const needs = settings.mode === "gate" && !unlock && cp ? [!answeredAll && "respostas", !phone && "celular", !emailOk(lead.contact?.email) && "e-mail"].filter(Boolean) as string[] : [];
  return {
    leadId: lead.id, skipped: false,
    hero: { title: lead.target.title, personaName: lead.target.personaName },
    couponUnlocked: !!lead.couponUnlocked,
    coupon: lead.couponUnlocked && cp ? { code: cp.code, name: cp.name, type: cp.type, value: cp.value } : null,
    needs,
    message: lead.target.personaName ? `Quem pede parecido com você costuma pedir ${lead.target.title}.` : `Separamos ${lead.target.title} pra você.`,
  };
}

/** Telefone confirmado por código: o lead vira parte do cliente (respostas, origem, e-mail e consentimento). */
export async function mergeLead(ctx: Ctx, leadId: string, cust: Customer): Promise<Customer | null> {
  const { db } = ctx.deps; const t = ctx.tenantId;
  const lead = await db.get<Lead>("leads", t, leadId);
  if (!lead || lead.mergedAt) return null;
  // o lead criado com outro telefone não se mistura com este cliente
  if (lead.contact?.phone && lead.contact.phone !== cust.phone) return null;
  const now = ctx.deps.now().toISOString();
  const prefs: CustomerPreferences = { ...(cust.preferences || {}) };
  if (lead.target) prefs.firstVisit = { answers: lead.answers, personaId: lead.target.personaId, personaName: lead.target.personaName, at: lead.updatedAt || lead.createdAt };
  const patch: Record<string, unknown> = { preferences: prefs, tags: (cust.tags || []).filter((x) => x !== "lead") };
  if (!cust.source && lead.source) patch.source = lead.source;
  if (!cust.email && lead.contact?.email) patch.email = lead.contact.email;
  if (lead.consent?.email) patch.optinEmail = true;
  if (lead.consent?.whatsapp) patch.optinWhatsapp = true;
  if (!cust.name && lead.contact?.name) patch.name = lead.contact.name;
  const upd = await db.patch<C>("customers", t, (cust as C).id, patch);
  await db.patch("leads", t, lead.id, { mergedAt: now, customerId: (cust as C).id });
  return upd;
}

/* ---------- painel ---------- */
export async function firstVisitAdmin(ctx: Ctx, snap: Snapshot, days: number) {
  const q = await firstVisitQuestions(ctx, snap);
  const model = q.settings.source === "auto" ? q.model : await personaModel(ctx, snap, { maxQuestions: q.settings.maxQuestions, playbook: q.settings.playbook });
  const names = Object.fromEntries(snap.items.map((i) => [i.id, i.name.split(" · ")[0]]));
  const since = new Date(+ctx.deps.now() - days * 864e5).toISOString();
  const evs = await ctx.deps.db.events.list(ctx.tenantId, { since });
  const sess = (n: string) => new Set(evs.filter((e) => e.name === n).map((e) => e.sessionId));
  const answered = sess("fv_answered"), bought = sess("order_placed");
  return {
    source: q.source, questions: q.questions,
    personas: (model?.personas || []).map((p) => ({ id: p.id, name: p.name, share: p.share, customers: p.customers, avgTicket: p.avgTicket, top: p.topTitle || (p.topItemId ? names[p.topItemId] : undefined), centroid: p.centroid })),
    customers: model?.customers || 0, ticketRange: model?.ticketRange,
    report: { shown: sess("fv_shown").size, answered: answered.size, skipped: sess("fv_skip").size, leads: sess("fv_lead").size, coupons: sess("fv_coupon").size, converted: [...answered].filter((s) => bought.has(s)).length },
  };
}
