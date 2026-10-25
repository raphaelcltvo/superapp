/**
 * "Copiar do iFood": lê o cardápio público de uma loja no iFood e transforma na estrutura do SuperApp.
 * Vale para qualquer culinária. As particularidades vêm dos próprios dados:
 *   grupos "1/2 sabor" com mínimo = máximo = 2 → meio a meio; "500 g", "1,5 L", "12 unidades" → medida;
 *   "serve 4" → porção; "vegano", "sem glúten" → selos; categorias de combo/promoção → preço fechado.
 * Grupos iguais repetidos em vários itens (o iFood duplica um grupo por item) viram um grupo só.
 */
import type { Category, CuisineId, GroupRole, Item, ItemKind, Measure, Option, OptionGroup } from "./types";
import { detectCuisine, tagsFromText } from "./cuisines";
import { r2, suggestBasePrice } from "./pricing";

/* ---------------- formato cru do iFood (tolerante a variações) ---------------- */
export interface IfoodRawOption { id?: string; code?: string; description?: string; name?: string; details?: string; unitPrice?: number; price?: number; logoUrl?: string }
export interface IfoodRawChoice { code?: string; name?: string; min?: number; max?: number; garnishItens?: IfoodRawOption[]; garnishItems?: IfoodRawOption[]; options?: IfoodRawOption[] }
export interface IfoodRawItem {
  id?: string; code?: string; description?: string; name?: string; details?: string; logoUrl?: string; needChoices?: boolean;
  unitPrice?: number; unitMinPrice?: number; unitOriginalPrice?: number; originalPrice?: number; price?: number; availability?: string; choices?: IfoodRawChoice[];
}
export interface IfoodRawCategory { code?: string; name?: string; itens?: IfoodRawItem[]; items?: IfoodRawItem[] }
/** O que o bookmarklet envia: catálogo da página + detalhes (complementos) de cada item. */
export interface IfoodBundle { merchant?: { id?: string; name?: string; url?: string }; catalog: unknown; details?: Record<string, unknown> }

/* ---------------- formato neutro ---------------- */
export interface ImportedOption { name: string; description?: string; price: number; imageUrl?: string }
export interface ImportedChoice { name: string; min: number; max: number; options: ImportedOption[] }
export interface ImportedItem { ifoodId: string; name: string; description?: string; price: number; minPrice?: number; originalPrice?: number; imageUrl?: string; available: boolean; needChoices: boolean; choices: ImportedChoice[] }
export interface ImportedMenu { merchant: { id?: string; name?: string; url?: string }; categories: { name: string; items: ImportedItem[] }[] }

export const IFOOD_IMG = (logo: string) => (/^https?:/.test(logo) ? logo : `https://static.ifood-static.com.br/image/upload/t_high/pratos/${logo}`);
export const IFOOD_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Extrai o id da loja (UUID) de um link do iFood. */
export function ifoodMerchantId(url: string): string | null {
  const m = url.match(IFOOD_UUID);
  return m ? m[m.length - 1].toLowerCase() : null;
}

/** Nome legível a partir do link: ".../forneria-original-pizza---barra-barra-da-tijuca/<uuid>" → "Forneria Original Pizza - Barra Barra Da Tijuca". */
export function ifoodNameFromUrl(url: string): string | undefined {
  const parts = url.split("?")[0].split("/").filter(Boolean);
  const i = parts.findIndex((p) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p));
  const s = i > 0 ? parts[i - 1] : undefined;
  if (!s || s.includes(".")) return undefined;
  return s.replace(/---/g, " – ").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ (Da|De|Do|Das|Dos|E) /g, (m) => m.toLowerCase()).replace(/ – /g, " - ").trim();
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && !isNaN(Number(v)) ? Number(v) : undefined);

function categoriesOf(raw: unknown): IfoodRawCategory[] {
  if (Array.isArray(raw)) return raw as IfoodRawCategory[];
  if (!isObj(raw)) return [];
  if (Array.isArray(raw.menu)) return raw.menu as IfoodRawCategory[];
  if (isObj(raw.data)) return categoriesOf(raw.data);
  if (Array.isArray(raw.categories)) return raw.categories as IfoodRawCategory[];
  if ("catalog" in raw) return categoriesOf(raw.catalog);
  return [];
}
/** Procura a lista de complementos em qualquer nível da resposta de detalhe do item. */
function choicesOf(detail: unknown, depth = 0): IfoodRawChoice[] | undefined {
  if (depth > 5 || !detail) return undefined;
  if (Array.isArray(detail)) { for (const x of detail) { const c = choicesOf(x, depth + 1); if (c) return c; } return undefined; }
  if (!isObj(detail)) return undefined;
  if (Array.isArray(detail.choices)) return detail.choices as IfoodRawChoice[];
  for (const k of ["data", "item", "items", "itens", "menu"]) { const c = choicesOf(detail[k], depth + 1); if (c) return c; }
  return undefined;
}

