import type { CartLineInput, Item, Option, OptionGroup, PricedChoice, PricedLine, Selection } from "./types";

/** Arredonda para centavos sem erro de ponto flutuante. */
export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const BRL = (v: number) => "R$ " + r2(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const active = (g: OptionGroup) => g.options.filter((o) => o.active);

/** Preço do sabor mais barato de um grupo meio a meio (a "base"). */
export function fractionBase(g: OptionGroup): number {
  const fulls = active(g).map((o) => o.fullPrice ?? 0);
  return fulls.length ? Math.min(...fulls) : 0;
}

/** Acréscimo de uma fração: metade (ou 1/n) da diferença do sabor inteiro para a base. */
export function fractionDelta(g: OptionGroup, o: Option, unitsSelected: number): number {
  const n = Math.max(1, unitsSelected);
  return r2(((o.fullPrice ?? 0) - fractionBase(g)) / n);
}

/**
 * Preço base sugerido para um item montável: a combinação mais barata de todos os grupos obrigatórios.
 * Grupos meio a meio contribuem com o sabor inteiro mais barato; grupos de soma, com as `min` opções mais baratas.
 */
export function suggestBasePrice(item: Item, groups: OptionGroup[]): number {
  if (item.kind !== "buildable") return item.price;
  let v = 0;
  for (const g of groups) {
    if (g.rule === "fraction") v += fractionBase(g);
    else if (g.min > 0) v += active(g).map((o) => o.price).sort((a, b) => a - b).slice(0, g.min).reduce((a, b) => a + b, 0);
  }
  return r2(v);
}

/** Regra fechada: combo e oferta nunca cobram diferença proporcional, mesmo que o grupo esteja marcado como fraction. */
export function effectiveRule(item: Item, g: OptionGroup): "sum" | "fraction" {
  if (item.kind === "combo" || item.kind === "offer") return "sum";
  return g.rule;
}

export interface ValidationIssue { groupId: string; need: number; message: string }

export function groupCount(sel: Selection, gid: string) {
  return Object.values(sel[gid] || {}).reduce((a, b) => a + b, 0);
}

export function validateSelection(item: Item, groups: OptionGroup[], sel: Selection = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const g of groups) {
    const c = groupCount(sel, g.id);
    const s = sel[g.id] || {};
    if (c < g.min) issues.push({ groupId: g.id, need: g.min - c, message: `Falta${g.min - c > 1 ? "m" : ""} ${g.min - c} em ${g.name}` });
    if (c > g.max) issues.push({ groupId: g.id, need: 0, message: `Máximo de ${g.max} em ${g.name}` });
    for (const [oid, q] of Object.entries(s)) {
      const o = g.options.find((x) => x.id === oid);
      if (!o) issues.push({ groupId: g.id, need: 0, message: `Opção inexistente em ${g.name}` });
      else if (!o.active) issues.push({ groupId: g.id, need: 0, message: `${o.name} indisponível` });
      if (!g.allowRepeat && q > 1) issues.push({ groupId: g.id, need: 0, message: `${g.name} não aceita repetir opção` });
    }
  }
  return issues;
}

const FRACTIONS: Record<number, string> = { 1: "inteira", 2: "1/2", 3: "1/3", 4: "1/4" };

/** Calcula o preço unitário e o detalhamento de uma linha da sacola. */
export function priceLine(item: Item, groups: OptionGroup[], input: CartLineInput): PricedLine {
  const sel = input.selection || {};
  const choices: PricedChoice[] = [];
  let unit = item.price;
  for (const g of groups) {
    const s = sel[g.id] || {};
    const units = groupCount(sel, g.id);
    const rule = effectiveRule(item, g);
    for (const [oid, q] of Object.entries(s)) {
      if (!q) continue;
      const o = g.options.find((x) => x.id === oid);
      if (!o) continue;
      const unitDelta = rule === "fraction" ? fractionDelta(g, o, units) : r2(o.price);
      unit += unitDelta * q;
      choices.push({
        groupId: g.id,
        optionId: o.id,
        name: o.name,
        qty: q,
        unitDelta,
        fraction: rule === "fraction" ? (q === units ? FRACTIONS[1] : `${q}/${units}`) : undefined,
        integrationCode: o.integrationCode,
      });
    }
  }
  unit = r2(unit);
  return { itemId: item.id, name: item.name, qty: input.qty, unit, total: r2(unit * input.qty), base: item.price, choices, notes: input.notes, integrationCode: item.integrationCode };
}

/** Texto do "a partir de" no card. */
export function hasVariablePrice(item: Item, groups: OptionGroup[]) {
  return groups.some((g) => effectiveRule(item, g) === "fraction" ? active(g).some((o) => (o.fullPrice ?? 0) > fractionBase(g)) : active(g).some((o) => o.price > 0));
}

/**
 * Menor preço possível do item para exibir no card ("a partir de"): preço do item + as escolhas
 * obrigatórias mais baratas dos grupos de soma. Grupos meio a meio já estão no preço base.
 */
export function minPrice(item: Item, groups: OptionGroup[]): number {
  let v = item.price;
  for (const g of groups) {
    if (g.min <= 0 || effectiveRule(item, g) === "fraction") continue;
    const prices = active(g).map((o) => o.price).sort((a, b) => a - b);
    v += g.allowRepeat ? (prices[0] ?? 0) * g.min : prices.slice(0, g.min).reduce((a, b) => a + b, 0);
  }
  return r2(v);
}

/** Linha para cada opção de um grupo meio a meio: "+ R$ 30,00 a metade · inteira R$ 159,00". */
export function fractionLabel(g: OptionGroup, o: Option) {
  const d = fractionDelta(g, o, g.max);
  return { half: d, full: o.fullPrice ?? 0, isBase: d === 0 };
}
