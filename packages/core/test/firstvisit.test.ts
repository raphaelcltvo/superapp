import { describe, it, expect } from "vitest";
import { PLAYBOOKS, computePersonas, favoriteOrder, lineTitle, matchCampaign, matchPersona, targetFromAnswers, validBirthDate, validCpfDigits, type FvCatalog } from "../src";
import type { Order, PricedLine } from "../src";

const catalog: FvCatalog = {
  categories: [{ id: "combos", name: "Combos", pricingLocked: true }, { id: "imbat", name: "Imbatíveis", pricingLocked: true }, { id: "salg", name: "Pizzas salgadas" }, { id: "doces", name: "Pizzas doces 20cm" }, { id: "beb", name: "Bebidas" }],
  items: [
    { id: "duas", name: "Duas pizzas por R$ 149 · 40cm + 20cm", categoryId: "combos", kind: "combo", price: 149 },
    { id: "of30", name: "1/2 Calabresa + 1/2 Marguerita · 30cm", categoryId: "imbat", kind: "offer", price: 81 },
    { id: "p40", name: "Pizza 40cm até 2 sabores", categoryId: "salg", kind: "buildable", price: 99 },
    { id: "doce", name: "Banana caramelizada · 20cm", categoryId: "doces", kind: "simple", price: 59 },
    { id: "coca", name: "Coca-Cola 1,5l", categoryId: "beb", kind: "simple", price: 14, isDrink: true },
  ],
};
const L = (itemId: string, choices: PricedLine["choices"] = [], qty = 1): PricedLine => ({ itemId, name: catalog.items.find((i) => i.id === itemId)!.name, qty, unit: 1, total: 1, base: 1, choices });
const half = (a: string, b: string): PricedLine["choices"] => [{ groupId: "sab", optionId: a, name: a, qty: 1, unitDelta: 0, fraction: "1/2" }, { groupId: "sab", optionId: b, name: b, qty: 1, unitDelta: 0, fraction: "1/2" }];
let n = 0;
const ord = (cid: string, lines: PricedLine[], total: number): Order => ({ id: `o${n++}`, customerId: cid, lines, total, status: "concluded", createdAt: new Date(Date.UTC(2026, 8, 1) + n * 36e5).toISOString() } as Order);

// três grupos claros: galera (combo + doce, ticket alto), solo na oferta (30cm), montadores (40cm montada)
const orders: Order[] = [];
for (let i = 0; i < 40; i++) { orders.push(ord(`g${i}`, [L("duas"), L("doce")], 210)); orders.push(ord(`g${i}`, [L("duas"), L("coca")], 165)); }
for (let i = 0; i < 40; i++) { orders.push(ord(`s${i}`, [L("of30")], 81)); orders.push(ord(`s${i}`, [L("of30")], 81)); }
for (let i = 0; i < 40; i++) { orders.push(ord(`m${i}`, [L("p40", half("Portuguesa", "Frango"))], 112)); orders.push(ord(`m${i}`, [L("p40", half("Portuguesa", "Frango")), L("coca")], 126)); }

describe("primeira visita", () => {
  it("personas saem da base e as perguntas separam os grupos", () => {
    const m = computePersonas(orders, catalog)!;
    expect(m.customers).toBe(120);
    expect(m.personas.length).toBeGreaterThanOrEqual(2);
    expect(m.questions.map((q) => q.dim)).toContain("party");
    const galera = matchPersona(m, { party: "galera", deal: "oferta", sweet: "sim" })!;
    expect(galera.topItemId).toBe("duas");
    const solo = matchPersona(m, { party: "solo", deal: "oferta" })!;
    expect(solo.topItemId).toBe("of30");
    const montador = matchPersona(m, { party: "dupla", deal: "montar", sweet: "nao" })!;
    expect(montador.topItemId).toBe("p40");
    expect(montador.topTitle).toBe("Pizza 40cm até 2 sabores · ½ Portuguesa + ½ Frango");
    expect(montador.topSelection).toEqual({ sab: { Portuguesa: 1, Frango: 1 } });
  });
  it("sem base suficiente não inventa persona", () => {
    expect(computePersonas(orders.slice(0, 20), catalog)).toBeNull();
  });
  it("roteiro sem base escolhe pelo tamanho e pelo estilo", () => {
    const q = PLAYBOOKS.pizza;
    expect(targetFromAnswers(catalog, q, { party: "galera" }).itemId).toBe("duas");
    expect(targetFromAnswers(catalog, q, { party: "solo", deal: "oferta" }).itemId).toBe("of30");
    expect(targetFromAnswers(catalog, q, { party: "dupla", deal: "montar" }).itemId).toBe("p40");
    const t = targetFromAnswers(catalog, q, { party: "dupla", deal: "montar", sweet: "sim" });
    expect(t.categoryOrder.slice(0, 2)).toEqual(["salg", "doces"]);
  });
  it("recompra pega a combinação que ele MAIS pede, não a última", () => {
    const os = [
      ord("x", [L("p40", half("Calabresa", "Marguerita")), L("coca")], 113),
      ord("x", [L("p40", half("Calabresa", "Marguerita")), L("coca")], 113),
      ord("x", [L("of30")], 81),
    ];
    const f = favoriteOrder(os, catalog)!;
    expect(f.title).toBe("Pizza 40cm até 2 sabores · ½ Calabresa + ½ Marguerita + Coca-Cola 1,5l");
    expect(f.lines[0].selection).toEqual({ sab: { Calabresa: 1, Marguerita: 1 } });
    expect(f.times).toBe(2);
    expect(lineTitle({ name: "Combo · 40cm", choices: [{ groupId: "s", optionId: "a", name: "Atum", qty: 2, unitDelta: 0 }] })).toBe("Combo · inteira Atum");
  });
  it("campanha mais específica vence", () => {
    const list = [
      { id: "a", active: true, source: "instagram", target: { kind: "category" as const, categoryId: "combos" }, kicker: "IG" },
      { id: "b", active: true, source: "instagram", campaign: "pizza99", target: { kind: "item" as const, itemId: "p40" }, kicker: "99" },
    ];
    expect(matchCampaign(list, { source: "Instagram", campaign: "pizza99" })!.id).toBe("b");
    expect(matchCampaign(list, { source: "instagram" })!.id).toBe("a");
    expect(matchCampaign(list, { source: "google" })).toBeUndefined();
  });
  it("CPF e data de nascimento", () => {
    expect(validCpfDigits("529.982.247-25")).toBe(true);
    expect(validCpfDigits("111.111.111-11")).toBe(false);
    expect(validCpfDigits("529.982.247-26")).toBe(false);
    expect(validBirthDate("1993-05-10", new Date("2026-10-24"))).toBe(true);
    expect(validBirthDate("2020-02-30")).toBe(false);
  });
});
