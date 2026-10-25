import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { freeUnits, guessRole, ifoodMerchantId, ifoodNameFromUrl, minPrice, normalizeIfood, parseMeasure, parseServes, planIfoodImport, priceLine, suggestBasePrice } from "../src";

const barra = () => JSON.parse(readFileSync(new URL("../../../apps/api/src/seed/ifood-barra/raw.json", import.meta.url), "utf8"));

/** Hamburgueria + açaí em formatos diferentes: complementos dentro do item, nomes alternativos de campos. */
const burger = {
  data: { menu: [
    { code: "c1", name: "Combos", itens: [
      { id: "b-combo", description: "Combo Smash + Fritas + Refri", details: "Serve 1 pessoa", unitPrice: 42.9, unitOriginalPrice: 49.9, logoUrl: "abc/combo.jpg", needChoices: true, choices: [
        { name: "Ponto da carne", min: 1, max: 1, garnishItens: [{ description: "Ao ponto", unitPrice: 0 }, { description: "Bem passado", unitPrice: 0 }] },
        { name: "Escolha sua bebida", min: 1, max: 1, garnishItens: [{ description: "Coca-Cola Lata 350ml", unitPrice: 0 }, { description: "Guaraná Lata 350ml", unitPrice: 0 }] },
      ] },
    ] },
    { code: "c2", name: "Burgers", items: [
      { id: "b-smash", name: "Smash Duplo", details: "Pão brioche, 2 smash 80g", price: 32.9, logoUrl: "abc/smash.jpg", needChoices: true },
      { id: "b-veg", description: "Burger Vegano de Grão-de-bico", unitPrice: 36.9, logoUrl: "abc/veg.jpg", needChoices: true },
      { id: "b-veg-dup", description: "Burger Vegano de Grão-de-bico", unitPrice: 36.9, logoUrl: "abc/veg.jpg", needChoices: true },
    ] },
    { code: "c3", name: "Açaí", itens: [
      { id: "a-1", description: "Açaí 500ml", unitPrice: 22, logoUrl: "abc/acai.jpg", needChoices: true },
    ] },
    { code: "c4", name: "Bebidas", itens: [{ id: "d-1", description: "Água sem gás 500ml", unitPrice: 5 }] },
  ] },
};
const burgerDetails = {
  "b-smash": { data: { item: { choices: [
    { name: "Adicionais", min: 0, max: 5, garnishItems: [{ name: "Bacon", unitPrice: 6 }, { name: "Cheddar", unitPrice: 5 }] },
    { name: "Ponto da carne", min: 1, max: 1, garnishItens: [{ description: "Ao ponto", unitPrice: 0 }, { description: "Bem passado", unitPrice: 0 }] },
  ] } } },
  "b-veg": { choices: [{ name: "Adicionais", min: 0, max: 5, options: [{ name: "Bacon", price: 6 }, { name: "Cheddar", price: 5 }] }] },
  "a-1": [{ choices: [{ name: "Complementos", min: 0, max: 4, garnishItens: [{ description: "Granola", unitPrice: 2 }, { description: "Leite em pó", unitPrice: 2 }, { description: "Nutella", unitPrice: 6 }] }] }],
};

