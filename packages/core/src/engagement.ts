/**
 * Pesquisa inteligente e engajamento.
 *
 * - Triagem: 1 pergunta, 1 toque, só para quem já comprou, no máximo a cada N dias.
 *   A resposta muda o cardápio na hora (card do topo, ordem das categorias, itens com o que a pessoa evita).
 * - Pós-pedido: NPS + motivo + "o que quer provar da próxima vez". Detrator recebe crédito e a loja é avisada;
 *   promotor é convidado a avaliar no Google; o "quero provar" vira o card do topo na próxima visita.
 * - Efeitos: vibração, brilho no botão certo, empurrão do frete grátis, "antes de ir", "sua sacola continua aqui".
 *   Dose: no máximo 1 efeito por tela e 1 cupom por visita; respeita "reduzir movimento".
 */
import type { ID } from "./types";
import { DEFAULT_FIRST_VISIT, type CampaignTarget, type FirstVisitSettings } from "./firstvisit";

export type PartySize = "solo" | "dupla" | "galera";
export type Mood = "salgada" | "doce" | "ambas";
export type Craving = "de_sempre" | "novidade";

export interface CustomerPreferences {
  /** resposta da ocasião (vale por algumas horas) */
  occasion?: { partySize?: PartySize; mood?: Mood; craving?: Craving; at: string };
  /** ids de "evitar" (cebola, carne...) — duráveis */
  avoid?: string[];
  /** itens que a pessoa disse que quer provar */
  wantToTry?: ID[];
  /** último NPS informado */
  lastNps?: number;
  lastSurveyAt?: string;
  triageAskedAt?: string;
  triageAnswers?: number;
  /** triagem de primeira visita (veio do lead ao confirmar o telefone) */
  firstVisit?: { answers: Record<string, string>; personaId?: string; personaName?: string; at: string };
}

export interface OrderFeedback {
  nps: number;
  reasons: string[];
  wantToTry?: ID;
  comment?: string;
  at: string;
  /** promotor | neutro | detrator */
  kind: NpsKind;
  creditGiven?: number;
}
export type NpsKind = "promotor" | "neutro" | "detrator";

declare module "./types" {
  interface Customer { preferences?: CustomerPreferences }
  interface Order { feedback?: OrderFeedback }
}

export type TriageKind = "party" | "mood" | "craving" | "avoid";
export interface TriageQuestionCfg { kind: TriageKind; enabled: boolean; title: string }
export interface AvoidTag { id: string; label: string; keywords: string[] }

export interface EngagementSettings {
  /** primeira visita: triagem com cupom de boas-vindas */
  firstVisit: FirstVisitSettings;
  /** topo do cardápio por campanha (utm) */
  campaigns: CampaignTarget[];
  triage: {
    enabled: boolean;
    /** pergunta de novo só depois de N dias (por cliente) */
    cooldownDays: number;
    /** a ocasião (quantas pessoas, salgada/doce) vale por N horas */
    occasionHours: number;
    questions: TriageQuestionCfg[];
    /** o card do topo para cada tamanho de grupo */
    partyItems: Partial<Record<PartySize, ID>>;
    /** item de novidade sugerido para quem quer "algo novo" */
    noveltyItemId?: ID;
    avoidTags: AvoidTag[];
  };
  postOrder: {
    enabled: boolean;
    /** motivos sugeridos por faixa */
    reasonsLow: string[];
    reasonsHigh: string[];
    /** crédito de cashback para detrator (0 = não dá) */
    detractorCredit: number;
    creditExpiresInDays: number;
    /** telefone que recebe o alerta de detrator (WhatsApp) */
    alertPhone?: string;
    googleReviewUrl?: string;
  };
  effects: {
    vibrate: boolean;
    /** brilho no botão quando a montagem fica pronta */
    glowCta: boolean;
    /** brilho na sugestão "1 toque" depois de N s parado na montagem (0 = desliga) */
    glowPresetSeconds: number;
    /** empurrão quando falta até R$ X para o frete grátis (0 = desliga) */
    freeShippingNudge: number;
    exitIntent: { enabled: boolean; couponId?: ID; title: string; text: string };
    /** "sua sacola continua aqui" ao voltar depois de N s fora (0 = desliga) */
    returnAfterSeconds: number;
    /** vibra quando o pedido muda de status */
    statusBuzz: boolean;
  };
}

