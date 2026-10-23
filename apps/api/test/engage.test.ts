import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { postgresDb } from "../src/db/postgres";
import { dataUrlStorage, type Deps } from "../src/deps";
import { seedForneria } from "../src/seed/forneria";
import { signCustomer } from "../src/auth";
import type { Db } from "../src/db/types";
import type { Customer, Order } from "@cw/core";

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

for (const [label, mk] of backends) describe(`Pesquisa e engajamento (${label})`, () => {
  let app: ReturnType<typeof createApp>; let deps: Deps; let db: Db; let admin = ""; const sent: string[] = [];
  let cust: Customer & { id: string }; let tok = "";
  const S = "/public/forneria-original";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  const asAdmin = { get authorization() { return "Bearer " + admin; } } as unknown as Record<string, string>;
  beforeAll(async () => {
    db = await mk();
    deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: { async send(_t, to, text) { sent.push(to + ":" + text); return { id: "m", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://cardapio.test" };
    app = createApp(deps);
    await seedForneria(db, { photo: () => undefined, media: {}, history: true });
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    expect((await call("POST", "/admin/publish", { notes: "v1" }, { authorization: "Bearer " + admin })).status).toBe(200);
    const cs = await db.list<Customer & { id: string }>("customers", "ten_forneria");
    cust = cs.find((c) => c.orders >= 2 && !c.preferences)!;
    tok = await signCustomer({ cid: cust.id, tid: "ten_forneria" }, "t");
  }, 90000);

  it("novo não recebe triagem; recorrente recebe 1 pergunta", async () => {
    const anon = await call("GET", `${S}/menu`);
    expect(anon.body.triage).toBeNull();
    expect(anon.body.engagement.effects.exitIntent.coupon.code).toBe("FICA8");
    const m = await call("GET", `${S}/menu`, undefined, { "x-customer-token": tok });
    expect(m.body.triage.kind).toBe("party");
    expect(m.body.triage.options.map((o: any) => o.id)).toEqual(["solo", "dupla", "galera"]);
  });

  it("resposta muda o card do topo na hora e a pergunta some", async () => {
    const r = await call("POST", `${S}/triage`, { kind: "party", values: ["galera"] }, { "x-customer-token": tok });
    expect(r.status).toBe(200); expect(r.body.message).toMatch(/galera/);
    const m = await call("GET", `${S}/menu`, undefined, { "x-customer-token": tok });
    expect(m.body.hero.action).toEqual({ kind: "open_item", itemId: "c3" });
    expect(m.body.hero.kicker).toBe("Pra galera");
    expect(m.body.triage).toBeNull();
  });

  it("evitar cebola manda os sabores com cebola para o fim e marca o aviso", async () => {
    await db.patch("customers", "ten_forneria", cust.id, { preferences: { ...(await db.get<Customer & { id: string }>("customers", "ten_forneria", cust.id))!.preferences, triageAskedAt: new Date(Date.now() - 10 * 864e5).toISOString(), occasion: undefined } });
    await call("POST", `${S}/triage`, { kind: "avoid", values: ["cebola"] }, { "x-customer-token": tok });
    const m = await call("GET", `${S}/menu`, undefined, { "x-customer-token": tok });
    const sab = m.body.groups.g_sab40.options;
    const firstHit = sab.findIndex((o: any) => o.avoidHit);
    expect(firstHit).toBeGreaterThan(0);
    expect(sab.slice(firstHit).every((o: any) => o.avoidHit === "Cebola")).toBe(true);
    expect(m.body.items.m1.avoidHit).toBe("Cebola");
    expect(m.body.engagement.avoid).toEqual(["Cebola"]);
  });

  it("pós-pedido: detrator ganha crédito, loja é avisada; não avalia duas vezes", async () => {
    const o = (await db.list<Order & { id: string }>("orders", "ten_forneria", { where: { customerId: cust.id } })).find((x) => x.status === "concluded" && !x.feedback)!;
    const r = await call("POST", `${S}/orders/${o.id}/feedback`, { nps: 4, reasons: ["Chegou frio"], comment: "fria", wantToTry: "m4" }, { "x-customer-token": tok });
    expect(r.status).toBe(200); expect(r.body.kind).toBe("detrator"); expect(r.body.creditGiven).toBe(10);
    expect(sent.some((x) => x.startsWith("5521999990000:") && x.includes("Nota 4"))).toBe(true);
    expect((await call("POST", `${S}/orders/${o.id}/feedback`, { nps: 9 }, { "x-customer-token": tok })).status).toBe(409);
    expect((await call("POST", `${S}/orders/${o.id}/feedback`, { nps: 9 })).status).toBe(404);
    const me = await call("GET", `${S}/me`, undefined, { "x-customer-token": tok });
    expect(me.body.customer.preferences.wantToTry[0]).toBe("m4");
    const g = await call("GET", `${S}/orders/${o.id}`, undefined, { "x-customer-token": tok });
    expect(g.body.feedback).toEqual({ nps: 4, kind: "detrator" });
  });

  it("'quero provar' vira o card do topo quando não há ocasião", async () => {
    await db.patch("customers", "ten_forneria", cust.id, { preferences: { ...(await db.get<Customer & { id: string }>("customers", "ten_forneria", cust.id))!.preferences, occasion: undefined } });
    const m = await call("GET", `${S}/menu`, undefined, { "x-customer-token": tok });
    expect(m.body.hero.action.itemId).toBe("m4");
    expect(m.body.hero.kicker).toBe("Você quis provar");
  });

  it("painel: configura e lê o relatório", async () => {
    const H = { authorization: "Bearer " + admin };
    const s = (await call("GET", "/admin/engagement/settings", undefined, H)).body;
    expect(s.triage.partyItems.galera).toBe("c3");
    s.effects.freeShippingNudge = 20;
    expect((await call("PUT", "/admin/engagement/settings", s, H)).status).toBe(200);
    expect((await call("GET", `${S}/menu`)).body.engagement.effects.freeShippingNudge).toBe(20);
    const rep = (await call("GET", "/admin/engagement/report?days=90", undefined, H)).body;
    expect(rep.nps.n).toBeGreaterThan(30);
    expect(rep.distribution).toHaveLength(11);
    expect(rep.detractors.total).toBeGreaterThan(0);
    expect(rep.triage.answered).toBeGreaterThan(0);
    expect(rep.effects.find((e: any) => e.name === "fx_glow_cta").sessions).toBeGreaterThan(0);
    void asAdmin;
  });
});
