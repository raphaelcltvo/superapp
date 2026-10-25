/**
 * Primeira visita e topo do cardápio por jornada.
 *
 * - Personas: agrupa os clientes da base enviada (pedidos) por como compram — tamanho do pedido,
 *   oferta pronta x montar, doce, ticket — e escolhe as 2–3 perguntas que mais separam esses grupos.
 *   A resposta do visitante novo é comparada aos grupos ("clientes parecidos") e o topo mostra o que
 *   aquele grupo mais pede, com a combinação de sabores.
 * - Sem base: um roteiro de perguntas por segmento (o que já funciona, pela experiência de quem opera).
 * - Recompra: a linha que o cliente MAIS pede (item + sabores), não só o último pedido.
 * - Campanhas: o anúncio (utm) decide o topo para quem chega por ele.
 */
import type { ID, Order, PricedLine } from "./types";

export type FvDim = "party" | "deal" | "sweet" | "novelty";
export interface FvOption { id: string; label: string; /** valores das características (0 a 1) que a resposta indica */ values: Partial<Record<Feature, number>>; /** a resposta já basta para escolher o perfil (pula as próximas perguntas) */ final?: boolean }
export interface FvQuestion { id: string; dim: FvDim; title: string; options: FvOption[]; enabled?: boolean }
export type Feature = "big" | "ticket" | "deal" | "sweet" | "explore";

export interface CampaignTarget {
  id: string; active: boolean;
  /** casa com os parâmetros do link (vazio = qualquer) */
  source?: string; campaign?: string; content?: string;
  target: { kind: "item"; itemId: ID } | { kind: "category"; categoryId: ID };
  kicker: string; sub?: string;
}

export interface FirstVisitSettings {
  enabled: boolean;
  /** reward: responde e ganha o cupom · gate: o cupom aparece primeiro e só libera com respostas + celular + e-mail */
  mode: "reward" | "gate";
  couponId?: ID;
  /** auto: personas da base quando houver; senão o roteiro do segmento */
  source: "auto" | "playbook";
  segment: "pizza" | "generico";
  maxQuestions: number;
  playbook: FvQuestion[];
  /** quem chega por campanha vê o produto do anúncio; a triagem só aparece depois de N s sem adicionar (0 = nunca) */
  afterCampaignSeconds: number;
}

/* ---------------- roteiro (sem base) ---------------- */
export const PLAYBOOKS: Record<FirstVisitSettings["segment"], FvQuestion[]> = {
  pizza: [
    { id: "party", dim: "party", title: "Hoje é pra quantas pessoas?", options: [
      { id: "solo", label: "Só eu", values: { big: 0, ticket: 0.15 } },
      { id: "dupla", label: "A dois", values: { big: 0.25, ticket: 0.5 } },
      { id: "galera", label: "3 ou mais", values: { big: 1, ticket: 0.9 } },
    ] },
    { id: "novelty", dim: "novelty", title: "E hoje vai de…", options: [
      { id: "classico", label: "Um clássico que não erra", values: { explore: 0 } },
      { id: "novidade", label: "Algo que eu nunca provei", values: { explore: 1 } },
    ] },
    { id: "deal", dim: "deal", title: "Você prefere…", options: [
      { id: "oferta", label: "Uma oferta pronta", values: { deal: 1 } },
      { id: "montar", label: "Montar do meu jeito", values: { deal: 0 } },
    ] },
    { id: "sweet", dim: "sweet", title: "Vai rolar um doce no final?", options: [
      { id: "sim", label: "Com certeza", values: { sweet: 1 } },
      { id: "nao", label: "Hoje não", values: { sweet: 0 } },
    ] },
  ],
  generico: [
    { id: "party", dim: "party", title: "É pra quantas pessoas?", options: [
      { id: "solo", label: "Só eu", values: { big: 0, ticket: 0.15 } },
      { id: "dupla", label: "Duas", values: { big: 0.25, ticket: 0.5 } },
      { id: "galera", label: "Mais de duas", values: { big: 1, ticket: 0.9 } },
    ] },
    { id: "novelty", dim: "novelty", title: "E hoje vai de…", options: [
      { id: "classico", label: "O clássico", values: { explore: 0 } },
      { id: "novidade", label: "Algo novo", values: { explore: 1 } },
    ] },
    { id: "deal", dim: "deal", title: "O que pesa mais hoje?", options: [
      { id: "oferta", label: "Preço bom", values: { deal: 1 } },
      { id: "montar", label: "Do meu jeito", values: { deal: 0 } },
    ] },
    { id: "sweet", dim: "sweet", title: "Sobremesa também?", options: [
      { id: "sim", label: "Sim", values: { sweet: 1 } },
      { id: "nao", label: "Não", values: { sweet: 0 } },
    ] },
  ],
};