export const DEFAULT_ENGAGEMENT: EngagementSettings = {
  firstVisit: DEFAULT_FIRST_VISIT,
  campaigns: [],
  triage: {
    enabled: true, cooldownDays: 3, occasionHours: 6,
    questions: [
      { kind: "party", enabled: true, title: "Hoje é pra quantas pessoas?" },
      { kind: "mood", enabled: true, title: "Bateu vontade de quê?" },
      { kind: "craving", enabled: true, title: "O de sempre ou quer provar algo novo?" },
      { kind: "avoid", enabled: true, title: "Tem algo que você não come?" },
    ],
    partyItems: {},
    avoidTags: [
      { id: "cebola", label: "Cebola", keywords: ["cebola"] },
      { id: "azeitona", label: "Azeitona", keywords: ["azeitona"] },
      { id: "carne", label: "Carne", keywords: ["calabresa", "presunto", "bacon", "frango", "carne", "lombo", "pepperoni", "linguiça"] },
      { id: "pimenta", label: "Pimenta", keywords: ["pimenta", "jalapeño", "picante"] },
    ],
  },
  postOrder: {
    enabled: true,
    reasonsLow: ["Chegou frio", "Demorou", "Faltou item", "Sabor", "Embalagem", "Atendimento"],
    reasonsHigh: ["Sabor", "Chegou quentinha", "Rapidez", "Preço", "Embalagem", "Massa"],
    detractorCredit: 10, creditExpiresInDays: 30,
  },
  effects: {
    vibrate: true, glowCta: true, glowPresetSeconds: 8, freeShippingNudge: 15,
    exitIntent: { enabled: true, title: "Antes de ir…", text: "Guardamos sua sacola. Se fechar agora, ela continua aqui quando voltar." },
    returnAfterSeconds: 45, statusBuzz: true,
  },
};

export function mergeEngagement(v?: Partial<EngagementSettings> | null): EngagementSettings {
  const d = DEFAULT_ENGAGEMENT;
  if (!v) return d;
  return {
    firstVisit: { ...d.firstVisit, ...(v.firstVisit || {}) },
    campaigns: v.campaigns || d.campaigns,
    triage: { ...d.triage, ...(v.triage || {}) },
    postOrder: { ...d.postOrder, ...(v.postOrder || {}) },
    effects: { ...d.effects, ...(v.effects || {}), exitIntent: { ...d.effects.exitIntent, ...(v.effects?.exitIntent || {}) } },
  };
}

export const npsKind = (n: number): NpsKind => (n >= 9 ? "promotor" : n >= 7 ? "neutro" : "detrator");
/** NPS = % promotores − % detratores (−100 a 100). */
export function npsScore(values: number[]) {
  if (!values.length) return { nps: 0, n: 0, promotores: 0, neutros: 0, detratores: 0 };
  const p = values.filter((v) => v >= 9).length, d = values.filter((v) => v <= 6).length;
  return { nps: Math.round(((p - d) / values.length) * 100), n: values.length, promotores: p, neutros: values.length - p - d, detratores: d };
}

/* ---------------- triagem ---------------- */
export interface TriageOption { id: string; label: string; hint?: string }
export interface TriageQuestion { kind: TriageKind; title: string; options: TriageOption[]; multi?: boolean }

const OPTIONS: Record<Exclude<TriageKind, "avoid">, TriageOption[]> = {
  party: [{ id: "solo", label: "Só eu" }, { id: "dupla", label: "A dois" }, { id: "galera", label: "Família ou galera" }],
  mood: [{ id: "salgada", label: "Salgada" }, { id: "doce", label: "Doce" }, { id: "ambas", label: "As duas" }],
  craving: [{ id: "de_sempre", label: "O de sempre" }, { id: "novidade", label: "Algo novo" }],
};

const hoursSince = (iso: string | undefined, now: Date) => (iso ? (+now - +new Date(iso)) / 36e5 : Infinity);
export function occasionLive(p: CustomerPreferences | undefined, s: EngagementSettings, now: Date) {
  return p?.occasion && hoursSince(p.occasion.at, now) < s.triage.occasionHours ? p.occasion : undefined;
}

/**
 * Escolhe a pergunta da vez. Só para quem já pediu, respeitando o intervalo.
 * Rotaciona: começa pela ocasião (mais útil para fechar a venda) e pergunta "evitar" só se ainda não sabe.
 */