/** Catálogo cru (ou o pacote do bookmarklet) → cardápio neutro. */
export function normalizeIfood(input: unknown): ImportedMenu {
  const bundle: IfoodBundle = isObj(input) && "catalog" in input ? (input as unknown as IfoodBundle) : { catalog: input };
  const details = bundle.details || {};
  const cats = categoriesOf(bundle.catalog);
  return {
    merchant: { id: bundle.merchant?.id, name: bundle.merchant?.name, url: bundle.merchant?.url },
    categories: cats.map((c) => ({
      name: str(c.name) || "Sem categoria",
      items: (c.itens || c.items || []).map((it): ImportedItem => {
        const id = str(it.id) || str(it.code);
        const raws = it.choices?.length ? it.choices : choicesOf(details[id]) || [];
        const price = n(it.unitPrice) ?? n(it.price) ?? 0;
        const orig = n(it.unitOriginalPrice) ?? n(it.originalPrice);
        return {
          ifoodId: id, name: str(it.description) || str(it.name), description: str(it.details) || undefined, price, minPrice: n(it.unitMinPrice),
          originalPrice: orig && orig > price ? orig : undefined, imageUrl: it.logoUrl ? IFOOD_IMG(it.logoUrl) : undefined,
          available: !it.availability || /available|ativo|true/i.test(String(it.availability)), needChoices: !!it.needChoices,
          choices: raws.map((ch) => ({
            name: str(ch.name) || "Opções", min: n(ch.min) ?? 0, max: Math.max(n(ch.max) ?? 1, n(ch.min) ?? 0, 1),
            options: (ch.garnishItens || ch.garnishItems || ch.options || []).map((o) => ({ name: str(o.description) || str(o.name), description: str(o.details) || undefined, price: n(o.unitPrice) ?? n(o.price) ?? 0, imageUrl: o.logoUrl ? IFOOD_IMG(o.logoUrl) : undefined })).filter((o) => o.name),
          })),
        };
      }).filter((i) => i.name),
    })).filter((c) => c.items.length),
  };
}

/* ---------------- leitura dos nomes ---------------- */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = (s: string) => norm(s).replace(/&/g, "e").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); }

/** "Coca-Cola 1,5L" → 1,5 L; "Costela 500g" → 500 g; "Caixa com 12 esfihas"/"20 peças" → 12 un. */
export function parseMeasure(text: string): Measure | undefined {
  const t = norm(text);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s?(ml|l|lt|litros?|kg|g|gr|gramas)(?![a-z])/);
  if (m) {
    const v = Number(m[1].replace(",", "."));
    const u = m[2];
    if (u === "ml") return { unit: "ml", amount: v };
    if (u === "l" || u === "lt" || u.startsWith("litro")) return { unit: "ml", amount: r2(v * 1000) };
    if (u === "kg") return { unit: "g", amount: r2(v * 1000) };
    return { unit: "g", amount: v };
  }
  const p = t.match(/(\d+)\s?(unidades|unid|un|pecas|pcs|pedacos|esfihas|salgados|docinhos|fatias)(?![a-z])/) || t.match(/(?:caixa|kit|combo|porcao|cento)\s+(?:com|de)\s+(\d+)/);
  if (p) { const v = Number(p[1]); if (v > 1) return { unit: "un", amount: v }; }
  if (/\bcento\b/.test(t)) return { unit: "un", amount: 100 };
  return undefined;
}
export function parseServes(text: string): string | undefined {
  const t = norm(text);
  const m = t.match(/serve(?:m)?\s*(?:ate\s*)?(\d+)/) || t.match(/(\d+)\s*(?:pessoas|pax)/);
  return m ? `serve ${m[1]}` : undefined;
}
const DRINK_CAT = /bebida|refri|suco|cerveja|chopp|vinho|drink|agua|cafe|cha\b|refrigerante|destilad|whisky|gin\b|vodka/;
const DRINK_ITEM = /coca|guarana|pepsi|fanta|sprite|refrigerante|\bsuco\b|\bagua\b|cerveja|heineken|budweiser|stella|chopp|vinho|espumante|\bcha\b|mate\b|energetico|red bull|schweppes|tonica/;
const LOCKED_CAT = /combo|promo|oferta|% ?off|imbativ|i m b a t|\bkit|mais pedidos|leve \d|pague \d|desconto|economi|hits\b/;
const LOCKED_ITEM_COMBO = /combo|\+|\bduas?\b|\bdois\b|\bkit\b|leve \d/;