describe("Copiar do iFood", () => {
  it("lê o link da loja, medidas e porções", () => {
    expect(ifoodMerchantId("https://www.ifood.com.br/delivery/rio-de-janeiro-rj/forneria---barra/5D4C3A2B-1F0E-4D9C-8B7A-6F5E4D3C2B1A?utm=x")).toBe("5d4c3a2b-1f0e-4d9c-8b7a-6f5e4d3c2b1a");
    expect(ifoodMerchantId("https://ifood.com.br/qualquer")).toBeNull();
    expect(ifoodNameFromUrl("https://www.ifood.com.br/delivery/rio-de-janeiro-rj/forneria-original-pizza---barra-barra-da-tijuca/5d4c3a2b-1f0e-4d9c-8b7a-6f5e4d3c2b1a")).toBe("Forneria Original Pizza - Barra Barra da Tijuca");
    expect(parseMeasure("Coca-Cola 1,5L")).toEqual({ unit: "ml", amount: 1500 });
    expect(parseMeasure("Costela no bafo 1kg")).toEqual({ unit: "g", amount: 1000 });
    expect(parseMeasure("Picanha 400 g")).toEqual({ unit: "g", amount: 400 });
    expect(parseMeasure("Caixa com 12 esfihas")).toEqual({ unit: "un", amount: 12 });
    expect(parseMeasure("Combinado 20 peças")).toEqual({ unit: "un", amount: 20 });
    expect(parseMeasure("Pizza 40cm")).toBeUndefined();
    expect(parseServes("Kit família (serve 4 pessoas)")).toBe("serve 4");
    expect(parseServes("Para 3 pessoas")).toBe("serve 3");
    expect(guessRole("Ponto da carne")).toBe("instruction");
    expect(guessRole("Escolha o tamanho")).toBe("size");
    expect(guessRole("Turbine seu lanche")).toBe("addon");
  });

  it("hamburgueria e açaí: grupos repetidos viram um só, detalhes separados, combo de preço fechado, selos e bebida", () => {
    const menu = normalizeIfood({ merchant: { name: "Burger Teste" }, catalog: burger, details: burgerDetails });
    expect(menu.categories.map((c) => c.items.length)).toEqual([1, 3, 1, 1]);
    const p = planIfoodImport(menu);
    expect(p.cuisine).toBe("hamburguer");
    expect(p.report.skippedDuplicates).toBe(1);
    // "Adicionais" aparece em dois itens com nomes de campos diferentes: um grupo só. "Ponto da carne" idem.
    const adic = p.groups.filter((g) => g.name === "Adicionais"); expect(adic).toHaveLength(1);
    expect(p.groups.filter((g) => g.name === "Ponto da carne")).toHaveLength(1);
    expect(p.report.mergedGroups).toBe(2);
    expect(p.groups.find((g) => g.name === "Ponto da carne")!.role).toBe("instruction");
    const combo = p.items.find((i) => i.importedFrom?.id === "b-combo")!;
    expect(p.categories.find((c) => c.id === combo.categoryId)!.pricingLocked).toBe(true);
    expect(combo).toMatchObject({ kind: "combo", price: 42.9, compareAt: 49.9, serves: "serve 1", imageUrl: "https://static.ifood-static.com.br/image/upload/t_high/pratos/abc/combo.jpg" });
    expect(p.groups.find((g) => g.role === "drink")!.options[0].measure).toEqual({ unit: "ml", amount: 350 });
    const veg = p.items.find((i) => i.importedFrom?.id === "b-veg")!;
    expect(veg.tags).toContain("vegano"); expect(veg.kind).toBe("simple");
    const acai = p.items.find((i) => i.importedFrom?.id === "a-1")!;
    expect(acai.measure).toEqual({ unit: "ml", amount: 500 });
    const water = p.items.find((i) => i.importedFrom?.id === "d-1")!;
    expect(water).toMatchObject({ isDrink: true, liters: 0.5 });
    expect(p.report.warnings.some((w) => /sem foto/i.test(w.message))).toBe(false);
    // o preço da linha bate com o iFood: smash + bacon + cheddar
    const smash = p.items.find((i) => i.importedFrom?.id === "b-smash")!;
    const gs = p.groups.filter((g) => smash.groupIds.includes(g.id));
    const ad = gs.find((g) => g.name === "Adicionais")!; const pt = gs.find((g) => g.role === "instruction")!;
    expect(priceLine(smash, gs, { itemId: smash.id, qty: 1, selection: { [ad.id]: { bacon: 1, cheddar: 1 }, [pt.id]: { "ao-ponto": 1 } } }).unit).toBe(43.9);
    expect(freeUnits(ad, {})).toEqual({});
  });

  it("item que pede escolha sem complementos vira aviso", () => {
    const p = planIfoodImport(normalizeIfood({ catalog: burger }));
    expect(p.report.warnings.filter((w) => /complementos não vieram/.test(w.message)).length).toBe(3);
  });

  it("Forneria Barra: reproduz o cardápio lido em 24/10 (11 categorias, meio a meio com preço da inteira, grupos sem repetição)", () => {
    const p = planIfoodImport(normalizeIfood(barra()));
    expect(p.cuisine).toBe("pizza");
    expect(p.categories).toHaveLength(11);
    expect(p.categories[0]).toMatchObject({ name: "I M B A T Í V E I S", pricingLocked: true });
    expect(p.categories.map((c) => c.name)).toContain("Pizzas Veganas");
    expect(p.groups.length).toBeGreaterThanOrEqual(40); expect(p.groups.length).toBeLessThanOrEqual(50);
    expect(p.report.mergedGroups).toBeGreaterThan(40);
    const g40 = p.groups.find((g) => g.rule === "fraction" && g.name === "Pizza salgada até 2 Sabores - 40cm")!;
    const full = Object.fromEntries(g40.options.map((o) => [o.name, o.fullPrice]));
    expect(full["4 Queijos"]).toBe(159);
    expect(Object.keys(full).every((n) => !n.startsWith("1/2"))).toBe(true);
    // montáveis: preço base = combinação mais barata (regra validada do meio a meio)
    for (const it of p.items.filter((i) => i.kind === "buildable")) expect(suggestBasePrice(it, p.groups.filter((g) => it.groupIds.includes(g.id)))).toBe(it.price);
    const cardapio = JSON.parse(readFileSync(new URL("../../../apps/api/src/seed/ifood-barra/cardapio.json", import.meta.url), "utf8"));
    const ig3f = cardapio.groups.find((g: { id: string }) => g.id === "ig3f");
    for (const o of ig3f.options as { name: string; fullPrice: number }[]) expect(full[o.name], o.name).toBe(o.fullPrice);
    // combos e imbatíveis nunca são montáveis
    const locked = new Set(p.categories.filter((c) => c.pricingLocked).map((c) => c.id));
    expect(p.items.filter((i) => locked.has(i.categoryId)).every((i) => i.kind === "combo" || i.kind === "offer")).toBe(true);
    const coca = p.items.find((i) => i.name === "Coca-Cola Original 1,5l")!;
    expect(coca).toMatchObject({ isDrink: true, measure: { unit: "ml", amount: 1500 }, liters: 1.5 });
    for (const it of p.items) { const gs = p.groups.filter((g) => it.groupIds.includes(g.id)); expect(gs.length).toBe(it.groupIds.length); expect(minPrice(it, gs)).toBeGreaterThanOrEqual(0); }
  });
});