export function pickTriage(s: EngagementSettings, c: { orders: number; preferences?: CustomerPreferences } | null, now: Date): TriageQuestion | null {
  if (!s.triage.enabled || !c || c.orders < 1) return null;
  const p = c.preferences || {};
  if (hoursSince(p.triageAskedAt, now) < s.triage.cooldownDays * 24) return null;
  if (occasionLive(p, s, now)) return null;
  const on = s.triage.questions.filter((q) => q.enabled);
  if (!on.length) return null;
  const n = p.triageAnswers || 0;
  const avoidKnown = p.avoid !== undefined;
  const order = on.filter((q) => q.kind !== "avoid" || !avoidKnown);
  if (!order.length) return null;
  const q = order[n % order.length];
  if (q.kind === "avoid") return { kind: "avoid", title: q.title, multi: true, options: [...s.triage.avoidTags.map((t) => ({ id: t.id, label: t.label })), { id: "nada", label: "Como de tudo" }] };
  return { kind: q.kind, title: q.title, options: OPTIONS[q.kind] };
}

/** Aplica a resposta às preferências (puro). */
export function answerTriage(p: CustomerPreferences | undefined, kind: TriageKind | "skip", values: string[], now: Date): CustomerPreferences {
  const at = now.toISOString();
  const next: CustomerPreferences = { ...(p || {}), triageAskedAt: at };
  if (kind === "skip") return next;
  next.triageAnswers = (p?.triageAnswers || 0) + 1;
  const v = values[0];
  if (kind === "avoid") next.avoid = values.filter((x) => x !== "nada");
  else {
    const occ = { ...(p?.occasion && hoursSince(p.occasion.at, now) < 24 ? p.occasion : {}), at };
    if (kind === "party" && (v === "solo" || v === "dupla" || v === "galera")) occ.partySize = v;
    if (kind === "mood" && (v === "salgada" || v === "doce" || v === "ambas")) occ.mood = v;
    if (kind === "craving" && (v === "de_sempre" || v === "novidade")) occ.craving = v;
    next.occasion = occ;
  }
  return next;
}

/* ---------------- personalização pelo que a pessoa respondeu ---------------- */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function avoidHit(text: string, avoid: string[] | undefined, tags: AvoidTag[]): string | undefined {
  if (!avoid?.length) return undefined;
  const t = norm(text);
  for (const id of avoid) { const tag = tags.find((x) => x.id === id); if (tag && tag.keywords.some((k) => t.includes(norm(k)))) return tag.label; }
  return undefined;
}

export interface PersonalHero { kicker: string; title: string; sub?: string; action: { kind: "open_item"; itemId: ID } }

/**
 * Card do topo a partir das respostas: ocasião (grupo) > "quero provar" > novidade.
 * Devolve undefined quando não há nada melhor que a regra da vitrine.
 */
export function heroFromPreferences(
  p: CustomerPreferences | undefined, s: EngagementSettings, now: Date,
  items: { id: ID; name: string; categoryId: ID }[], opts: { lastItemIds?: ID[] } = {},
): PersonalHero | undefined {
  const has = (id?: ID) => !!id && items.some((i) => i.id === id);
  const nm = (id: ID) => items.find((i) => i.id === id)!.name.split(" · ")[0];
  const occ = occasionLive(p, s, now);
  if (occ?.partySize && has(s.triage.partyItems[occ.partySize])) {
    const id = s.triage.partyItems[occ.partySize]!;
    const k = { solo: "Pra você hoje", dupla: "Pra dois", galera: "Pra galera" }[occ.partySize];
    return { kicker: k, title: nm(id), sub: "Separamos pelo que você respondeu agora", action: { kind: "open_item", itemId: id } };
  }
  const want = (p?.wantToTry || []).find((id) => has(id) && !opts.lastItemIds?.includes(id));
  if (want && occ?.craving !== "de_sempre") return { kicker: "Você quis provar", title: nm(want), sub: "Da última vez você disse que queria experimentar", action: { kind: "open_item", itemId: want } };
  if (occ?.craving === "novidade" && has(s.triage.noveltyItemId)) return { kicker: "Novidade pra você", title: nm(s.triage.noveltyItemId!), action: { kind: "open_item", itemId: s.triage.noveltyItemId! } };
  return undefined;
}

/** Reordena categorias pela vontade da ocasião (doce primeiro, por exemplo). */
export function orderCategoriesByMood<T extends { id: ID; name: string }>(cats: T[], mood: Mood | undefined): T[] {
  if (!mood || mood === "ambas") return cats;
  const isSweet = (c: T) => /doce/i.test(c.name);
  return mood === "doce" ? [...cats.filter(isSweet), ...cats.filter((c) => !isSweet(c))] : [...cats.filter((c) => !isSweet(c)), ...cats.filter(isSweet)];
}

/** Motivos sugeridos conforme a nota. */
export const reasonsFor = (s: EngagementSettings, nps: number) => (nps >= 9 ? s.postOrder.reasonsHigh : s.postOrder.reasonsLow);