export function guessRole(name: string): GroupRole | undefined {
  const t = norm(name);
  if (/ponto|instruc|observ|talher|hashi|pimenta|picancia|nivel|temperatura|cortar|corte/.test(t)) return "instruction";
  if (/tamanho|porcao de|quantidade|peso|volume|\bml\b/.test(t)) return "size";
  if (/bebida|refri|suco|drink|cerveja|vinho/.test(t)) return "drink";
  if (/borda|massa|base\b|tipo de pao|arroz/.test(t)) return "base";
  if (/sabor|recheio|1\/2|pizza|esfiha|temaki|poke/.test(t)) return "flavor";
  if (/proteina|carne|frango|peixe/.test(t)) return "protein";
  if (/molho|calda|tempero/.test(t)) return "sauce";
  if (/acompanhamento|guarnic|lado|fritas/.test(t)) return "side";
  if (/sobremesa|doce/.test(t)) return "dessert";
  if (/adicion|extra|turbin|complement|cobertura|topping|acrescent/.test(t)) return "addon";
  return undefined;
}

const HALF = /^\s*(?:1\/2|½|meia|metade)\s*/i;
const isHalves = (c: ImportedChoice) => c.min === 2 && c.max === 2 && c.options.length > 0 && c.options.filter((o) => HALF.test(o.name)).length >= c.options.length * 0.8;
const cleanHalf = (s: string) => s.replace(HALF, "").replace(/\s*-\s*2[ªa]\s*pizza$/i, "").trim();
const signature = (c: ImportedChoice) => [norm(c.name), c.min, c.max, ...c.options.map((o) => `${norm(o.name)}:${o.price}`)].join("|");

export interface ImportPlan {
  merchant: ImportedMenu["merchant"];
  cuisine: CuisineId;
  cuisineRanking: { id: CuisineId; label: string; score: number }[];
  categories: Category[];
  groups: OptionGroup[];
  items: Item[];
  report: {
    counts: { categories: number; items: number; groups: number; options: number; photos: number; buildable: number; combos: number };
    /** grupos repetidos no iFood que viraram um só */
    mergedGroups: number;
    /** itens idênticos (mesmo nome e preço na mesma categoria) que entraram uma vez */
    skippedDuplicates: number;
    warnings: { where: string; message: string }[];
  };
}

