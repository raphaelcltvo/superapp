/**
 * Algoritmo do Superapp — regras puras (sem banco) da camada 0 (SETUP / Agente S),
 * dos agentes A–G, do orquestrador (O) e do ciclo vivo.
 * Mantra: 1 visita = 1 venda. Meta do ciclo: evasão líquida → 0, dentro dos guardrails da marca.
 */
import type { ID, TrackEvent } from "./types";

/* ---------------- agentes ---------------- */
export type AgentCode = "S" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "O";
export type Severity = "verde" | "amarelo" | "vermelho";

export interface AgentInfo { code: AgentCode; name: string; mission: string; kpi: string; layer: "dados" | "decisao" | "orquestracao" }
export const AGENTS: AgentInfo[] = [
  { code: "S", name: "SETUP e importação", mission: "Transformar o que a marca tiver em base confiável e ser o único canal de pedidos de dados à marca", kpi: "Degrau de entrada e % dos dados aproveitados", layer: "dados" },
  { code: "A", name: "Vitrine", mission: "Colocar na frente de cada pessoa o que ela mais provavelmente vai pedir agora", kpi: "Clique na vitrine → sacola", layer: "decisao" },
  { code: "B", name: "Sentinela de sessão", mission: "Perceber quem quer comprar e está saindo e oferecer a ajuda certa uma vez", kpi: "Conversão de intenção", layer: "decisao" },
  { code: "C", name: "Primeira visita", mission: "Acertar a vitrine de quem chega sem histórico", kpi: "Conversão de intenção dos novatos", layer: "decisao" },
  { code: "D", name: "Arquiteto do cardápio", mission: "Fazer a estrutura do cardápio facilitar a escolha", kpi: "Item aberto → item na sacola", layer: "decisao" },
  { code: "E", name: "Atrito", mission: "Remover o que impede quem decidiu de concluir o pedido", kpi: "Sacola → pedido", layer: "decisao" },
  { code: "F", name: "CRM", mission: "Recuperar a sessão perdida e transformar o 1º pedido em hábito", kpi: "Recuperação e visitante → cliente", layer: "decisao" },
  { code: "G", name: "Experimentos", mission: "Transformar toda proposta em teste e decidir com dados o que fica", kpi: "Ganho líquido contra o controle", layer: "decisao" },
  { code: "O", name: "Orquestrador", mission: "Decidir quem age e quando, aplicar guardrails e pedir aprovação humana", kpi: "Evasão líquida", layer: "orquestracao" },
];

export interface AgentState {
  id: AgentCode; code: AgentCode; enabled: boolean;
  /** regras fixas até haver dados; modelo depois */
  mode: "regras" | "modelo";
  params: Record<string, number | string | boolean>;
  /** ganho acumulado medido pelo G (pedidos incrementais) */
  credit: number;
  /** fatia de testes que o orquestrador dá a este agente (0–1) */
  explorationShare: number;
  health: Severity;
  lastRunAt?: string;
}

export const DEFAULT_AGENT_PARAMS: Record<AgentCode, Record<string, number | string | boolean>> = {
  S: { minOrders: 1000, minPeriodDays: 180, minIdentified: 0.7, minCoverage: 0.95, minConsistency: 0.98, matchAuto: 0.8, matchSuggest: 0.5 },
  A: { firstFold: 6, rankWindowDays: 28 },
  B: { intentThreshold: 0.6, exitThreshold: 0.6, maxInterventionsPerSession: 1 },
  C: { minProfileSize: 30 },
  D: { curveA: 0.8 },
  E: { etaSlackMin: 10 },
  F: { cartReminderMin: 15, secondOrderHours: 36, weeklyMessageCap: 2 },
  G: { controlShare: 0.1, minTrialsPerArm: 200 },
  O: { breakerDays: 3 },
};

/* ---------------- achados, testes e decisões ---------------- */
export type FindingStatus = "aberto" | "em_teste" | "resolvido" | "descartado";
export interface Finding {
  id: ID; agent: AgentCode; checkup: string; severity: Severity;
  evidence: { text: string; value?: number; unit?: string };
  proposal: string; actionType: "automatica" | "aprovacao";
  status: FindingStatus; leak?: LeakKey; experimentId?: ID; decisionId?: ID;
  /** um achado aberto por checkup e alvo */
  dedupeKey: string; createdAt: string; updatedAt?: string;
}