export const DEFAULT_FIRST_VISIT: FirstVisitSettings = {
  enabled: true, mode: "reward", source: "auto", segment: "pizza", maxQuestions: 2, playbook: PLAYBOOKS.pizza, afterCampaignSeconds: 0,
};

/* ---------------- catálogo mínimo ---------------- */
export interface FvItem { id: ID; name: string; categoryId: ID; kind: string; price: number; isDrink?: boolean }
export interface FvCategory { id: ID; name: string; pricingLocked?: boolean }
export interface FvCatalog { items: FvItem[]; categories: FvCategory[] }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const isSweetCategory = (c?: FvCategory) => !!c && /doce|sobremesa/.test(norm(c.name));
const SWEET_WORDS = /\b(doce|doces|sobremesa|banana|chocolate|avela|nutella|cheesecake|negresco|kit ?kat|banoffee|romeu|morango|tostine|brigadeiro|marshmallow|m&ms)\b/;
/** Item doce: pela categoria ou, nas categorias mistas (ofertas, hits), pelo nome. */
export const isSweetItem = (it?: FvItem, c?: FvCategory) => !!it && (isSweetCategory(c) || (SWEET_WORDS.test(norm(it.name)) && !/salgad/.test(norm(it.name))));
export const isDrinkCategory = (c?: FvCategory) => !!c && /bebida|refri|suco/.test(norm(c.name));
/** Itens de mais de uma pizza (combos de duas, "serve 4"…) */
export const isMulti = (it: FvItem) => /\bduas\b|\b2 pizzas\b|combo familia|serve [3-9]/.test(norm(it.name));

/** Chave de uma linha = item + sabores/complementos escolhidos (ordem estável). */
export function lineKey(l: Pick<PricedLine, "itemId" | "choices">) {
  return l.itemId + "|" + [...l.choices].map((c) => `${c.groupId}:${c.optionId}:${c.qty}`).sort().join(",");
}
export const selectionOf = (l: Pick<PricedLine, "choices">) => l.choices.reduce<Record<string, Record<string, number>>>((s, c) => { (s[c.groupId] ||= {})[c.optionId] = c.qty; return s; }, {});
/** Nome da linha com os sabores: "Pizza 40cm · ½ Calabresa + ½ Marguerita". */
export function lineTitle(l: Pick<PricedLine, "name" | "choices">) {
  const base = l.name.split(" · ")[0];
  const halves = l.choices.filter((c) => c.fraction && c.fraction !== "inteira");
  let flavor = halves.length ? halves.map((c) => `½ ${c.name}`).join(" + ") : "";
  if (!flavor) {
    // grupo de sabores "2 metades" (preço fechado): soma 2 unidades
    const by = new Map<string, typeof l.choices>();
    for (const c of l.choices) by.set(c.groupId, [...(by.get(c.groupId) || []), c]);
    const g = [...by.values()].find((cs) => cs.reduce((s, c) => s + c.qty, 0) === 2 && cs.length <= 2);
    if (g) flavor = g.length === 1 ? `inteira ${g[0].name}` : g.map((c) => `½ ${c.name}`).join(" + ");
    else if (l.choices.some((c) => c.fraction === "inteira")) flavor = `inteira ${l.choices.find((c) => c.fraction === "inteira")!.name}`;
  }
  return flavor ? `${base} · ${flavor}` : base;
}