/** Cardápio neutro → categorias, grupos e itens do SuperApp (rascunho, nada publicado). */
export function planIfoodImport(menu: ImportedMenu, opts: { cuisine?: CuisineId } = {}): ImportPlan {
  const warnings: ImportPlan["report"]["warnings"] = [];
  const names = menu.categories.flatMap((c) => [c.name, ...c.items.map((i) => i.name)]);
  const ranking = detectCuisine(names);
  const cuisine = opts.cuisine || ranking[0]?.id || "generico";

  const categories: Category[] = []; const catIds = new Set<string>();
  const groups: OptionGroup[] = []; const groupBySig = new Map<string, string>();
  const items: Item[] = []; let instances = 0; let skipped = 0;

  /** surcharge: preço próprio do item montável no iFood (ex.: borda), somado ao preço inteiro de cada sabor. */
  function groupFor(c: ImportedChoice, asFraction: boolean, surcharge = 0): string {
    instances++;
    const sig = signature(c) + (asFraction ? `|f+${surcharge}` : "");
    const hit = groupBySig.get(sig); if (hit) return hit;
    const id = `ifg_${hash(sig)}${asFraction ? "f" : ""}`;
    const variant = asFraction && surcharge ? ` (+${String(surcharge).replace(".", ",")})` : "";
    const seen = new Set<string>();
    const options: Option[] = c.options.map((o) => {
      const name = asFraction ? cleanHalf(o.name) : o.name;
      let oid = slug(name).slice(0, 40) || "opcao"; while (seen.has(oid)) oid += "-2"; seen.add(oid);
      const measure = parseMeasure(name);
      const tags = tagsFromText(name, o.description);
      return {
        id: oid, name, ...(o.description ? { description: o.description.replace(/^\((.*)\)\.?$/, "$1").trim() } : {}),
        price: asFraction ? 0 : r2(o.price), ...(asFraction ? { fullPrice: r2(o.price * 2 + surcharge) } : {}),
        ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}), ...(measure ? { measure } : {}), ...(tags.length ? { tags } : {}), active: true,
      };
    });
    if (!options.length) warnings.push({ where: `Grupo · ${c.name}`, message: "Grupo sem opções no iFood" });
    const role = asFraction ? "flavor" : guessRole(c.name);
    const g: OptionGroup = {
      id, name: c.name.replace(/[.:]\s*$/, "") + variant, min: c.min, max: c.max,
      rule: asFraction ? "fraction" : "sum", allowRepeat: asFraction || (c.max > 1 && c.min === c.max), ...(role ? { role } : {}), options,
    };
    // grupo obrigatório com menos opções do que o mínimo e sem repetição: impossível de completar
    if (!g.allowRepeat && g.min > options.length) { warnings.push({ where: `Grupo · ${c.name}`, message: `Pede ${g.min} escolhas e tem ${options.length} opções` }); g.min = options.length; }
    if (g.max < g.min) g.max = g.min;
    if (role === "drink") { const ms = options.map((o) => o.measure).find((m) => m?.unit === "ml"); if (ms) g.liters = ms.amount / 1000; }
    groups.push(g); groupBySig.set(sig, id); return id;
  }

  menu.categories.forEach((c) => {
    const locked = LOCKED_CAT.test(norm(c.name));
    let cid = `cat_${slug(c.name) || "categoria"}`; while (catIds.has(cid)) cid += "-2"; catIds.add(cid);
    const cat: Category = { id: cid, name: c.name.replace(/\s*;\s*\w?\)?$/, "").trim() || c.name, slug: slug(c.name), position: categories.length, visible: true, ...(locked ? { pricingLocked: true } : {}) };
    categories.push(cat);
    const drinkCat = DRINK_CAT.test(norm(c.name));
    const seen = new Set<string>();
    for (const it of c.items) {
      const key = `${norm(it.name)}|${it.price}|${it.minPrice ?? ""}`;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      if (it.needChoices && !it.choices.length) warnings.push({ where: `Item · ${it.name}`, message: "O iFood pede escolhas, mas os complementos não vieram: confira o item" });
      const halves = !locked && it.choices.some(isHalves);
      // montável: o preço do item no iFood entra no preço inteiro de cada sabor (no SuperApp o preço base = combinação mais barata)
      let surcharge = halves ? it.price : 0;
      const groupIds = it.choices.map((ch) => { const f = halves && isHalves(ch); const id = groupFor(ch, f, f ? surcharge : 0); if (f) surcharge = 0; return id; });
      let price = it.price;
      if (halves) {
        const gs = groups.filter((g) => groupIds.includes(g.id));
        price = suggestBasePrice({ kind: "buildable", price: 0 } as Item, gs);
      }
      const kind: ItemKind = halves ? "buildable" : locked ? (LOCKED_ITEM_COMBO.test(norm(it.name)) || /mais pedidos/.test(norm(c.name)) ? "combo" : "offer") : "simple";
      const text = `${it.name} ${it.description || ""}`;
      const measure = parseMeasure(it.name) || (it.description ? parseMeasure(it.description) : undefined);
      const serves = parseServes(text);
      const tags = tagsFromText(it.name, c.name, it.description);
      const isDrink = drinkCat || DRINK_ITEM.test(norm(it.name));
      if (!it.imageUrl && !isDrink) warnings.push({ where: `Item · ${it.name}`, message: "Sem foto no iFood" });
      if (!halves && price === 0 && !it.choices.length) warnings.push({ where: `Item · ${it.name}`, message: "Preço zero e sem complementos" });
      items.push({
        id: `if_${it.ifoodId || hash(key)}`, categoryId: cid, name: it.name.replace(/\.$/, "").trim(), ...(it.description ? { description: it.description.replace(/^\((.*)\)\.?$/, "$1").trim() } : {}),
        ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}), kind, price: r2(price), ...(it.originalPrice ? { compareAt: r2(it.originalPrice) } : {}), groupIds,
        active: true, available: it.available, position: items.filter((x) => x.categoryId === cid).length,
        ...(measure ? { measure } : {}), ...(serves ? { serves } : {}), ...(tags.length ? { tags } : {}),
        ...(isDrink ? { isDrink: true, ...(measure?.unit === "ml" ? { liters: measure.amount / 1000 } : {}) } : {}),
        importedFrom: { source: "ifood", id: it.ifoodId },
      });
    }
  });

  const used = categories.filter((c) => items.some((i) => i.categoryId === c.id)).map((c, position) => ({ ...c, position }));
  return {
    merchant: menu.merchant, cuisine, cuisineRanking: ranking, categories: used, groups, items,
    report: {
      counts: { categories: used.length, items: items.length, groups: groups.length, options: groups.reduce((a, g) => a + g.options.length, 0), photos: items.filter((i) => i.imageUrl).length, buildable: items.filter((i) => i.kind === "buildable").length, combos: items.filter((i) => i.kind === "combo" || i.kind === "offer").length },
      mergedGroups: instances - groups.length, skippedDuplicates: skipped, warnings,
    },
  };
}