export interface Arm { id: string; name: string; config: Record<string, unknown>; control?: boolean }
export type ExperimentStatus = "rascunho" | "rodando" | "vencedor" | "encerrado" | "revertido";
export interface Experiment {
  id: ID; agent: AgentCode; lever: Lever; hypothesis: string; leak?: LeakKey;
  unit: "sessao" | "cliente"; arms: Arm[]; status: ExperimentStatus;
  /** conversão de intenção por padrão */
  metric: "conversao_intencao" | "abertura_item" | "sacola_pedido" | "recuperacao";
  startedAt?: string; endedAt?: string; winnerArm?: string; findingId?: ID; createdAt: string;
}

export type DecisionKind = "aplicar" | "reverter" | "aprovacao" | "disputa" | "disjuntor" | "liberar_lancamento";
export interface Decision {
  id: ID; kind: DecisionKind; agent: AgentCode; title: string; evidence: string;
  findingId?: ID; experimentId?: ID; runId?: ID;
  requiresApproval: boolean; status: "pendente" | "aprovada" | "recusada" | "aplicada";
  decidedBy?: string; decidedAt?: string; createdAt: string;
}

/** Alavancas do cardápio (lista fechada) e se mudam sozinhas ou pedem aprovação. */
export type Lever = "vitrine_entrada" | "ordem_itens" | "colecoes_perfil" | "selos" | "foto_descricao" | "preco_combo" | "sugestao_sacola" | "disponibilidade" | "ajuda_sessao" | "eta" | "frete_raio" | "checkout" | "mensagens";
export const LEVERS: Record<Lever, { owners: AgentCode[]; approval: boolean; label: string }> = {
  vitrine_entrada: { owners: ["C", "A"], approval: false, label: "Vitrine de entrada e primeira dobra" },
  ordem_itens: { owners: ["A", "D"], approval: false, label: "Ordem de itens e categorias" },
  colecoes_perfil: { owners: ["A"], approval: false, label: "Coleções por perfil" },
  selos: { owners: ["D"], approval: false, label: "Selos e destaques" },
  foto_descricao: { owners: ["D"], approval: true, label: "Foto e descrição" },
  preco_combo: { owners: ["D", "A"], approval: true, label: "Preço e combo com preço próprio" },
  sugestao_sacola: { owners: ["A"], approval: false, label: "Sugestão de combo na sacola" },
  disponibilidade: { owners: ["A"], approval: false, label: "Disponibilidade por horário" },
  ajuda_sessao: { owners: ["B"], approval: false, label: "Ajuda dentro da sessão" },
  eta: { owners: ["E"], approval: false, label: "ETA exibido" },
  frete_raio: { owners: ["E"], approval: true, label: "Frete e raio" },
  checkout: { owners: ["E"], approval: true, label: "Fluxo do checkout" },
  mensagens: { owners: ["F"], approval: false, label: "Mensagens no WhatsApp" },
};

/* ---------------- mapa de evasão ---------------- */
export type LeakKey = "chegada" | "navegacao" | "item" | "sacola" | "checkout" | "pagamento" | "recompra";
export const LEAKS: { key: LeakKey; label: string; owners: AgentCode[] }[] = [
  { key: "chegada", label: "Sai logo na chegada", owners: ["C", "D"] },
  { key: "navegacao", label: "Navega e não abre nenhum item", owners: ["A", "D"] },
  { key: "item", label: "Abre o item e não adiciona", owners: ["D"] },
  { key: "sacola", label: "Sacola parada, não avança", owners: ["B", "A"] },
  { key: "checkout", label: "Desiste no checkout (frete, prazo, cadastro)", owners: ["E"] },
  { key: "pagamento", label: "Pagamento falha", owners: ["E"] },
  { key: "recompra", label: "Não volta a pedir", owners: ["F"] },
];

