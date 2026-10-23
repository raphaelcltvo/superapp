import { describe, it, expect } from "vitest";
import { DEFAULT_ENGAGEMENT as S, answerTriage, avoidHit, heroFromPreferences, npsKind, npsScore, orderCategoriesByMood, pickTriage } from "../src";

const now = new Date("2026-10-23T20:00:00Z");
describe("engajamento", () => {
  it("triagem só para quem já comprou, respeitando o intervalo e rotacionando", () => {
    expect(pickTriage(S, null, now)).toBeNull();
    expect(pickTriage(S, { orders: 0 }, now)).toBeNull();
    expect(pickTriage(S, { orders: 3 }, now)!.kind).toBe("party");
    const p1 = answerTriage(undefined, "party", ["dupla"], now);
    expect(pickTriage(S, { orders: 3, preferences: p1 }, now)).toBeNull();
    const later = new Date(+now + 4 * 864e5);
    expect(pickTriage(S, { orders: 3, preferences: p1 }, later)!.kind).toBe("mood");
    const p2 = answerTriage(p1, "skip", [], later);
    expect(p2.triageAnswers).toBe(1);
    expect(pickTriage(S, { orders: 3, preferences: p2 }, new Date(+later + 864e5))).toBeNull();
  });
  it("evitar só pergunta enquanto não sabe", () => {
    const p = { triageAnswers: 3 };
    expect(pickTriage(S, { orders: 1, preferences: p }, now)!.kind).toBe("avoid");
    const p2 = answerTriage(p, "avoid", ["nada"], now);
    expect(p2.avoid).toEqual([]);
    expect(pickTriage(S, { orders: 1, preferences: { ...p2, triageAskedAt: undefined } }, now)!.kind).not.toBe("avoid");
  });
  it("card do topo: ocasião > quero provar > novidade", () => {
    const s = { ...S, triage: { ...S.triage, partyItems: { galera: "c3" }, noveltyItemId: "m3" } };
    const items = [{ id: "c3", name: "Duas pizzas · 40", categoryId: "x" }, { id: "m3", name: "Caprese", categoryId: "x" }, { id: "d4", name: "Negresco · 20cm", categoryId: "y" }];
    expect(heroFromPreferences({ occasion: { partySize: "galera", at: now.toISOString() }, wantToTry: ["d4"] }, s, now, items)!.action.itemId).toBe("c3");
    expect(heroFromPreferences({ wantToTry: ["d4"] }, s, now, items)!.title).toBe("Negresco");
    expect(heroFromPreferences({ occasion: { craving: "novidade", at: now.toISOString() } }, s, now, items)!.action.itemId).toBe("m3");
    expect(heroFromPreferences({ occasion: { partySize: "galera", at: new Date(+now - 9 * 36e5).toISOString() } }, s, now, items)).toBeUndefined();
  });
  it("evitar e vontade", () => {
    expect(avoidHit("Calabresa Seara, muçarela e cebola", ["cebola"], S.triage.avoidTags)).toBe("Cebola");
    expect(avoidHit("Frango com Catupiry", ["carne"], S.triage.avoidTags)).toBe("Carne");
    expect(avoidHit("Marguerita", ["cebola", "carne"], S.triage.avoidTags)).toBeUndefined();
    expect(orderCategoriesByMood([{ id: "a", name: "Pizzas salgadas" }, { id: "b", name: "Pizzas doces" }], "doce")[0].id).toBe("b");
  });
  it("NPS", () => {
    expect(npsKind(9)).toBe("promotor"); expect(npsKind(7)).toBe("neutro"); expect(npsKind(6)).toBe("detrator");
    expect(npsScore([10, 9, 8, 3]).nps).toBe(25);
  });
});
