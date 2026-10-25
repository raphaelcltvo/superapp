import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { postgresDb } from "../src/db/postgres";
import { dataUrlStorage, type Deps } from "../src/deps";
import { seedForneria } from "../src/seed/forneria";
import { onOrderStatus } from "../src/services/orders";
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

const ADDR = { street: "Rua Dias Ferreira", number: "100", district: "Leblon", city: "Rio de Janeiro", state: "RJ", postalCode: "22431-050", lat: -22.984, lng: -43.225, complement: "apto 201" };

for (const [label, mk] of backends) describe(`Gestor de pedidos (${label})`, () => {
  let app: ReturnType<typeof createApp>; let deps: Deps; let admin = "";
  let clock = new Date("2026-10-23T22:00:00Z"); // sexta, 19h no Rio
  const heard: string[] = [];
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(admin ? { authorization: "Bearer " + admin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  const order = async (extra: Record<string, unknown> = {}) => {
    const keep = admin; admin = "";
    const r = await call("POST", "/public/forneria-original/orders", { storeId: "sto_leblon", mode: "DELIVERY", sessionId: "s" + Math.random(), address: ADDR,
      lines: [{ itemId: "b1", qty: 2 }], payment: { code: "CASH", changeFor: 100 }, customer: { name: "Ana Gestor", phone: "21 97777-0000" }, ...extra });
    admin = keep;
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.order;
  };
  beforeAll(async () => {
    const db = await mk();
    deps = { db, jwtSecret: "t", now: () => clock, storage: dataUrlStorage, messenger: { async send() { return { id: "m", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://cardapio.test" };
    app = createApp(deps);
    await seedForneria(db, { photo: () => undefined, media: {}, history: false });
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    expect((await call("POST", "/admin/publish", { notes: "v1" })).status).toBe(200);
    onOrderStatus.push((_c, o, st, prev) => { heard.push(`${o.displayId}:${prev || "-"}>${st}`); });
  }, 90000);

  it("configurações com padrão e validação", async () => {
    const s = await call("GET", "/admin/settings/orders");
    expect(s.body).toMatchObject({ mode: "manager", autoAccept: false, prepMinutes: 25, deliveryMinutes: 30, lateAfterMinutes: 10, sound: true });
    expect(s.body.rejectReasons.length).toBeGreaterThan(2);
    expect((await call("PUT", "/admin/settings/orders", { ...s.body, prepMinutes: 0 })).status).toBe(422);
  });

  it("pedido novo entra em Novos, com cliente, pagamento e cursor que não muda à toa", async () => {
    const o = await order();
    expect(o.status).toBe("created");
    const b = await call("GET", "/admin/orders/board");
    const c = b.body.columns.novos.find((x: any) => x.id === o.id);
    expect(c).toMatchObject({ displayId: o.displayId, mode: "DELIVERY", isFirstOrder: true, late: false, slaMinutes: 10 });
    expect(c.customer.name).toBe("Ana Gestor");
    expect(c.payment.line).toMatch(/^Dinheiro · troco para R\$ 100,00/);
    expect(c.address).toMatch(/Dias Ferreira, 100 · apto 201 · Leblon/);
    expect(c.lines[0].qty).toBe(2);
    const again = await call("GET", `/admin/orders/board?cursor=${b.body.cursor}`);
    expect(again.body).toMatchObject({ unchanged: true, cursor: b.body.cursor });
    expect(heard).toContain(`${o.displayId}:->created`);
  });

  it("atraso: Novos passa do limite e fica vermelho", async () => {
    clock = new Date(+clock + 12 * 60000);
    const b = await call("GET", "/admin/orders/board");
    expect(b.body.columns.novos[0].late).toBe(true);
    expect(b.body.columns.novos[0].minutesInStatus).toBe(12);
  });

  it("aceitar → em preparo; pronto → em rota → entregue; cursor muda a cada passo", async () => {
    const b0 = await call("GET", "/admin/orders/board");
    const id = b0.body.columns.novos[0].id;
    const a = await call("POST", `/admin/orders/${id}/accept`, { prepMinutes: 40 });
    expect(a.status).toBe(200); expect(a.body.status).toBe("confirmed");
    expect((await call("POST", `/admin/orders/${id}/accept`, {})).status).toBe(409);
    const b1 = await call("GET", `/admin/orders/board?cursor=${b0.body.cursor}`);
    expect(b1.body.unchanged).toBe(false);
    expect(b1.body.columns.em_preparo.find((x: any) => x.id === id).slaMinutes).toBe(40);
    for (const [st, col] of [["ready", "prontos"], ["dispatched", "em_rota"], ["concluded", "concluidos"]] as const) {
      expect((await call("POST", `/admin/orders/${id}/status`, { status: st })).status).toBe(200);
      const b = await call("GET", "/admin/orders/board");
      expect(b.body.columns[col].some((x: any) => x.id === id), col).toBe(true);
    }
    expect(heard.filter((h) => h.endsWith(">confirmed") || h.endsWith(">concluded")).length).toBe(2);
  });

  it("recusar com motivo cancela e vai para Concluídos hoje", async () => {
    const o = await order();
    const r = await call("POST", `/admin/orders/${o.id}/reject`, { reason: "Item em falta" });
    expect(r.body.status).toBe("cancelled");
    expect(r.body.statusHistory.at(-1).note).toBe("Recusado: Item em falta");
    const b = await call("GET", "/admin/orders/board");
    expect(b.body.columns.concluidos.find((x: any) => x.id === o.id).status).toBe("cancelled");
    expect((await call("POST", `/admin/orders/${o.id}/reject`, { reason: "de novo" })).status).toBe(409);
  });

  it("agendado para amanhã fica em Agendados e desce para Em preparo perto da hora", async () => {
    const when = new Date(+clock + 24 * 3600e3).toISOString();
    const o = await order({ scheduledFor: when });
    let b = await call("GET", "/admin/orders/board");
    expect(b.body.columns.agendados.some((x: any) => x.id === o.id)).toBe(true);
    await call("POST", `/admin/orders/${o.id}/accept`, {});
    b = await call("GET", "/admin/orders/board");
    expect(b.body.columns.agendados.some((x: any) => x.id === o.id)).toBe(true); // aceito, mas ainda longe
    clock = new Date(+new Date(when) - 30 * 60000);
    b = await call("GET", "/admin/orders/board");
    expect(b.body.columns.em_preparo.some((x: any) => x.id === o.id)).toBe(true);
  });

  it("aceite automático: pedido já nasce em preparo", async () => {
    const s = (await call("GET", "/admin/settings/orders")).body;
    expect((await call("PUT", "/admin/settings/orders", { ...s, autoAccept: true })).status).toBe(200);
    const o = await order();
    expect(o.status).toBe("confirmed");
    expect(o.statusHistory.at(-1)).toMatchObject({ by: "auto" });
    await call("PUT", "/admin/settings/orders", { ...s, autoAccept: false });
  });

  it("pausar e reabrir a loja pelo gestor", async () => {
    const p = await call("POST", "/admin/stores/sto_leblon/pause", { paused: true, reason: "Cozinha cheia" });
    expect(p.body).toMatchObject({ status: "paused", pausedReason: "Cozinha cheia" });
    const b = await call("GET", "/admin/orders/board");
    expect(b.body.stores.find((s: any) => s.id === "sto_leblon").status).toBe("paused");
    expect((await call("POST", "/admin/stores/sto_leblon/pause", { paused: false })).body.status).toBe("live");
  });
});