/** Eventos que o sistema mostra sozinho — não contam como interação do visitante. */
const PASSIVE = new Set(["visit", "triage_shown", "popup_shown", "exit_shown", "return_toast", "fx_free_ship_nudge", "fx_glow_cta", "fx_glow_preset"]);
const INTENT = new Set(["add_to_cart", "cart_view", "checkout_start", "out_of_area", "cep_informed", "payment_declined", "payment_failed"]);

export type Cohort = "novato" | "recorrente";
export interface SessionOutcome { sessionId: string; customerId?: string; start: string; end: string; segment: Cohort; intent: boolean; converted: boolean; exit?: Exclude<LeakKey, "recompra">; recovered?: boolean }

/** Classifica cada sessão pelo ponto mais fundo que alcançou e por onde saiu. */
export function sessionOutcomes(events: Pick<TrackEvent, "sessionId" | "customerId" | "name" | "ts">[], segmentOf: (s: { customerId?: string; start: string }) => Cohort): SessionOutcome[] {
  const by = new Map<string, typeof events>();
  for (const e of events) { const l = by.get(e.sessionId); if (l) l.push(e); else by.set(e.sessionId, [e]); }
  const out: SessionOutcome[] = [];
  for (const [sessionId, ev] of by) {
    const names = new Set(ev.map((e) => e.name));
    if (!names.has("visit") && !names.has("order_placed")) continue; // sessão sem abertura do cardápio (ex.: só webhook)
    const ts = ev.map((e) => e.ts).sort();
    const customerId = ev.find((e) => e.customerId)?.customerId;
    const converted = names.has("order_placed");
    const intent = converted || [...names].some((n) => INTENT.has(n));
    let exit: SessionOutcome["exit"];
    if (!converted) {
      if (names.has("payment_declined") || names.has("payment_failed")) exit = "pagamento";
      else if (names.has("checkout_start") || names.has("out_of_area") || names.has("cep_informed")) exit = "checkout";
      else if (names.has("add_to_cart") || names.has("cart_view")) exit = "sacola";
      else if (names.has("item_view")) exit = "item";
      else if ([...names].some((n) => !PASSIVE.has(n))) exit = "navegacao";
      else exit = "chegada";
    }
    out.push({ sessionId, customerId, start: ts[0], end: ts[ts.length - 1], segment: segmentOf({ customerId, start: ts[0] }), intent, converted, exit });
  }
  return out;
}

/** Marca como recuperadas as sessões com intenção que não fecharam, mas cujo cliente pediu em até `hours` horas. */
export function markRecovered(sessions: SessionOutcome[], orders: { customerId?: string; createdAt: string }[], hours = 24) {
  const byCustomer = new Map<string, string[]>();
  for (const o of orders) if (o.customerId) (byCustomer.get(o.customerId) || byCustomer.set(o.customerId, []).get(o.customerId)!).push(o.createdAt);
  for (const s of sessions) {
    if (!s.intent || s.converted || !s.customerId) continue;
    const lim = new Date(+new Date(s.end) + hours * 3600e3).toISOString();
    s.recovered = (byCustomer.get(s.customerId) || []).some((t) => t > s.end && t <= lim);
  }
  return sessions;
}

export interface LeakRow { key: LeakKey; label: string; owners: AgentCode[]; lost: number; withIntent: number; share: number }
export interface EvasionReport {
  segment: Cohort | "todos"; sessions: number; intentSessions: number; converted: number; recovered: number;
  /** (com intenção − pedidos na sessão − recuperados em 24 h) ÷ com intenção */
  netEvasion: number; engagement: number; leaks: LeakRow[];
}

