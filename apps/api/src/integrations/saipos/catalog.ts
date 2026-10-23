import type { Item, OptionGroup } from "@cw/core";
import type { SaiposCatalogRow } from "./types";

export interface SaiposCatalogItem { key: string; name: string; size: string; category: string; code: string; price: number; enabled: boolean; groups: { id: number; name: string; min: number | null; max: number | null; calc: string | null; options: { name: string; code: string; price: number; enabled: boolean }[] }[] }

/** Agrupa as linhas do JSON da SAIPOS em itens com seus grupos de complementos. */
export function groupCatalog(rows: SaiposCatalogRow[]): SaiposCatalogItem[] {
  const items = new Map<string, SaiposCatalogItem>();
  for (const r of rows) {
    const key = `${r.id_store_item}|${r.tamanho}`;
    if (!items.has(key)) items.set(key, { key, name: r.item, size: r.tamanho, category: r.categoria, code: r.tipo === "COMPLEMENTO" ? r.codigo_saipos.split(".")[0] : r.codigo_saipos, price: 0, enabled: r.store_item_enabled === "Y", groups: [] });
    const it = items.get(key)!;
    if (r.tipo !== "COMPLEMENTO") { it.code = r.codigo_saipos; it.price = r.price; continue; }
    let g = it.groups.find((x) => x.id === r.id_store_choice);
    if (!g) { g = { id: r.id_store_choice!, name: r.complemento, min: r.min_choices, max: r.max_choices, calc: r.calc_method, options: [] }; it.groups.push(g); }
    g.options.push({ name: r.complemento_item, code: r.codigo_saipos, price: r.price, enabled: r.store_choice_item_enabled === "Y" && r.store_choice_enabled === "Y" });
  }
  return [...items.values()];
}

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(pizza|de|da|do|com|c\/|e)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
function sim(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter(Boolean)), B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(A.size, B.size);
}

export interface MappingSuggestion {
  itemId: string; itemName: string; current?: string;
  match?: { code: string; name: string; score: number };
  options: { groupId: string; optionId: string; name: string; current?: string; match?: { code: string; name: string; score: number } }[];
}

/** Sugere o de-para entre o cardápio e os códigos PDV da SAIPOS por semelhança de nome (o gestor confirma no painel). */
export function suggestMapping(items: Item[], groups: Record<string, OptionGroup>, sc: SaiposCatalogItem[]): MappingSuggestion[] {
  return items.map((it) => {
    const ranked = sc.map((s) => ({ s, score: sim(it.name, `${s.name} ${s.size}`) })).sort((a, b) => b.score - a.score);
    const best = ranked[0] && ranked[0].score >= 0.34 ? ranked[0] : undefined;
    const allOpts = (best ? best.s.groups : sc.flatMap((s) => s.groups)).flatMap((g) => g.options);
    const options = it.groupIds.flatMap((gid) => (groups[gid]?.options || []).map((o) => {
      const m = allOpts.map((x) => ({ x, score: sim(o.name, x.name) })).sort((a, b) => b.score - a.score)[0];
      return { groupId: gid, optionId: o.id, name: o.name, current: o.integrationCode, match: m && m.score >= 0.5 ? { code: m.x.code, name: m.x.name, score: Math.round(m.score * 100) / 100 } : undefined };
    }));
    return { itemId: it.id, itemName: it.name, current: it.integrationCode, match: best ? { code: best.s.code, name: `${best.s.name} · ${best.s.size}`, score: Math.round(best.score * 100) / 100 } : undefined, options };
  });
}
