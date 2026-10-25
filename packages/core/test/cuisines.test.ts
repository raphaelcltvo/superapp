import { describe, expect, it } from "vitest";
import { CUISINES, applyTemplate, availableAt, cuisineById, detectCuisine, earliestSchedule, freeUnits, minPrice, priceLine, pricePerMeasure, suggestBasePrice, tagsFromText } from "../src";

describe("culinárias", () => {
  it("todo modelo gera cardápio coerente: itens apontam para categorias e grupos existentes", () => {
    for (const t of CUISINES) {
      const m = applyTemplate(t);
      const cats = new Set(m.categories.map((c) => c.id)); const gs = new Set(m.groups.map((g) => g.id));
      expect(new Set(m.items.map((i) => i.id)).size, t.id).toBe(m.items.length);
      for (const it of m.items) { expect(cats.has(it.categoryId), `${t.id}/${it.name}`).toBe(true); for (const g of it.groupIds) expect(gs.has(g), `${t.id}/${it.name}/${g}`).toBe(true); }
      for (const g of m.groups) { expect(g.max).toBeGreaterThanOrEqual(g.min); if (g.rule === "fraction") expect(g.options.every((o) => o.fullPrice != null)).toBe(true); }
      for (const it of m.items.filter((x) => x.kind === "buildable")) expect(suggestBasePrice(it, m.groups.filter((g) => it.groupIds.includes(g.id)))).toBe(it.price);
    }
  });
  it("detecta a culinária pelos nomes", () => {
    expect(detectCuisine(["Pizza Calabresa 40cm", "Pizza Margherita", "Coca-Cola 2L"])[0].id).toBe("pizza");
    expect(detectCuisine(["Costela no bafo 1kg", "Farofa de bacon", "Picanha fatiada"])[0].id).toBe("churrasco");
    expect(detectCuisine(["Bolo de brigadeiro", "Torta de limão", "Cento de brigadeiro"])[0].id).toBe("confeitaria");
    expect(detectCuisine(["Açaí 500ml", "Cupuaçu", "Granola"])[0].id).toBe("acai");
    expect(cuisineById("nada").id).toBe("generico");
  });
  it("cota grátis: as 3 escolhas mais caras saem de graça e o resto cobra", () => {
    const { groups, items } = applyTemplate(cuisineById("acai"));
    const item = items.find((i) => i.name === "Açaí do seu jeito")!;
    const gs = groups.filter((g) => item.groupIds.includes(g.id));
    const comp = gs.find((g) => g.freeQuota === 3)!; const tam = gs.find((g) => g.role === "size")!;
    const sel: Record<string, Record<string, number>> = { [tam.id]: { "500-ml": 1 }, [comp.id]: { granola: 1, banana: 1, morango: 1, kiwi: 1 } };
    expect(freeUnits(comp, sel[comp.id])).toEqual({ morango: 1, kiwi: 1, granola: 1 });
    const l = priceLine(item, gs, { itemId: item.id, qty: 1, selection: sel });
    expect(l.unit).toBe(16.9 + 6 + 3); // só a banana (4ª) cobra
    expect(l.choices.filter((c) => c.free).length).toBe(3);
    expect(minPrice(item, gs)).toBe(16.9);
  });
  it("preço por medida, selos, janela de venda e encomenda", () => {
    expect(pricePerMeasure(69.9, { unit: "g", amount: 500 })).toBe("R$ 139,80/kg");
    expect(pricePerMeasure(69.9, { unit: "un", amount: 12 })).toBe("R$ 5,83/un");
    expect(tagsFromText("Pizza vegana sem glúten")).toEqual(["vegano", "sem_gluten"]);
    const wed = new Date("2026-10-21T15:00:00Z"); // quarta 12h em SP
    expect(availableAt({ weekdays: [3, 6] }, wed).ok).toBe(true);
    expect(availableAt({ weekdays: [6] }, wed)).toEqual({ ok: false, label: "volta sábado" });
    expect(availableAt({ to: "11:00" }, wed)).toEqual({ ok: false, label: "volta amanhã" });
    expect(availableAt({ from: "18:00" }, wed)).toEqual({ ok: false, label: "a partir das 18:00" });
    expect(+earliestSchedule([{ leadTimeHours: 48 }, {}], wed)! - +wed).toBe(48 * 3600e3);
  });
});
