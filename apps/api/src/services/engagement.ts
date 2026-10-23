import {
  answerTriage, avoidHit, heroFromPreferences, mergeEngagement, npsKind, occasionLive, orderCategoriesByMood, pickTriage, uid,
  type Coupon, type Customer, type CustomerPreferences, type EngagementSettings, type LedgerEntry, type Order, type OrderFeedback, type TriageKind,
} from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";
import { emit } from "./integrations";

type C = Customer & { id: string };
type O = Order & { id: string };

export async function engagementSettings(ctx: Ctx): Promise<EngagementSettings> {
  const d = await ctx.deps.db.get<{ id: string; value: Partial<EngagementSettings> }>("settings", ctx.tenantId, "engagement");
  return mergeEngagement(d?.value);
}
export async function putEngagementSettings(ctx: Ctx, v: EngagementSettings) {
  await ctx.deps.db.put("settings", ctx.tenantId, { id: "engagement", value: v });
  return mergeEngagement(v);
}

/* ---------- formato mínimo do cardápio que a personalização mexe ---------- */
interface MenuLike {
  hero: unknown;
  categories: { id: string; name: string; itemIds: string[] }[];
  items: Record<string, { id: string; name: string; description?: string; categoryId: string; heroOptionNames?: string[] }>;
  groups: Record<string, { options: { id: string; name: string; description?: string }[] }>;
  customer: null | { orders: number };
}

/**
 * Aplica o que o cliente respondeu (triagem e pesquisas) ao cardápio já resolvido
 * e anexa a pergunta da vez e a configuração dos efeitos.
 */
export async function personalizeMenu<M extends MenuLike>(ctx: Ctx, m: M, customer: C | null): Promise<M & { triage: unknown; engagement: unknown }> {
  const s = await engagementSettings(ctx);
  const now = ctx.deps.now();
  const prefs = customer?.preferences;
  const occ = occasionLive(prefs, s, now);
  const out = m as M & { triage?: unknown; engagement?: unknown; [k: string]: unknown };

  // card do topo: a resposta de agora vale mais que a regra geral
  const heroLines = (m.hero as { action?: { kind: string; lines?: { itemId: string }[] } } | null)?.action;
  const lastItemIds = heroLines?.kind === "reorder" ? heroLines.lines?.map((l) => l.itemId) : undefined;
  const keepReorder = occ?.craving === "de_sempre" && heroLines?.kind === "reorder";
  const personal = keepReorder ? undefined : heroFromPreferences(prefs, s, now, Object.values(m.items), { lastItemIds });
  if (personal) out.hero = { ...personal, personal: true };

  // vontade da ocasião muda a ordem das categorias
  out.categories = orderCategoriesByMood(m.categories, occ?.mood);

  // o que a pessoa evita vai para o fim e ganha aviso
  if (prefs?.avoid?.length) {
    const tags = s.triage.avoidTags;
    for (const it of Object.values(m.items)) {
      const hit = avoidHit(`${it.name} ${it.description || ""}`, prefs.avoid, tags);
      if (hit) (it as Record<string, unknown>).avoidHit = hit;
    }
    out.categories = (out.categories as MenuLike["categories"]).map((c) => ({ ...c, itemIds: [...c.itemIds].sort((a, b) => Number(!!(m.items[a] as { avoidHit?: string })?.avoidHit) - Number(!!(m.items[b] as { avoidHit?: string })?.avoidHit)) }));
    for (const g of Object.values(m.groups)) {
      for (const o of g.options) { const hit = avoidHit(`${o.name} ${o.description || ""}`, prefs.avoid, tags); if (hit) (o as Record<string, unknown>).avoidHit = hit; }
      g.options = [...g.options].sort((a, b) => Number(!!(a as { avoidHit?: string }).avoidHit) - Number(!!(b as { avoidHit?: string }).avoidHit));
    }
  }

  // cupom do "antes de ir": só o código e o benefício
  let exitCoupon: Pick<Coupon, "code" | "name" | "type" | "value"> | undefined;
  if (s.effects.exitIntent.enabled && s.effects.exitIntent.couponId) {
    const cp = await ctx.deps.db.get<Coupon & { id: string }>("coupons", ctx.tenantId, s.effects.exitIntent.couponId);
    if (cp?.active) exitCoupon = { code: cp.code, name: cp.name, type: cp.type, value: cp.value };
  }
  out.triage = pickTriage(s, customer ? { orders: m.customer?.orders ?? customer.orders, preferences: prefs } : null, now);
  out.engagement = {
    effects: { ...s.effects, exitIntent: { enabled: s.effects.exitIntent.enabled, title: s.effects.exitIntent.title, text: s.effects.exitIntent.text, coupon: exitCoupon } },
    postOrder: { enabled: s.postOrder.enabled, reasonsLow: s.postOrder.reasonsLow, reasonsHigh: s.postOrder.reasonsHigh, detractorCredit: s.postOrder.detractorCredit },
    avoid: (prefs?.avoid || []).map((id) => s.triage.avoidTags.find((t) => t.id === id)?.label).filter(Boolean),
    occasion: occ || null,
  };
  return out as M & { triage: unknown; engagement: unknown };
}