/* ---------------- recompra: o que ele MAIS pede ---------------- */
export interface FavoriteResult { lines: { itemId: ID; qty: number; selection: Record<string, Record<string, number>>; notes?: string }[]; title: string; times: number; orders: number }
/**
 * A linha (item + combinação de sabores) que mais aparece nos pedidos do cliente; empate = a mais recente.
 * Junta o acompanhamento que vem com ela em pelo menos metade das vezes (ex.: o refrigerante).
 */
export function favoriteOrder(orders: Pick<Order, "lines" | "status" | "createdAt">[], catalog?: FvCatalog): FavoriteResult | null {
  const valid = orders.filter((o) => o.status !== "cancelled").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!valid.length) return null;
  const drink = (id: string) => { const it = catalog?.items.find((i) => i.id === id); return !!it && (it.isDrink || isDrinkCategory(catalog!.categories.find((c) => c.id === it.categoryId))); };
  const count = new Map<string, { n: number; line: PricedLine; first: number }>();
  valid.forEach((o, idx) => { const seen = new Set<string>(); for (const l of o.lines) { const k = lineKey(l); if (seen.has(k) || drink(l.itemId)) continue; seen.add(k); const cur = count.get(k); if (cur) cur.n++; else count.set(k, { n: 1, line: l, first: idx }); } });
  if (!count.size) return null;
  const [topKey, top] = [...count.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)[0];
  const withTop = valid.filter((o) => o.lines.some((l) => lineKey(l) === topKey));
  const comp = new Map<string, { n: number; line: PricedLine }>();
  for (const o of withTop) for (const l of o.lines) { const k = lineKey(l); if (k === topKey) continue; const c = comp.get(k); if (c) c.n++; else comp.set(k, { n: 1, line: l }); }
  const extra = [...comp.values()].filter((c) => c.n * 2 >= withTop.length).sort((a, b) => b.n - a.n).slice(0, 1);
  const toLine = (l: PricedLine) => ({ itemId: l.itemId, qty: l.qty, selection: selectionOf(l), notes: l.notes });
  return { lines: [toLine(top.line), ...extra.map((e) => toLine(e.line))], title: [lineTitle(top.line), ...extra.map((e) => e.line.name.split(" · ")[0])].join(" + "), times: top.n, orders: valid.length };
}

/* ---------------- personas a partir da base ---------------- */
export interface Persona {
  id: string; name: string; share: number; customers: number; avgTicket: number;
  centroid: Record<Feature, number>;
  topItemId?: ID; topSelection?: Record<string, Record<string, number>>; topTitle?: string;
  categoryOrder: ID[];
}
export interface PersonaModel { personas: Persona[]; questions: FvQuestion[]; customers: number; ticketRange: [number, number] }

type Ord = Pick<Order, "customerId" | "lines" | "total" | "status" | "createdAt">;
const FEATS: Feature[] = ["big", "ticket", "deal", "sweet", "explore"];
/** Escolhas que não são sabor (massa, borda, bebida, adicional): ficam fora do índice de exploração. */
const NOT_FLAVOR = /gourmet|\bfina\b|recheada|borda|coca|guaran|\bcha\b|\bchá\b|refri|suco|cerveja|monster|adicional|agua|água|vinho/i;

/** gerador determinístico (mesma base → mesmas personas) */
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const quantile = (xs: number[], q: number) => { const a = [...xs].sort((x, y) => x - y); if (!a.length) return 0; const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };

