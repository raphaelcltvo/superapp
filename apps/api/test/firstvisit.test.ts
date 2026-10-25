import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { postgresDb } from "../src/db/postgres";
import { dataUrlStorage, type Deps } from "../src/deps";
import { seedForneria } from "../src/seed/forneria";
import { signCustomer } from "../src/auth";
import type { Db } from "../src/db/types";
import type { Customer } from "@cw/core";

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

for (const [label, mk] of backends) describe(`Primeira visita e senha online (${label})`, () => {
  let app: ReturnType<typeof createApp>; let deps: Deps; let db: Db; let admin = "";
  const S = "/public/forneria-original", T = "ten_forneria";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  const A = () => ({ authorization: "Bearer " + admin });
  beforeAll(async () => {
    db = await mk();
    deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: { async send() { return { id: "m", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://cardapio.test" };
    app = createApp(deps);
    await seedForneria(db, { photo: () => undefined, media: {}, history: true });
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    expect((await call("POST", "/admin/publish", { notes: "v1" }, A())).status).toBe(200);
  }, 120000);

  it("visitante novo recebe a triagem com perguntas tiradas das personas da base", async () => {
    const m = await call("GET", `${S}/menu`);
    expect(m.body.firstVisit.source).toBe("personas");
    expect(m.body.firstVisit.questions.length).toBeGreaterThanOrEqual(2);
    expect(m.body.firstVisit.questions[0].options.length).toBeGreaterThanOrEqual(2);
    expect(m.body.firstVisit.coupon.name).toMatch(/primeiro pedido/i);
    expect(m.body.firstVisit.coupon.code).toBeUndefined();
    const adm = await call("GET", "/admin/engagement/first-visit?days=90", undefined, A());
    expect(adm.body.personas.length).toBeGreaterThanOrEqual(2);
    expect(adm.body.personas[0].top).toBeTruthy();
  });

  it("quem chega pelo anúncio vê o produto do criativo e não a triagem", async () => {
    const m = await call("GET", `${S}/menu?source=instagram&campaign=pizza99`);
    expect(m.body.hero.kicker).toBe("Você veio pelo anúncio");
    expect(m.body.hero.action.kind).toBe("open_item");
    expect(m.body.firstVisit).toBeNull();
    const c = await call("GET", `${S}/menu?source=instagram`);
    expect(c.body.hero.action.kind).toBe("category");
  });

  let leadId = "";
  it("modo recompensa: respondeu, ganha o cupom e o topo mostra o que clientes parecidos pedem", async () => {
    const q = (await call("GET", `${S}/menu`)).body.firstVisit.questions;
    const answers = Object.fromEntries(q.map((x: any) => [x.id, x.options.at(-1).id]));
    const r = await call("POST", `${S}/firstvisit`, { sessionId: "ses_fv1", answers });
    expect(r.status).toBe(200);
    expect(r.body.couponUnlocked).toBe(true);
    expect(r.body.coupon.code).toBe("BEMVINDO10");
    leadId = r.body.leadId;
    const m = await call("GET", `${S}/menu`, undefined, { "x-lead-id": leadId });
    expect(m.body.hero.kicker).toBe("Quem pede parecido com você");
    expect(m.body.hero.action.kind).toBe("open_item");
    expect(m.body.firstVisit).toBeNull();
    expect(m.body.lead.couponCode).toBe("BEMVINDO10");
    const skip = await call("POST", `${S}/firstvisit`, { skip: true });
    expect((await call("GET", `${S}/menu`, undefined, { "x-lead-id": skip.body.leadId })).body.firstVisit).toBeNull();
  });

  let gateLead = "";
  it("modo portão: o cupom só libera com respostas + celular + e-mail, e vira lead no CRM", async () => {
    const s = (await call("GET", "/admin/engagement/settings", undefined, A())).body;
    s.firstVisit.mode = "gate";
    expect((await call("PUT", "/admin/engagement/settings", s, A())).status).toBe(200);
    const q = (await call("GET", `${S}/menu`)).body.firstVisit;
    expect(q.mode).toBe("gate");
    const answers = Object.fromEntries(q.questions.map((x: any) => [x.id, x.options[0].id]));
    const a = await call("POST", `${S}/firstvisit`, { answers });
    expect(a.body.couponUnlocked).toBe(false);
    expect(a.body.needs).toEqual(["celular", "e-mail"]);
    expect((await call("POST", `${S}/firstvisit`, { leadId: a.body.leadId, answers, contact: { phone: "123" } })).status).toBe(422);
    const b = await call("POST", `${S}/firstvisit`, { leadId: a.body.leadId, answers, contact: { name: "Lia Teste", phone: "(21) 98888-7777", email: "Lia@Teste.com", optinWhatsapp: true, optinEmail: true } });
    expect(b.body.couponUnlocked).toBe(true);
    gateLead = b.body.leadId;
    const lead = (await db.list<Customer & { id: string }>("customers", T, { where: { phone: "5521988887777" } }))[0];
    expect(lead.tags).toContain("lead");
    expect(lead.optinWhatsapp).toBe(false); // WhatsApp só depois de confirmar o telefone
    expect(lead.optinEmail).toBe(true);
    expect(lead.email).toBe("lia@teste.com");
    s.firstVisit.mode = "reward"; await call("PUT", "/admin/engagement/settings", s, A());
  });

  it("ao confirmar o telefone, o lead passa para o cliente", async () => {
    await call("POST", `${S}/auth/otp`, { phone: "21988887777" });
    const v = await call("POST", `${S}/auth/verify`, { phone: "21988887777", code: "1234", leadId: gateLead });
    expect(v.status).toBe(200);
    const c = (await db.list<Customer & { id: string }>("customers", T, { where: { phone: "5521988887777" } }))[0];
    expect(c.preferences?.firstVisit?.answers).toBeTruthy();
    expect(c.optinWhatsapp).toBe(true);
    expect(c.tags || []).not.toContain("lead");
    expect((await call("POST", `${S}/auth/verify`, { phone: "21988887777", code: "1234" })).status).toBe(422); // código já usado
  });

  it("recorrente: o topo é o que ele mais pede, com os sabores", async () => {
    const cs = await db.list<Customer & { id: string }>("customers", T);
    const c = cs.filter((x) => x.orders >= 4).sort((a, b) => b.orders - a.orders)[0];
    const tok = await signCustomer({ cid: c.id, tid: T }, "t");
    const m = await call("GET", `${S}/menu`, undefined, { "x-customer-token": tok });
    expect(m.body.hero.action.kind).toBe("reorder");
    expect(m.body.hero.action.lines[0].selection).toBeTruthy();
    expect(m.body.firstVisit).toBeNull();
  });

  it("pagamento online pede CPF, data de nascimento e senha; na entrega, não", async () => {
    await call("PUT", "/admin/integrations/payments", { enabled: true, gateway: "fake", env: "sandbox", methods: { pix: true, card: false }, pixExpiresMinutes: 15, maxInstallments: 1 }, A());
    await call("POST", `${S}/auth/otp`, { phone: "21977776666" });
    const tok = (await call("POST", `${S}/auth/verify`, { phone: "21977776666", code: "1234", name: "Bia" })).body.token;
    const H = { "x-customer-token": tok };
    const menu = (await call("GET", `${S}/menu`, undefined, H)).body;
    expect(menu.onlinePayments.requirePassword).toBe(true);
    const order = (code: string, extra: Record<string, string> = {}) => call("POST", `${S}/orders`, { storeId: "sto_leblon", mode: "TAKEOUT", lines: [{ itemId: Object.keys(menu.items).find((k) => !menu.items[k].groupIds.length), qty: 2 }], payment: { code } }, { ...H, ...extra });
    expect((await order("PIX_ONLINE")).status).toBe(401);
    expect((await order("CASH")).status).toBe(201);
    expect((await call("GET", `${S}/me/online-auth`, undefined, H)).body.hasPassword).toBe(false);
    expect((await call("POST", `${S}/me/online-identity`, { cpf: "111.111.111-11", birthDate: "1990-01-01", password: "segredo1" }, H)).status).toBe(422);
    expect((await call("POST", `${S}/me/online-identity`, { cpf: "529.982.247-25", birthDate: "2025-01-01", password: "segredo1" }, H)).status).toBe(422);
    const id = await call("POST", `${S}/me/online-identity`, { cpf: "529.982.247-25", birthDate: "1990-01-01", password: "segredo1" }, H);
    expect(id.status).toBe(200);
    expect((await order("PIX_ONLINE", { "x-online-token": id.body.onlineToken })).status).toBe(201);
    expect((await call("POST", `${S}/me/online-auth`, { password: "errada" }, H)).status).toBe(422);
    const ok = await call("POST", `${S}/me/online-auth`, { password: "segredo1" }, H);
    expect(ok.body.onlineToken).toBeTruthy();
    // esqueci a senha: código + senha nova
    await call("POST", `${S}/auth/otp`, { phone: "21977776666" });
    expect((await call("POST", `${S}/me/online-reset`, { code: "1234", password: "novasenha" }, H)).status).toBe(200);
    expect((await call("POST", `${S}/me/online-auth`, { password: "novasenha" }, H)).status).toBe(200);
    // bureau plugado e dizendo que não confere
    deps.verifyIdentity = async () => false;
    await call("POST", `${S}/auth/otp`, { phone: "21966665555" });
    const t2 = (await call("POST", `${S}/auth/verify`, { phone: "21966665555", code: "1234", name: "Caio" })).body.token;
    expect((await call("POST", `${S}/me/online-identity`, { cpf: "529.982.247-25", birthDate: "1990-01-01", password: "segredo1" }, { "x-customer-token": t2 })).body.error).toMatch(/não conferem/);
    deps.verifyIdentity = undefined;
    await call("PUT", "/admin/integrations/payments", { enabled: false, gateway: "fake", env: "sandbox", methods: { pix: true, card: false }, pixExpiresMinutes: 15, maxInstallments: 1 }, A());
  });
});