const EFFECT_MSG: Record<string, (v: string[]) => string> = {
  party: (v) => (v[0] === "galera" ? "Pronto: a pizza grande da galera está no topo." : v[0] === "dupla" ? "Pronto: separamos a opção certa pra dois." : "Pronto: separamos a opção certa pra você."),
  mood: (v) => (v[0] === "doce" ? "Doces primeiro, então." : v[0] === "salgada" ? "Salgadas primeiro, então." : "Anotado: salgada e doce."),
  craving: (v) => (v[0] === "novidade" ? "Separamos uma novidade pra você." : "Seu pedido de sempre está no topo."),
  avoid: (v) => (v.filter((x) => x !== "nada").length ? "Anotado. Os sabores com isso ficam por último e avisamos na montagem." : "Anotado: você come de tudo."),
};

export async function saveTriage(ctx: Ctx, customerId: string, i: { kind: TriageKind | "skip"; values: string[]; sessionId?: string }) {
  const c = await ctx.deps.db.get<C>("customers", ctx.tenantId, customerId);
  if (!c) throw new HttpError(401, "Entre com seu telefone");
  const now = ctx.deps.now();
  const prefs: CustomerPreferences = answerTriage(c.preferences, i.kind, i.values, now);
  await ctx.deps.db.patch("customers", ctx.tenantId, c.id, { preferences: prefs });
  await ctx.deps.db.events.insert(ctx.tenantId, [{ id: uid("ev"), sessionId: i.sessionId || "server", customerId: c.id, name: i.kind === "skip" ? "triage_skip" : "triage_answer", ts: now.toISOString(), props: { kind: i.kind, values: i.values } }]);
  return { ok: true, message: i.kind === "skip" ? "" : EFFECT_MSG[i.kind]?.(i.values) || "Anotado." };
}

