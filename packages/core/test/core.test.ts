import { describe, it, expect } from "vitest";
import { priceLine, suggestBasePrice, quote, applyStrategies, strategyTemplates, pointInPolygon, walletBalance, breakEven, funnel, rfm, type Item, type OptionGroup, type Strategy } from "../src";

const flav = (n: string, full: number) => ({ id: n, name: n, price: 0, fullPrice: full, active: true });
const sabores: OptionGroup = { id: "sab", name: "Sabores", min: 2, max: 2, rule: "fraction", allowRepeat: true, options: [flav("calab_seara", 99), flav("4q", 159), flav("marg", 104)] };
const massa: OptionGroup = { id: "massa", name: "Massa", min: 1, max: 1, rule: "sum", allowRepeat: false, options: [{ id: "gourmet", name: "Gourmet", price: 0, active: true }, { id: "borda", name: "Borda Catupiry", price: 32, active: true }] };
const s40: Item = { id: "s40", categoryId: "salg", name: "Pizza 40cm", kind: "buildable", price: 99, groupIds: ["massa", "sab"], active: true, available: true, position: 1 };
const combo: Item = { ...s40, id: "c1", kind: "combo", price: 99 };

describe("preço meio a meio", () => {
  it("base = combinação mais barata", () => expect(suggestBasePrice(s40, [massa, sabores])).toBe(99));
  it("1/2 4 Queijos + 1/2 Marguerita = 131,50", () => {
    const l = priceLine(s40, [massa, sabores], { itemId: "s40", qty: 1, selection: { massa: { gourmet: 1 }, sab: { "4q": 1, marg: 1 } } });
    expect(l.unit).toBe(131.5);
  });
  it("inteira 4 Queijos = 159 e com borda = 191", () => {
    expect(priceLine(s40, [massa, sabores], { itemId: "s40", qty: 1, selection: { sab: { "4q": 2 } } }).unit).toBe(159);
    expect(priceLine(s40, [massa, sabores], { itemId: "s40", qty: 2, selection: { massa: { borda: 1 }, sab: { "4q": 2 } } }).total).toBe(382);
  });
  it("combo nunca cobra diferença proporcional", () => {
    expect(priceLine(combo, [massa, sabores], { itemId: "c1", qty: 1, selection: { sab: { "4q": 1, marg: 1 } } }).unit).toBe(99);
  });
});

describe("estratégias", () => {
  const T = strategyTemplates().map((s, i) => ({ ...s, id: "s" + i })) as Strategy[];
  const base = { now: new Date("2026-10-23T21:00:00"), lines: [], items: {}, segmentIds: [], mode: "DELIVERY" as const };
  it("abaixo do mínimo cobra taxa de serviço e não bloqueia", () => {
    const r = applyStrategies(T, { ...base, subtotal: 40, customerOrders: 3, daysSinceLastOrder: 20 }, 6.9);
    expect(r.fees[0].amount).toBe(15);
    expect(r.deliveryFee).toBe(6.9);
    expect(r.progress?.missing).toBe(80);
  });
  it("acima do mínimo some a taxa; acima de 120 frete grátis", () => {
    const r = applyStrategies(T, { ...base, subtotal: 130, customerOrders: 3, daysSinceLastOrder: 20 }, 6.9);
    expect(r.fees.length).toBe(0); expect(r.deliveryFee).toBe(0);
  });
  it("cliente novo e recorrente 7–10 dias ganham frete", () => {
    expect(applyStrategies(T, { ...base, subtotal: 60, customerOrders: 0 }, 6.9).deliveryFee).toBe(0);
    expect(applyStrategies(T, { ...base, subtotal: 60, customerOrders: 4, daysSinceLastOrder: 8 }, 6.9).deliveryFee).toBe(0);
    expect(applyStrategies(T, { ...base, subtotal: 60, customerOrders: 4, daysSinceLastOrder: 12 }, 6.9).deliveryFee).toBe(6.9);
  });
});

describe("quote completo", () => {
  it("cupom 10% + cashback", () => {
    const q = quote({ now: new Date(), lines: [{ itemId: "s40", qty: 1, selection: { massa: { gourmet: 1 }, sab: { "4q": 1, marg: 1 } } }], catalog: { items: { s40 }, groups: { massa, sab: sabores } }, mode: "DELIVERY",
      zone: { id: "z", name: "Leblon", kind: "polygon", color: "#f00", fee: 6.9, etaMin: 25, etaMax: 35, active: true }, strategies: [],
      coupon: { id: "c", name: "10%", type: "percent", value: 10, active: true },
      customer: { orders: 2, segmentIds: [], spend90d: 200, walletBalance: 20 }, loyalty: { active: true, kind: "cashback", earnPercent: 5, minOrder: 0, expiresInDays: 60, minRedeem: 5, maxRedeemPercent: 50 }, useCashback: true });
    expect(q.subtotal).toBe(131.5); expect(q.discount).toBe(13.15); expect(q.cashbackUsed).toBe(20); expect(q.total).toBe(105.25); expect(q.cashbackEarned).toBe(4.92);
  });
});

describe("utilitários", () => {
  it("ponto no polígono", () => expect(pointInPolygon([-22.98, -43.22], [[-22.97, -43.23], [-22.97, -43.21], [-22.99, -43.21], [-22.99, -43.23]])).toBe(true));
  it("carteira FIFO com expiração", () => {
    const w = walletBalance([{ id: "a", customerId: "x", type: "earn", amount: 10, createdAt: "2026-01-01", expiresAt: "2026-02-01" }, { id: "b", customerId: "x", type: "earn", amount: 5, createdAt: "2026-03-01", expiresAt: "2027-01-01" }, { id: "c", customerId: "x", type: "redeem", amount: -4, createdAt: "2026-03-02" }], new Date("2026-06-01"));
    expect(w.balance).toBe(5); expect(w.toExpire[0].amount).toBe(6);
  });
  it("ponto de equilíbrio 10% com margem 40%", () => expect(breakEven(0.1, 0.4).extraPct).toBe(33.33));
  it("funil por sessão", () => {
    const f = funnel([{ sessionId: "a", name: "visit" }, { sessionId: "a", name: "order_placed" }, { sessionId: "b", name: "visit" }, { sessionId: "b", name: "item_view" }]);
    expect(f[1].sessions).toBe(2); expect(f[5].pctOfVisits).toBe(50);
  });
  it("rfm", () => expect(rfm({ orders: 8, spent: 900, lastOrderAt: new Date(Date.now() - 5 * 864e5).toISOString() })).toBe("campeoes"));
});