export function computePersonas(orders: Ord[], catalog: FvCatalog, opts: { maxQuestions?: number; minCustomers?: number; playbook?: FvQuestion[] } = {}): PersonaModel | null {
  const I = new Map(catalog.items.map((i) => [i.id, i])), C = new Map(catalog.categories.map((c) => [c.id, c]));
  const byCust = new Map<string, Ord[]>();
  for (const o of orders) if (o.customerId && o.status !== "cancelled") (byCust.get(o.customerId) || byCust.set(o.customerId, []).get(o.customerId)!).push(o);
  const minC = opts.minCustomers ?? 30;
  if (byCust.size < minC) return null;
  const food = (l: PricedLine) => { const it = I.get(l.itemId); return !!it && !it.isDrink && !isDrinkCategory(C.get(it.categoryId)); };
  // popularidade de cada sabor na base: os mais pedidos (até 60% das escolhas) são "os clássicos"
  const flavorsOf = (o: Ord) => o.lines.filter(food).flatMap((l) => l.choices.filter((c) => !NOT_FLAVOR.test(c.name)).map((c) => norm(c.name)));
  const pop = new Map<string, number>(); let picks = 0;
  for (const os of byCust.values()) for (const o of os) for (const f of flavorsOf(o)) { pop.set(f, (pop.get(f) || 0) + 1); picks++; }
  const classics = new Set<string>(); { let acc = 0; for (const [f, n] of [...pop.entries()].sort((a, b) => b[1] - a[1])) { if (acc >= picks * 0.6) break; classics.add(f); acc += n; } }
  const rows: { cid: string; f: Record<Feature, number>; ticket: number; orders: Ord[] }[] = [];
  for (const [cid, os] of byCust) {
    let big = 0, sweet = 0, dealU = 0, foodU = 0, tot = 0;
    for (const o of os) {
      tot += o.total;
      let pizzas = 0, hasSweet = false;
      for (const l of o.lines) {
        if (!food(l)) continue;
        const it = I.get(l.itemId)!, cat = C.get(it.categoryId);
        foodU += l.qty; if (cat?.pricingLocked || it.kind === "combo" || it.kind === "offer") dealU += l.qty;
        if (isSweetItem(it, cat)) hasSweet = true;
        pizzas += l.qty * (isMulti(it) ? 2 : 1);
      }
      if (pizzas >= 2) big++; if (hasSweet) sweet++;
    }
    // exploração: parte das escolhas fora dos clássicos + variedade de sabores entre pedidos
    const fl = os.flatMap(flavorsOf);
    const tail = fl.length ? fl.filter((f) => !classics.has(f)).length / fl.length : 0.5;
    const variety = fl.length > 2 ? new Set(fl).size / fl.length : tail;
    rows.push({ cid, ticket: tot / os.length, f: { big: big / os.length, sweet: sweet / os.length, deal: foodU ? dealU / foodU : 0, ticket: 0, explore: Math.min(1, 0.6 * tail + 0.4 * variety) }, orders: os });
  }
  const tLo = quantile(rows.map((r) => r.ticket), 0.1), tHi = quantile(rows.map((r) => r.ticket), 0.9);
  for (const r of rows) r.f.ticket = Math.max(0, Math.min(1, (r.ticket - tLo) / Math.max(1, tHi - tLo)));
  const k = Math.max(2, Math.min(4, Math.floor(rows.length / 40) || 2));
  // k-means++ determinístico
  const rnd = lcg(42); const dist = (a: Record<Feature, number>, b: Record<Feature, number>) => FEATS.reduce((s, f) => s + (a[f] - b[f]) ** 2, 0);
  const cents: Record<Feature, number>[] = [{ ...rows[Math.floor(rnd() * rows.length)].f }];
  while (cents.length < k) {
    const d = rows.map((r) => Math.min(...cents.map((c) => dist(r.f, c)))); const sum = d.reduce((a, b) => a + b, 0);
    let x = rnd() * sum, pick = 0; for (let i = 0; i < d.length; i++) { x -= d[i]; if (x <= 0) { pick = i; break; } }
    cents.push({ ...rows[pick].f });
  }
  let assign = rows.map(() => 0);
  for (let it = 0; it < 30; it++) {
    const next = rows.map((r) => cents.map((c, i) => [dist(r.f, c), i] as const).sort((a, b) => a[0] - b[0])[0][1]);
    for (let i = 0; i < k; i++) { const mem = rows.filter((_, j) => next[j] === i); if (mem.length) for (const f of FEATS) cents[i][f] = mem.reduce((s, r) => s + r.f[f], 0) / mem.length; }
    const same = next.every((v, j) => v === assign[j]); assign = next; if (same && it) break;
  }
  const personas: Persona[] = [];
  const used = new Set<string>();
  for (let i = 0; i < k; i++) {
    const mem = rows.filter((_, j) => assign[j] === i); if (!mem.length) continue;
    const c = cents[i];
    // o que esse grupo mais pede (linha completa, com sabores)
    const lines = new Map<string, { n: number; line: PricedLine }>(); const cats = new Map<string, number>();
    for (const r of mem) for (const o of r.orders) for (const l of o.lines) {
      const it = I.get(l.itemId); if (!it) continue; cats.set(it.categoryId, (cats.get(it.categoryId) || 0) + l.qty);
      if (!food(l)) continue; const key = lineKey(l); const cur = lines.get(key); if (cur) cur.n += l.qty; else lines.set(key, { n: l.qty, line: l });
    }
    // o prato principal do grupo (doce só entra se o grupo não pede mais nada)
    const isMain = (id: string) => !isSweetItem(I.get(id), C.get(I.get(id)?.categoryId || ""));
    const topItem = new Map<string, number>(); for (const { n, line } of lines.values()) topItem.set(line.itemId, (topItem.get(line.itemId) || 0) + n * (isMain(line.itemId) ? 1 : 0.01));
    const topItemId = [...topItem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    // quem gosta de novidade recebe no topo a combinação mais pedida pelo grupo FORA dos clássicos
    const novel = (l: PricedLine) => l.choices.some((ch) => !NOT_FLAVOR.test(ch.name) && !classics.has(norm(ch.name)));
    const cand = [...lines.values()].filter((x) => x.line.itemId === topItemId);
    const pool = c.explore >= 0.55 && cand.some((x) => novel(x.line)) ? cand.filter((x) => novel(x.line)) : cand;
    const topLine = pool.sort((a, b) => b.n - a.n)[0]?.line;
    const party = c.big >= 0.5 ? "Família e galera" : c.ticket < 0.35 ? "Pedido só pra um" : "Pedido a dois";
    const style = c.deal >= 0.6 ? "na oferta" : c.deal <= 0.35 ? "monta do seu jeito" : "oferta ou montada";
    const taste = c.explore >= 0.55 ? " · gosta de novidade" : c.explore <= 0.35 ? " · fiel aos clássicos" : "";
    let name = `${party} · ${style}${taste}${c.sweet >= 0.4 ? " · com doce" : ""}`;
    if (used.has(name)) name += ` (${i + 1})`; used.add(name);
    personas.push({
      id: `p${i + 1}`, name, customers: mem.length, share: mem.length / rows.length, avgTicket: Math.round(mem.reduce((s, r) => s + r.ticket, 0) / mem.length * 100) / 100,
      centroid: { ...c }, topItemId, topSelection: topLine ? selectionOf(topLine) : undefined, topTitle: topLine ? lineTitle(topLine) : undefined,
      // comida que o grupo pede (mais pedida primeiro), depois o resto da comida, e só então bebidas e adicionais
      categoryOrder: (() => { const side = (id: string) => isDrinkCategory(C.get(id)) || /adiciona|vinho|originais/.test(norm(C.get(id)?.name || "")); const mine = [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id); const all = catalog.categories.map((x) => x.id); return [...mine.filter((id) => !side(id)), ...all.filter((id) => !side(id) && !mine.includes(id)), ...mine.filter(side), ...all.filter((id) => side(id) && !mine.includes(id))]; })(),
    });
  }
  personas.sort((a, b) => b.share - a.share);
  personas.forEach((p, i) => (p.id = `p${i + 1}`));
  // perguntas: as dimensões em que os grupos mais diferem
  const spread = (fs: Feature[]) => Math.max(...fs.map((f) => Math.max(...personas.map((p) => p.centroid[f])) - Math.min(...personas.map((p) => p.centroid[f]))));
  const pb = opts.playbook?.length ? opts.playbook : PLAYBOOKS.pizza;
  const DIM_FEATS: Record<FvDim, Feature[]> = { party: ["big", "ticket"], novelty: ["explore"], deal: ["deal"], sweet: ["sweet"] };
  // "pra quantas pessoas" vem sempre primeiro (é a mais fácil de responder e muda o tamanho do pedido);
  // a 2ª é a dimensão em que os grupos mais diferem, ponderada pelo tamanho de cada grupo
  const wspread = (fs: Feature[]) => Math.max(...fs.map((f) => { const m = personas.reduce((s, p) => s + p.share * p.centroid[f], 0); return Math.sqrt(personas.reduce((s, p) => s + p.share * (p.centroid[f] - m) ** 2, 0)); }));
  // só as perguntas que a marca deixou ligadas no roteiro entram na disputa
  const allowed = (d: FvDim) => !opts.playbook?.length || opts.playbook.some((q) => q.dim === d && q.enabled !== false);
  const rest = (["novelty", "deal", "sweet"] as FvDim[]).filter(allowed).map((d) => ({ d, s: wspread(DIM_FEATS[d]) })).sort((a, b) => b.s - a.s);
  const max = Math.max(1, Math.min(3, opts.maxQuestions ?? 2));
  const dims: FvDim[] = (["party", ...rest.filter((x) => x.s >= 0.05).map((x) => x.d)] as FvDim[]).slice(0, max);
  void spread;
  const qOf = (d: FvDim) => pb.find((q) => q.dim === d && q.enabled !== false) || PLAYBOOKS.pizza.find((q) => q.dim === d)!;
  const questions = dims.map(qOf).map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) }));
  const model: PersonaModel = { personas, questions, customers: rows.length, ticketRange: [Math.round(tLo), Math.round(tHi)] };
  // pergunta adaptativa: se a 1ª resposta já aponta um perfil com folga, a 2ª é pulada
  if (questions.length > 1) for (const o of questions[0].options) { const post = personaPosterior(model, { [questions[0].id]: o.id }, [questions[0]]); o.final = (post[0]?.p ?? 0) >= 0.8; }
  return model;
}