/** Evasão líquida e vazamentos, sempre por perfil (novato com novato, recorrente com recorrente). */
export function evasion(sessions: SessionOutcome[], segment: Cohort | "todos" = "todos", recompraLost = 0): EvasionReport {
  const s = segment === "todos" ? sessions : sessions.filter((x) => x.segment === segment);
  const intent = s.filter((x) => x.intent);
  const converted = s.filter((x) => x.converted).length;
  const recovered = intent.filter((x) => x.recovered).length;
  const lostTotal = s.filter((x) => !x.converted).length + recompraLost;
  const leaks = LEAKS.map((l) => {
    const lostHere = l.key === "recompra" ? recompraLost : s.filter((x) => x.exit === l.key && !x.recovered).length;
    const withIntent = l.key === "recompra" ? recompraLost : intent.filter((x) => x.exit === l.key && !x.recovered).length;
    return { ...l, lost: lostHere, withIntent, share: lostTotal ? Math.round((lostHere / lostTotal) * 1000) / 10 : 0 };
  });
  const net = intent.length ? (intent.length - converted - recovered) / intent.length : 0;
  return { segment, sessions: s.length, intentSessions: intent.length, converted, recovered, netEvasion: Math.round(Math.max(0, net) * 1000) / 10, engagement: s.length ? Math.round((s.filter((x) => x.exit !== "chegada").length / s.length) * 1000) / 10 : 0, leaks };
}

/** Regra 1 do autoajuste: o maior vazamento recebe a maior fatia de testes; o dono dele também. */
export function prioritizeLeaks(r: EvasionReport) {
  const sorted = [...r.leaks].filter((l) => l.lost > 0).sort((a, b) => b.lost - a.lost);
  const total = sorted.reduce((a, l) => a + l.lost, 0) || 1;
  const share: Partial<Record<AgentCode, number>> = {};
  for (const l of sorted) for (const o of l.owners) share[o] = (share[o] || 0) + l.lost / total / l.owners.length;
  return { order: sorted.map((l) => l.key), explorationShare: share };
}

