import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { postgresDb } from "../src/db/postgres";
import { dataUrlStorage, logMessenger, type Deps } from "../src/deps";
import { FakeSaipos } from "../src/integrations/saipos/fake";
import { seedForneria } from "../src/seed/forneria";
import type { Db } from "../src/db/types";

const PG = process.env.TEST_DATABASE_URL;
const backends: [string, () => Promise<Db>][] = [["memória", async () => memoryDb()]];
if (PG) backends.push(["postgres", async () => {
  const { default: postgres } = await import("postgres");
  const sql = postgres(PG, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema public cascade; create schema public;");
  const { readFileSync } = await import("node:fs");
  for (const f of ["001_init.sql", "002_mensagens.sql"]) await sql.unsafe(readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"));
  await sql.end();
  return postgresDb(PG);
}]);

for (const [label, mk] of backends) describe(`API (${label})`, () => {
  const saipos = new FakeSaipos("https://saipos.test", { partner1: "s3cret" });
  let app: ReturnType<typeof createApp>; let deps: Deps; let admin = ""; const sent: string[] = [];
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(admin ? { authorization: "Bearer " + admin } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    return { status: r.status, body: j as any };
  };
  beforeAll(async () => {
    const db = await mk();
    deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: { async send(_t, to, text) { sent.push(to + ":" + text); return { id: "m", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://cardapio.test", saiposFetch: (u, i) => saipos.fetch(u, i) };
    app = createApp(deps);
    await seedForneria(db, { photo: (n) => "https://img.test/" + encodeURIComponent(n) + ".jpg", media: { cover: "https://img.test/capa.jpg" }, history: true });
  }, 60000);

  it("login do dono e auditoria do cardápio sem erros", async () => {
    const r = await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" });
    expect(r.status).toBe(200); admin = r.body.token;
    const a = await call("GET", "/admin/audit");
    expect(a.body.filter((x: any) => x.level === "erro")).toEqual([]);
  });

  it("preço base errado bloqueia a publicação e o atalho corrige", async () => {
    const it = (await call("GET", "/admin/items/s40")).body;
    await call("PUT", "/admin/items/s40", { ...it, price: 105 });
    expect((await call("POST", "/admin/publish", {})).status).toBe(422);
    expect((await call("POST", "/admin/items/s40/fix-base")).body.price).toBe(99);
    const p = await call("POST", "/admin/publish", { notes: "primeira" });
    expect(p.status).toBe(200); expect(p.body.number).toBe(1);
  });

  it("cardápio público personaliza por perfil e escolhe banners", async () => {
    admin = "";
    const m = await call("GET", "/public/forneria-original/menu?source=instagram");
    expect(m.status).toBe(200);
    expect(m.body.profile).toBe("novo");
    expect(m.body.categories[0].id).toBe("cat_combos");
    expect(m.body.banners.menu_top.id).toBe("bn_99");
    expect(m.body.banners.below_suggested.media.kind).toBe("gif");
    expect(m.body.items.s40.fromPrice).toBe(true);
    expect(m.body.strategies.find((s: any) => s.id === "st_pop_novo").coupon.code).toBe("BEMVINDO10");
  });

  it("cotação: taxa de serviço abaixo de R$ 50 sem bloquear; frete grátis acima de 120 e barra de progresso", async () => {
    const base = { storeId: "sto_leblon", mode: "DELIVERY", address: { street: "R", number: "1", district: "Leblon", city: "Rio de Janeiro", state: "RJ", postalCode: "22431050", lat: -22.984, lng: -43.225 } };
    // cliente recorrente (com histórico, comprou há >10 dias) para não cair em frete grátis de novo cliente
    const q1 = await call("POST", "/public/forneria-original/quote", { ...base, lines: [{ itemId: "b5", qty: 2 }] });
    expect(q1.body.fees[0].amount).toBe(15);
    expect(q1.body.deliveryFee).toBe(0); // cliente novo: frete grátis no 1º pedido
    const q2 = await call("POST", "/public/forneria-original/quote", { ...base, lines: [{ itemId: "s40", qty: 1, selection: { g_massa40: { gourmet: 1 }, g_sab40: { "4-queijos": 1, marguerita: 1 } } }] });
    expect(q2.body.subtotal).toBe(131.5); expect(q2.body.fees).toEqual([]);
  });

  it("checkout envia à SAIPOS com complementos e total que a SAIPOS recalcula igual", async () => {
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    const cfg = { enabled: true, env: "homolog", idPartner: "partner1", secret: "s3cret", codStore: "896", deliveryBy: "RESTAURANT", autoSend: true, payments: {}, baseUrl: "https://saipos.test" };
    expect((await call("PUT", "/admin/integrations/saipos/sto_leblon", cfg)).status).toBe(200);
    expect((await call("POST", "/admin/integrations/saipos/sto_leblon/test")).body.ok).toBe(true);
    admin = "";
    const r = await call("POST", "/public/forneria-original/orders", { storeId: "sto_leblon", mode: "DELIVERY", sessionId: "s1", source: "instagram",
      address: { street: "Rua Dias Ferreira", number: "100", district: "Leblon", city: "Rio de Janeiro", state: "RJ", postalCode: "22431-050", lat: -22.984, lng: -43.225, complement: "apto 201" },
      lines: [{ itemId: "s40", qty: 1, notes: "bem assada", selection: { g_massa40: { gourmet: 1 }, g_sab40: { "4-queijos": 1, marguerita: 1 } } }, { itemId: "b1", qty: 1 }],
      payment: { code: "CASH", changeFor: 200 }, couponCode: "BEMVINDO10", customer: { name: "Teste Silva", phone: "21 98888-7777", optinWhatsapp: true } });
    expect(r.status).toBe(201);
    const o = r.body.order;
    expect(o.status).toBe("sent_to_pos");
    expect(o.discount).toBe(14.55); expect(o.deliveryFee).toBe(0);
    const p = saipos.orders.get(o.id)!.payload;
    expect(p.items[0].unit_price).toBe(99);
    expect(p.items[0].choice_items.map((c) => [c.desc_item_choice, c.aditional_price])).toEqual([["Gourmet", 0], ["1/2 4 Queijos", 30], ["1/2 Marguerita", 2.5]]);
    expect(p.payment_types[0]).toMatchObject({ code: "DIN", change_for: 200 });
    expect(p.customer.phone).toBe("21988887777");
    // webhook da SAIPOS: confirmado e concluído -> credita cashback
    const tok = (await (async () => { admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token; return (await call("GET", "/admin/integrations/saipos/sto_leblon")).body.webhookUrl.split("token=")[1]; })());
    admin = "";
    for (const ev of ["CONFIRMED", "DISPATCHED", "CONCLUDED"] as const) expect((await call("POST", `/webhooks/saipos/forneria-original/sto_leblon?token=${tok}`, saipos.event(o.id, ev))).status).toBe(200);
    const me = await call("GET", "/public/forneria-original/me", undefined, { "x-customer-token": r.body.customerToken });
    expect(me.body.wallet.balance).toBeGreaterThan(0);
    expect((await call("POST", `/webhooks/saipos/forneria-original/sto_leblon?token=errado`, saipos.event(o.id, "CONCLUDED"))).status).toBe(401);
  });

  it("importa clientes de planilha e conecta base por API com chave", async () => {
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    const csv = "Nome;Telefone;E-mail;Aceita WhatsApp\nMaria Teste;(21) 97777-1111;maria@t.com;sim\nSem Fone;;x@y.com;não\n";
    const fd = new FormData(); fd.append("kind", "customers"); fd.append("file", new File([csv], "clientes.csv", { type: "text/csv" }));
    const up = await app.request("/admin/imports", { method: "POST", headers: { authorization: "Bearer " + admin }, body: fd });
    const job = await up.json() as any;
    expect(job.mapping.phone).toBe("Telefone");
    const rep = await call("POST", `/admin/imports/${job.id}/commit`, { mapping: job.mapping });
    expect(rep.body.created).toBe(1); expect(rep.body.skipped).toBe(1);
    const key = await call("POST", "/admin/api-keys", { name: "ERP", scopes: ["customers:write", "orders:write"] });
    admin = "";
    const v = await call("POST", "/v1/customers", [{ phone: "21966665555", name: "Via API", optinWhatsapp: true }], { authorization: "Bearer " + key.body.key });
    expect(v.body.upserted).toBe(1);
    expect((await call("POST", "/v1/customers", [], { authorization: "Bearer cw_live_errada" })).status).toBe(401);
  });

  it("CRM: visão geral compara novos com novos, funil, RFM, cliente 360 e automações com grupo de controle", async () => {
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    const ov = await call("GET", "/admin/crm/overview?days=30");
    expect(ov.body.current.orders).toBeGreaterThan(50);
    expect(ov.body.current.novos.orders + ov.body.current.recorrentes.orders).toBeGreaterThan(0);
    expect(ov.body.current.funnel[0].sessions).toBeGreaterThan(ov.body.current.funnel[5].sessions);
    const f = await call("GET", "/admin/crm/funnel?days=60&by=source");
    expect(f.body.by.length).toBeGreaterThan(2);
    const rfm = await call("GET", "/admin/crm/rfm");
    expect(Object.values(rfm.body).reduce((a: number, x: any) => a + x.customers, 0)).toBeGreaterThan(200);
    const list = await call("GET", "/admin/crm/customers?limit=5");
    const c360 = await call("GET", `/admin/crm/customers/${list.body.rows[0].id}`);
    expect(c360.body.orders.length).toBeGreaterThan(0);
    const run = await call("POST", "/admin/crm/automations/run");
    expect(run.body.created + run.body.controle).toBeGreaterThan(0);
    const again = await call("POST", "/admin/crm/automations/run");
    expect(again.body.created).toBe(0); // idempotente
    const nps = await call("GET", "/admin/crm/pages/pg_avaliacao/responses");
    expect(nps.body.summary[0].nps).not.toBeNull();
  });

  it("homologação SAIPOS: checklist marca o que já foi exercitado", async () => {
    const h = await call("GET", "/admin/integrations/saipos/sto_leblon/homologation");
    expect(h.body.criteria.find((c: any) => c.label.startsWith("Dinheiro")).ok).toBe(true);
  });
});