/** Pesquisa pós-pedido: grava, recupera o detrator, convida o promotor e guarda o "quero provar". */
export async function saveFeedback(ctx: Ctx, orderId: string, customerId: string | undefined, i: { nps: number; reasons: string[]; wantToTry?: string; comment?: string; sessionId?: string }) {
  const { db } = ctx.deps; const t = ctx.tenantId; const now = ctx.deps.now();
  const o = await db.get<O>("orders", t, orderId);
  if (!o || !o.customerId || o.customerId !== customerId) throw new HttpError(404, "Pedido não encontrado");
  if (o.feedback) throw new HttpError(409, "Você já avaliou este pedido. Obrigado!");
  if (!["dispatched", "concluded"].includes(o.status)) throw new HttpError(422, "A avaliação abre quando o pedido sair para entrega");
  const s = await engagementSettings(ctx);
  const kind = npsKind(i.nps);
  const fb: OrderFeedback = { nps: i.nps, reasons: i.reasons.slice(0, 6), wantToTry: i.wantToTry, comment: i.comment?.slice(0, 600), at: now.toISOString(), kind };

  const c = await db.get<C>("customers", t, o.customerId);
  // detrator: crédito de desculpas + alerta para a loja agir no mesmo dia
  if (kind === "detrator" && s.postOrder.detractorCredit > 0 && c) {
    const e: LedgerEntry = { id: uid("led"), customerId: c.id, type: "bonus", amount: s.postOrder.detractorCredit, orderId: o.id, note: `Desculpas pelo pedido #${o.displayId} (pesquisa)`, createdAt: now.toISOString(), expiresAt: new Date(+now + s.postOrder.creditExpiresInDays * 864e5).toISOString() };
    await db.put("ledger", t, e as never);
    fb.creditGiven = e.amount;
  }
  await db.patch("orders", t, o.id, { feedback: fb });
  if (c) {
    const prefs: CustomerPreferences = { ...(c.preferences || {}), lastNps: i.nps, lastSurveyAt: fb.at };
    if (i.wantToTry) prefs.wantToTry = [i.wantToTry, ...(prefs.wantToTry || []).filter((x) => x !== i.wantToTry)].slice(0, 5);
    await db.patch("customers", t, c.id, { preferences: prefs });
  }
  await db.events.insert(t, [{ id: uid("ev"), sessionId: i.sessionId || "server", customerId: o.customerId, name: "feedback", ts: fb.at, props: { orderId: o.id, nps: i.nps, kind } }]);
  if (kind === "detrator") {
    if (s.postOrder.alertPhone) {
      const txt = `⚠️ Nota ${i.nps} no pedido #${o.displayId} · ${c?.name || "cliente"} +${c?.phone || ""}\nMotivos: ${fb.reasons.join(", ") || "—"}${fb.comment ? `\n"${fb.comment}"` : ""}\nCrédito automático: R$ ${(fb.creditGiven || 0).toFixed(2).replace(".", ",")}. Ligue hoje.`;
      await ctx.deps.messenger.send(t, s.postOrder.alertPhone, txt).catch(() => undefined);
    }
    await emit(ctx, "feedback.detractor", { orderId: o.id, displayId: o.displayId, customerId: o.customerId, ...fb });
  }
  await emit(ctx, "feedback.created", { orderId: o.id, customerId: o.customerId, ...fb });
  const message = kind === "detrator"
    ? `Sentimos muito. ${fb.creditGiven ? `Colocamos R$ ${fb.creditGiven.toFixed(2).replace(".", ",")} de crédito na sua conta para o próximo pedido, e ` : ""}a loja vai falar com você.`
    : kind === "promotor" ? "Que bom! Se puder, conte isso para mais gente." : "Obrigado! Vamos usar isso para acertar mais na próxima.";
  return { kind, message, creditGiven: fb.creditGiven || 0, googleReviewUrl: kind === "promotor" ? s.postOrder.googleReviewUrl : undefined };
}