/**
 * Probabilidade de cada perfil dadas as respostas (Bayes): o tamanho do grupo na base é a crença inicial,
 * e cada resposta pesa pela distância entre o que ela indica e o centro do grupo (gaussiana, sigma 0,25).
 */
export function personaPosterior(model: PersonaModel, answers: Record<string, string>, questions: FvQuestion[] = model.questions, sigma = 0.25): { persona: Persona; p: number }[] {
  const target: Partial<Record<Feature, number>> = {};
  for (const q of questions) { const o = q.options.find((x) => x.id === answers[q.id]); if (o) Object.assign(target, o.values); }
  const fs = Object.keys(target) as Feature[];
  const w = model.personas.map((p) => p.share * Math.exp(-fs.reduce((s, f) => s + (p.centroid[f] - target[f]!) ** 2, 0) / (2 * sigma * sigma)));
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  return model.personas.map((persona, i) => ({ persona, p: w[i] / tot })).sort((a, b) => b.p - a.p);
}

/** O perfil mais provável para as respostas (null sem respostas). */
export function matchPersona(model: PersonaModel, answers: Record<string, string>, questions: FvQuestion[] = model.questions): Persona | null {
  const any = questions.some((q) => q.options.some((o) => o.id === answers[q.id]));
  if (!any || !model.personas.length) return null;
  return personaPosterior(model, answers, questions)[0].persona;
}