/* ---------------- Agente G: Thompson sampling ---------------- */
function gamma(k: number, rnd: () => number): number {
  if (k < 1) return gamma(k + 1, rnd) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { const u1 = rnd() || 1e-12, u2 = rnd(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (a: number, b: number, rnd: () => number) => { const x = gamma(a, rnd); return x / (x + gamma(b, rnd)); };

export interface ArmStat { arm: string; trials: number; successes: number; control?: boolean }
/** Escolhe o braço: o controle recebe uma fatia fixa; os demais disputam pela chance de serem o melhor. */
export function pickArm(stats: ArmStat[], controlShare: number, rnd: () => number = Math.random): string {
  const control = stats.find((s) => s.control);
  if (control && rnd() < controlShare) return control.arm;
  const pool = stats.filter((s) => !s.control);
  if (!pool.length) return control?.arm ?? stats[0].arm;
  let best = pool[0].arm, bestV = -1;
  for (const s of pool) { const v = beta(1 + s.successes, 1 + s.trials - s.successes, rnd); if (v > bestV) { bestV = v; best = s.arm; } }
  return best;
}
/** Probabilidade (Monte Carlo) de cada braço ser o melhor — usada para declarar vencedor. */
export function probBest(stats: ArmStat[], draws = 4000, rnd: () => number = Math.random): Record<string, number> {
  const wins: Record<string, number> = Object.fromEntries(stats.map((s) => [s.arm, 0]));
  for (let i = 0; i < draws; i++) {
    let best = "", bv = -1;
    for (const s of stats) { const v = beta(1 + s.successes, 1 + s.trials - s.successes, rnd); if (v > bv) { bv = v; best = s.arm; } }
    wins[best]++;
  }
  return Object.fromEntries(Object.entries(wins).map(([k, v]) => [k, Math.round((v / draws) * 1000) / 1000]));
}

/* ---------------- Agente S: SETUP ---------------- */
export type Channel = "ifood" | "99food" | "delivery_direto" | "saipos" | "pdv" | "proprio" | "outro";
export type FileKind = "pedidos_itens" | "vendas_item" | "pedidos" | "clientes" | "promocoes" | "cardapio" | "operacao" | "desconhecido";
/** Canais de marketplace: dados de cliente só entram de forma agregada (nunca viram contato de CRM). */
export const MARKETPLACES: Channel[] = ["ifood", "99food"];

export interface SetupRun {
  id: ID; status: "entrevista" | "recebendo" | "criticando" | "aguardando_marca" | "pronto" | "liberado";
  inventory: { channels: Channel[]; systems: string[]; notes?: string };
  ladder?: Ladder; dossier?: Dossier; releasedAt?: string; releasedBy?: string; createdAt: string;
}
export interface Critique { checkup: string; severity: Severity; text: string; value?: number }
export interface SetupFile {
  id: ID; runId: ID; filename: string; size: number; channel: Channel; kind: FileKind; confidence: number;
  headers: string[]; mapping: Record<string, string>; preview: Record<string, unknown>[];
  status: "recebido" | "classificado" | "aproveitado" | "descartado";
  critiques: Critique[]; stats?: { rows: number; used: number; discarded: number; cancelled: number; duplicates: number; matchedShare: number; periodFrom?: string; periodTo?: string };
  rows?: Record<string, unknown>[]; createdAt: string;
}
export interface DataRequest {
  id: ID; runId?: ID; origin: AgentCode; title: string; detail: string;
  /** quanto subiria a precisão (0–100); ordena a lista enviada à marca */
  impact: number; status: "aberto" | "enviado" | "respondido" | "resolvido" | "descartado";
  items?: { label: string; value?: number }[]; dedupeKey: string; createdAt: string;
}
export interface Dossier { sources: { file: string; channel: Channel; kind: FileKind; status: string; used: number; rows: number }[]; critiques: Critique[]; ladder: Ladder; pending: { title: string; impact: number }[]; generatedAt: string }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function detectChannel(filename: string, headers: string[]): { channel: Channel; confidence: number } {
  const t = norm(filename + " " + headers.join(" ")).replace(/[^a-z0-9]+/g, " ");
  if (/ifood/.test(t)) return { channel: "ifood", confidence: 0.95 };
  if (/\b99\s?food\b|\b99\b/.test(t)) return { channel: "99food", confidence: 0.8 };
  if (/delivery ?direto|deliverydireto/.test(t)) return { channel: "delivery_direto", confidence: 0.95 };
  if (/saipos/.test(t)) return { channel: "saipos", confidence: 0.9 };
  if (/\bpdv\b|caixa|balcao/.test(t)) return { channel: "pdv", confidence: 0.6 };
  return { channel: "outro", confidence: 0.3 };
}

/** Campos do histórico de vendas e os nomes de coluna mais comuns nos relatórios dos canais. */
export const SALES_FIELDS: { key: string; label: string; aliases: string[] }[] = [
  { key: "orderId", label: "ID do pedido", aliases: ["id pedido", "pedido", "id_pedido", "order_id", "numero do pedido", "n pedido", "nº pedido", "codigo do pedido", "id do pedido"] },
  { key: "orderedAt", label: "Data/hora", aliases: ["data", "data pedido", "data/hora", "data_hora", "created_at", "data do pedido", "dt_pedido", "horario"] },
  { key: "periodTo", label: "Fim do período (relatório agregado)", aliases: ["periodo", "período", "ate", "até", "data final", "fim"] },
  { key: "item", label: "Item / produto", aliases: ["item", "produto", "nome do item", "nome do produto", "descricao", "descrição", "sabor", "prato"] },
  { key: "qty", label: "Quantidade", aliases: ["quantidade", "qtd", "qtde", "qty", "quantidade vendida", "vendidos", "unidades"] },
  { key: "unitPrice", label: "Preço unitário", aliases: ["preco", "preço", "preco unitario", "preço unitário", "valor unitario", "valor unitário", "unit_price"] },
  { key: "lineTotal", label: "Total do item", aliases: ["total do item", "valor do item", "subtotal item", "faturamento", "receita", "valor total item", "total vendido", "valor vendido"] },
  { key: "discount", label: "Desconto", aliases: ["desconto", "desconto item", "promocao", "promoção", "valor desconto"] },
  { key: "orderTotal", label: "Total do pedido", aliases: ["total do pedido", "valor do pedido", "total pedido", "valor total"] },
  { key: "deliveryFee", label: "Taxa de entrega", aliases: ["taxa de entrega", "frete", "entrega", "taxa entrega"] },
  { key: "status", label: "Status", aliases: ["status", "situacao", "situação", "estado"] },
  { key: "phone", label: "Telefone do cliente", aliases: ["telefone", "celular", "whatsapp", "fone", "phone"] },
  { key: "email", label: "E-mail do cliente", aliases: ["email", "e-mail"] },
  { key: "customerId", label: "ID do cliente", aliases: ["id cliente", "id_cliente", "cliente id", "codigo cliente"] },
  { key: "district", label: "Bairro", aliases: ["bairro", "district"] },
  { key: "postalCode", label: "CEP", aliases: ["cep", "postal_code"] },
  { key: "channel", label: "Canal", aliases: ["canal", "plataforma", "origem", "channel"] },
];

export function suggestSalesMapping(headers: string[]) {
  const map: Record<string, string> = {};
  for (const f of SALES_FIELDS) { const h = headers.find((x) => f.aliases.includes(norm(x)) || norm(x) === norm(f.label)); if (h && !Object.values(map).includes(h)) map[f.key] = h; }
  return map;
}

/** Reconhece o tipo do arquivo pelas colunas. */
export function detectKind(headers: string[]): { kind: FileKind; confidence: number } {
  const m = suggestSalesMapping(headers); const H = headers.map(norm).join(" | ");
  const hasItem = !!m.item, hasOrder = !!m.orderId, hasDate = !!m.orderedAt;
  if (hasItem && hasOrder) return { kind: "pedidos_itens", confidence: 0.9 };
  if (hasItem && (m.qty || m.lineTotal) && !hasOrder) return { kind: "vendas_item", confidence: 0.8 };
  if (hasOrder && hasDate) return { kind: "pedidos", confidence: 0.8 };
  if ((m.phone || m.email) && !hasItem) return { kind: "clientes", confidence: 0.8 };
  if (/cupom|promoc|campanha/.test(H)) return { kind: "promocoes", confidence: 0.6 };
  if (/categoria/.test(H) && /preco|valor/.test(H)) return { kind: "cardapio", confidence: 0.6 };
  if (/tempo de (preparo|entrega)|avaliacao|nota/.test(H)) return { kind: "operacao", confidence: 0.6 };
  return { kind: "desconhecido", confidence: 0.2 };
}

const STOP = new Set(["pizza", "de", "da", "do", "das", "dos", "com", "e", "a", "o", "g", "m", "p", "gg", "grande", "media", "pequena", "broto", "tamanho", "sabor", "un", "und", "unid", "unidade", "cm", "fatias", "inteira", "1", "2"]);
export const itemTokens = (s: string) => norm(s).replace(/\d+\s?(cm|ml|l|g|kg)\b/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));

export interface CatalogEntry { id: string; name: string }
export interface MatchResult { id?: string; score: number; status: "auto" | "sugerido" | "ambiguo" | "sem_par"; candidates: { id: string; name: string; score: number }[] }
/** Casa o nome vendido no canal com o cardápio (itens e sabores), sem depender de escrita idêntica. */
export function matchItem(raw: string, catalog: CatalogEntry[], auto = 0.8, suggest = 0.5): MatchResult {
  const r = new Set(itemTokens(raw));
  if (!r.size) return { score: 0, status: "sem_par", candidates: [] };
  const scored = catalog.map((c) => {
    const t = new Set(itemTokens(c.name));
    const inter = [...t].filter((x) => r.has(x)).length;
    const union = new Set([...t, ...r]).size;
    return { id: c.id, name: c.name, score: union ? inter / union : 0 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < suggest) return { score: top?.score || 0, status: "sem_par", candidates: scored.slice(0, 3) };
  const tie = scored[1] && scored[1].score >= top.score - 0.05;
  if (tie) return { score: top.score, status: "ambiguo", candidates: scored.slice(0, 3) };
  return { id: top.id, score: top.score, status: top.score >= auto ? "auto" : "sugerido", candidates: scored.slice(0, 3) };
}

/* ---------------- escada de dados ---------------- */
export interface LadderInput {
  pricedItems: number; aggregateLines: number; ordersWithItems: number; identifiedShare: number;
  periodDays: number; coverage: number; consistency: number; costCoverage: number; ownOrders: number;
}
export interface Gate { key: string; label: string; rule: string; value: number; ok: boolean }
export interface Ladder { step: 0 | 1 | 2 | 3; blocked: boolean; gates: Gate[]; next?: string; computedAt?: string }

export function computeLadder(i: LadderInput, p: Record<string, number | string | boolean> = DEFAULT_AGENT_PARAMS.S): Ladder {
  const P = (k: string) => Number(p[k] ?? DEFAULT_AGENT_PARAMS.S[k]);
  const pct = (x: number) => Math.round(x * 1000) / 10;
  const gates: Gate[] = [
    { key: "cardapio", label: "Cardápio com preços", rule: "≥ 1 item com preço", value: i.pricedItems, ok: i.pricedItems > 0 },
    { key: "volume", label: "Volume de pedidos com itens", rule: `≥ ${P("minOrders")} pedidos`, value: i.ordersWithItems, ok: i.ordersWithItems >= P("minOrders") },
    { key: "periodo", label: "Período coberto", rule: `≥ ${P("minPeriodDays")} dias`, value: i.periodDays, ok: i.periodDays >= P("minPeriodDays") },
    { key: "cobertura", label: "Itens vendidos casados com o cardápio", rule: `≥ ${pct(P("minCoverage"))}% da receita`, value: pct(i.coverage), ok: i.coverage >= P("minCoverage") },
    { key: "consistencia", label: "Pedidos com totais que fecham", rule: `≥ ${pct(P("minConsistency"))}%`, value: pct(i.consistency), ok: i.consistency >= P("minConsistency") },
    { key: "identificacao", label: "Pedidos com cliente identificado", rule: `≥ ${pct(P("minIdentified"))}%`, value: pct(i.identifiedShare), ok: i.identifiedShare >= P("minIdentified") },
    { key: "custo", label: "Itens ativos com custo (CMV)", rule: "100% (libera a BCG)", value: pct(i.costCoverage), ok: i.costCoverage >= 1 },
  ];
  const ok = (k: string) => gates.find((g) => g.key === k)!.ok;
  if (!ok("cardapio")) return { step: 0, blocked: true, gates, next: "Enviar o cardápio com preços" };
  const step2 = ok("volume") && ok("periodo") && ok("cobertura") && ok("consistencia");
  const step: Ladder["step"] = step2 && ok("identificacao") ? 3 : step2 ? 2 : i.aggregateLines > 0 || i.ordersWithItems > 0 ? 1 : 0;
  const next = step === 3 ? undefined : step === 2 ? "Identificar o cliente nos pedidos (telefone ou e-mail)" : step === 1 ? gates.filter((g) => ["volume", "periodo", "cobertura", "consistencia"].includes(g.key) && !g.ok).map((g) => g.label).join(", ") : "Enviar qualquer relatório de vendas por item";
  return { step, blocked: false, gates, next };
}

/** O que cada agente faz em cada degrau (matriz do plano). */
export const CAPABILITIES: Record<Exclude<AgentCode, "S" | "O">, [string, string, string, string]> = {
  A: ["Vitrine pelo questionário e padrões da categoria", "Ranking por popularidade e por horário", "+ combos e cardápio por faixa horária", "+ coleções por perfil"],
  B: ["Regras fixas; coleta eventos", "Regras fixas; coleta eventos", "Regras fixas; coleta eventos", "Regras + perfil do cliente"],
  C: ["Perfil por contexto (hora, origem, CEP)", "+ perfis por horário", "+ perfis por cesta típica", "Perfis completos (clusters)"],
  D: ["Checkup de cadastro: fotos, descrições, categorias", "+ posição dos itens-âncora", "+ Pareto; BCG se houver custo", "+ organização por perfil"],
  E: ["Frete, checkout e ETA com folga fixa", "Igual", "Igual", "+ ETA calibrado pelo histórico"],
  F: ["Opt-in; sacola abandonada e 2º pedido de quem compra no Superapp", "Igual", "Igual", "+ RFM e reativação da base importada; uplift com volume"],
  G: ["Exploração alta", "Exploração média", "Exploração média", "Exploração baixa, ajuste fino"],
};