/* ---------- relatório do painel ---------- */
export async function engagementReport(ctx: Ctx, days: number) {
  const { db } = ctx.deps; const t = ctx.tenantId; const now = ctx.deps.now();
  const from = new Date(+now - days * 864e5).toISOString(), prevFrom = new Date(+now - 2 * days * 864e5).toISOString();
  const [orders, customers, events, items] = await Promise.all([
    db.list<O>("orders", t, { since: prevFrom }), db.list<C>("customers", t), db.events.list(t, { since: from }), db.list<{ id: string; name: string }>("items", t),
  ]);
  const C0 = new Map(customers.map((c) => [c.id, c]));
  const fbIn = (a: string, b: string) => orders.filter((o) => o.feedback && o.feedback.at >= a && o.feedback.at < b);
  const cur = fbIn(from, now.toISOString()), prev = fbIn(prevFrom, from);
  const score = (l: O[]) => { const v = l.map((o) => o.feedback!.nps); const p = v.filter((x) => x >= 9).length, d = v.filter((x) => x <= 6).length; return { nps: v.length ? Math.round(((p - d) / v.length) * 100) : 0, n: v.length, promotores: p, neutros: v.length - p - d, detratores: d }; };
  const dist = Array.from({ length: 11 }, (_, n) => cur.filter((o) => o.feedback!.nps === n).length);
  const reasons = (k: "low" | "high") => { const m = new Map<string, number>(); for (const o of cur) if ((k === "high") === (o.feedback!.nps >= 9)) for (const r of o.feedback!.reasons) m.set(r, (m.get(r) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })); };
  const wantMap = new Map<string, number>(); for (const o of cur) if (o.feedback!.wantToTry) wantMap.set(o.feedback!.wantToTry, (wantMap.get(o.feedback!.wantToTry) || 0) + 1);
  const itemName = (id: string) => items.find((i) => i.id === id)?.name.split(" · ")[0] || id;

  // recuperação: detratores que voltaram a pedir depois da nota
  const detr = orders.filter((o) => o.feedback?.kind === "detrator" && o.feedback.at >= prevFrom);
  const allAfter = await db.list<O>("orders", t, { since: prevFrom });
  const recovered = detr.filter((d) => allAfter.some((o) => o.customerId === d.customerId && o.createdAt > d.feedback!.at && o.status !== "cancelled")).length;

  // triagem
  const tri = events.filter((e) => e.name === "triage_answer" || e.name === "triage_skip" || e.name === "triage_shown");
  const shown = tri.filter((e) => e.name === "triage_shown").length, answered = tri.filter((e) => e.name === "triage_answer").length, skipped = tri.filter((e) => e.name === "triage_skip").length;
  const answers = new Map<string, number>();
  for (const e of tri) if (e.name === "triage_answer") for (const v of (e.props?.values as string[]) || []) { const k = `${e.props?.kind}:${v}`; answers.set(k, (answers.get(k) || 0) + 1); }

  // efeitos: conversão das sessões que viram cada um (associação, não causa — use o holdout para medir incremento)
  const sessionsWith = (name: string) => new Set(events.filter((e) => e.name === name).map((e) => e.sessionId));
  const bought = sessionsWith("order_placed");
  const allSessions = sessionsWith("visit");
  const conv = (ss: Set<string>) => (ss.size ? ([...ss].filter((x) => bought.has(x)).length / ss.size) * 100 : 0);
  const FX: [string, string][] = [["triage_answer", "Respondeu a triagem"], ["fx_glow_cta", "Brilho no botão"], ["fx_glow_preset", "Brilho na sugestão"], ["fx_free_ship_nudge", "Empurrão do frete grátis"], ["exit_shown", "Antes de ir"], ["return_toast", "Sacola continua aqui"], ["popup_shown", "Pop-up de cupom"]];
  const effects = FX.map(([name, label]) => { const ss = sessionsWith(name); return { name, label, sessions: ss.size, conversion: Math.round(conv(ss) * 10) / 10 }; });

  return {
    days, nps: score(cur), prevNps: score(prev), distribution: dist,
    reasonsLow: reasons("low"), reasonsHigh: reasons("high"),
    wantToTry: [...wantMap.entries()].sort((a, b) => b[1] - a[1]).map(([id, value]) => ({ label: itemName(id), value })),
    detractors: { total: detr.length, recovered, credit: detr.reduce((a, o) => a + (o.feedback!.creditGiven || 0), 0) },
    responseRate: (() => { const eligible = orders.filter((o) => o.createdAt >= from && (o.status === "concluded" || o.status === "dispatched") && o.customerId).length; return eligible ? Math.round((cur.length / eligible) * 1000) / 10 : 0; })(),
    comments: [...cur].sort((a, b) => b.feedback!.at.localeCompare(a.feedback!.at)).slice(0, 30).map((o) => ({ orderId: o.id, displayId: o.displayId, at: o.feedback!.at, nps: o.feedback!.nps, kind: o.feedback!.kind, reasons: o.feedback!.reasons, comment: o.feedback!.comment, customer: C0.get(o.customerId!)?.name || "Cliente", customerId: o.customerId, creditGiven: o.feedback!.creditGiven })),
    triage: { shown, answered, skipped, answers: [...answers.entries()].sort((a, b) => b[1] - a[1]).map(([k, value]) => ({ key: k, value })) },
    effects, baseline: Math.round(conv(allSessions) * 10) / 10, sessions: allSessions.size,
  };
}