/* ---------------- sem base: escolhe pelo que a pessoa respondeu ---------------- */
export interface FvTarget { itemId?: ID; selection?: Record<string, Record<string, number>>; title?: string; categoryOrder: ID[]; personaId?: string; personaName?: string }

export function targetFromAnswers(catalog: FvCatalog, questions: FvQuestion[], answers: Record<string, string>): FvTarget {
  const v: Partial<Record<Feature, number>> = {};
  for (const q of questions) { const o = q.options.find((x) => x.id === answers[q.id]); if (o) Object.assign(v, o.values); }
  const C = new Map(catalog.categories.map((c) => [c.id, c]));
  const cands = catalog.items.filter((i) => !i.isDrink && !isDrinkCategory(C.get(i.categoryId)) && !isSweetCategory(C.get(i.categoryId)));
  const sz = (it: FvItem) => { const n = norm(it.name); return isMulti(it) ? 3 : /\b(40|45|grande|familia)\b|40cm/.test(n) ? 2 : /\b(25|30|35|broto|pequena|individual)\b|30cm|35cm/.test(n) ? 1 : 1.5; };
  const want = v.big !== undefined ? (v.big >= 0.75 ? 3 : (v.ticket ?? 0.5) >= 0.4 ? 2 : 1) : undefined;
  const deal = v.deal;
  const score = (it: FvItem) => {
    const locked = !!C.get(it.categoryId)?.pricingLocked || it.kind === "combo" || it.kind === "offer";
    let s = 0;
    if (want !== undefined) s -= Math.abs(sz(it) - want) * 2;
    if (deal !== undefined) s -= (deal >= 0.5 ? (locked ? 0 : 1.5) : (it.kind === "buildable" ? 0 : locked ? 1.5 : 0.5));
    // quem quer novidade vai para o que se monta (escolhe os sabores); quem quer o clássico, para a oferta pronta
    if (v.explore !== undefined) s -= v.explore >= 0.5 ? (it.kind === "buildable" ? 0 : 0.75) : (locked ? 0 : 0.75);
    return s - it.price / 10000; // empate: o mais barato
  };
  const best = [...cands].sort((a, b) => score(b) - score(a))[0];
  // ordem: a categoria do item primeiro; doce sobe para 2º se a pessoa quer doce
  const cats = catalog.categories.map((c) => c.id);
  let ord = best ? [best.categoryId, ...cats.filter((c) => c !== best.categoryId)] : cats;
  const sweetCat = catalog.categories.find((c) => isSweetCategory(c))?.id;
  if (sweetCat && (v.sweet ?? 0) >= 0.5) ord = [ord[0], sweetCat, ...ord.slice(1).filter((c) => c !== sweetCat)].filter((x, i, a) => a.indexOf(x) === i);
  return { itemId: best?.id, title: best?.name.split(" · ")[0], categoryOrder: ord };
}

/* ---------------- campanhas ---------------- */
export function matchCampaign(list: CampaignTarget[], q: { source?: string; campaign?: string; content?: string }): CampaignTarget | undefined {
  const eq = (rule?: string, val?: string) => !rule || (!!val && norm(rule) === norm(val));
  const live = list.filter((c) => c.active && (c.source || c.campaign || c.content) && eq(c.source, q.source) && eq(c.campaign, q.campaign) && eq(c.content, q.content));
  // a regra mais específica vence
  return live.sort((a, b) => [b.source, b.campaign, b.content].filter(Boolean).length - [a.source, a.campaign, a.content].filter(Boolean).length)[0];
}

/* ---------------- identidade para pagamento online ---------------- */
export function validCpfDigits(v: string) {
  const d = (v || "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
/** Data de nascimento ISO válida, entre 14 e 110 anos. */
export function validBirthDate(iso: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false;
  const d = new Date(iso + "T12:00:00Z"); if (Number.isNaN(+d) || d.toISOString().slice(0, 10) !== iso) return false;
  const age = (+now - +d) / (365.25 * 864e5);
  return age >= 14 && age <= 110;
}
