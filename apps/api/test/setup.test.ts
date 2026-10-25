import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { postgresDb } from "../src/db/postgres";
import { dataUrlStorage, type Deps } from "../src/deps";
import type { Db } from "../src/db/types";

const PG = process.env.TEST_DATABASE_URL;
const backends: [string, () => Promise<Db>][] = [["memória", async () => memoryDb()]];
if (PG) backends.push(["postgres", async () => {
  const { default: postgres } = await import("postgres");
  const sql = postgres(PG, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema public cascade; create schema public;");
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(new URL(f, dir), "utf8"));
  await sql.end();
  return postgresDb(PG);
}]);

// quarta-feira, 21/10/2026, 15h em São Paulo
const NOW = new Date("2026-10-21T18:00:00Z");

for (const [label, mk] of backends) describe(`Setup de uma marca nova (${label})`, () => {
  let app: ReturnType<typeof createApp>; let tok = "";
  const call = async (method: string, path: string, body?: unknown, auth = true) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(auth && tok ? { authorization: "Bearer " + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  beforeAll(async () => {
    const db = await mk();
    const deps: Deps = { db, jwtSecret: "t", now: () => NOW, storage: dataUrlStorage, messenger: { async send() { return { id: "m", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://cardapio.test" };
    app = createApp(deps);
  });

  it("cria a marca e percorre os passos até publicar (confeitaria)", async () => {
    const su = await call("POST", "/auth/signup", { brand: "Doce Ateliê", name: "Ana", email: "ana@doceatelie.com", password: "segredo123" }, false);
    expect(su.status).toBe(201); tok = su.body.token;
    let st = (await call("GET", "/admin/setup")).body;
    expect(st.progress).toEqual({ done: 0, total: 8 });

    st = (await call("PUT", "/admin/setup/brand", { name: "Doce Ateliê", slug: "doce-atelie-barra", color: "#C2185B", logoUrl: "data:image/png;base64,AAAA", whatsapp: "(21) 99999-0000" })).body;
    expect(st.slug).toBe("doce-atelie-barra");
    expect(st.steps.find((s: any) => s.id === "marca").done).toBe(true);
    const brand = (await call("GET", "/admin/brand")).body;
    expect(brand.branding.colors.brand).toBe("#C2185B");
    expect(brand.branding.colors.brandSoft).toMatch(/^#F/);

    st = (await call("PUT", "/admin/setup/cuisine", { cuisine: "confeitaria", others: ["salgados"] })).body;
    expect(st.cuisine).toBe("confeitaria");

    const loja = await call("PUT", "/admin/setup/store", { name: "Doce Ateliê Barra", phone: "21999990000", address: { street: "Av. das Américas", number: "500", district: "Barra da Tijuca", city: "Rio de Janeiro", state: "RJ", postalCode: "22640-100", lat: -23.0, lng: -43.36 }, hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "09:00", close: "19:00" })), modes: { delivery: true, takeout: true }, delivery: { radiusKm: 6, fee: 9.9, etaMin: 40, etaMax: 60 } });
    expect(loja.status).toBe(200);
    expect(loja.body.store.zones[0]).toMatchObject({ kind: "radius", radiusKm: 6, fee: 9.9 });

    const tpl = await call("POST", "/admin/setup/template", { cuisine: "confeitaria", mode: "replace", withSamples: true });
    expect(tpl.body.items).toBeGreaterThan(4);
    expect(tpl.body.status.steps.find((s: any) => s.id === "cardapio").done).toBe(true);
    const items = (await call("GET", "/admin/items")).body as any[];
    expect(items.find((i) => i.name === "Bolo personalizado").leadTimeHours).toBe(48);

    st = (await call("PUT", "/admin/setup/payments", { methods: ["CREDIT_ON_DELIVERY", "DEBIT_ON_DELIVERY", "CASH"], cardBrands: ["Visa", "Mastercard", "Elo"] })).body;
    expect(st.steps.find((s: any) => s.id === "pagamento").detail).toContain("Crédito na maquininha");

    await call("PUT", "/admin/setup/state", { ordersMode: "manager" });
    const pub = await call("POST", "/admin/publish", { notes: "primeira versão" });
    expect(pub.status).toBe(200);
    st = (await call("GET", "/admin/setup")).body;
    expect(st.steps.filter((s: any) => !s.done).map((s: any) => s.id).sort()).toEqual(["base", "whatsapp"]);
  });

  it("encomenda exige data com antecedência e o cardápio mostra o que não vende hoje", async () => {
    const S = "/public/doce-atelie-barra";
    const menu = (await call("GET", `${S}/menu`, undefined, false)).body;
    const bolo = Object.values(menu.items as Record<string, any>).find((i) => i.name === "Bolo personalizado")!;
    const groups = bolo.groupIds.map((g: string) => menu.groups[g]);
    const sel = Object.fromEntries(groups.filter((g: any) => g.min > 0).map((g: any) => [g.id, { [g.options[0].id]: g.min }]));
    const base = { storeId: menu.store.id, mode: "TAKEOUT", lines: [{ itemId: bolo.id, qty: 1, selection: sel }] };
    const q1 = await call("POST", `${S}/quote`, base, false);
    expect(q1.body.issues[0].issues[0].message).toMatch(/encomenda: agende para 23\/10/);
    const q2 = await call("POST", `${S}/quote`, { ...base, scheduledFor: new Date(+NOW + 49 * 3600e3).toISOString() }, false);
    expect(q2.body.issues).toEqual([]);
    const o = await call("POST", `${S}/orders`, { ...base, scheduledFor: new Date(+NOW + 49 * 3600e3).toISOString(), payment: { code: "CREDIT_ON_DELIVERY" }, customer: { name: "Bia", phone: "21988887777" } }, false);
    expect(o.status).toBe(201);
    expect(o.body.order.scheduledFor).toBeTruthy();
    const past = await call("POST", `${S}/orders`, { ...base, scheduledFor: new Date(+NOW - 3600e3).toISOString(), payment: { code: "CASH" }, customer: { name: "Bia", phone: "21988887777" } }, false);
    expect(past.status).toBe(422);
  });

  it("açaí: cota grátis no preço e prato do dia fora do dia", async () => {
    tok = (await call("POST", "/auth/signup", { brand: "Açaí da Praia", name: "Leo", email: "leo@acai.com", password: "segredo123" }, false)).body.token;
    await call("PUT", "/admin/setup/store", { name: "Açaí da Praia", address: { street: "Rua A", number: "1", district: "Centro", city: "Rio de Janeiro", state: "RJ", postalCode: "20000-000" }, hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "00:00", close: "23:59" })), modes: { delivery: false, takeout: true } });
    await call("POST", "/admin/setup/template", { cuisine: "acai", mode: "replace" });
    await call("POST", "/admin/setup/template", { cuisine: "marmita", mode: "merge" });
    expect((await call("POST", "/admin/publish", {})).status).toBe(200);
    const S = "/public/acai-da-praia";
    const menu = (await call("GET", `${S}/menu`, undefined, false)).body;
    const acai = Object.values(menu.items as Record<string, any>).find((i) => i.name === "Açaí do seu jeito")!;
    const [tam, comp] = acai.groupIds.map((g: string) => menu.groups[g]);
    const q = await call("POST", `${S}/quote`, { storeId: menu.store.id, mode: "TAKEOUT", lines: [{ itemId: acai.id, qty: 1, selection: { [tam.id]: { "300-ml": 1 }, [comp.id]: { granola: 1, banana: 1, pacoca: 1, morango: 1 } } }] }, false);
    expect(q.body.issues).toEqual([]);
    expect(q.body.subtotal).toBe(16.9 + 3); // 3 grátis (morango é o mais caro), 1 cobra R$ 3
    const strog = Object.values(menu.items as Record<string, any>).find((i) => i.name === "Strogonoff de frango")!;
    expect(strog.soon).toBe("volta amanhã"); // vende seg e qui; hoje é quarta
    const feij = Object.values(menu.items as Record<string, any>).find((i) => i.name === "Feijoada completa")!;
    expect(feij.soon).toBeUndefined();
    const bad = await call("POST", `${S}/quote`, { storeId: menu.store.id, mode: "TAKEOUT", lines: [{ itemId: strog.id, qty: 1 }] }, false);
    expect(bad.body.issues[0].issues[0].message).toContain("volta amanhã");
  });
});
