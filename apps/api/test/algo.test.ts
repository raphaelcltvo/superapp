import { describe, it, expect, beforeAll } from "vitest";
import { computeLadder, matchItem, pickArm, sessionOutcomes, evasion, markRecovered, prioritizeLeaks } from "@cw/core";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { postgresDb } from "../src/db/postgres";
import { dataUrlStorage, type Deps } from "../src/deps";
import { seedForneria } from "../src/seed/forneria";
import type { Db } from "../src/db/types";

describe("algoritmo · regras puras", () => {
  it("classifica cada sessão pelo ponto de saída", () => {
    const ev = (s: string, name: string, m = 0, customerId?: string) => ({ sessionId: s, name, ts: new Date(Date.UTC(2026, 9, 1, 20, m)).toISOString(), customerId });
    const out = sessionOutcomes([
      ev("a", "visit"),
      ev("b", "visit"), ev("b", "search", 1),
      ev("c", "visit"), ev("c", "item_view", 1),
      ev("d", "visit"), ev("d", "add_to_cart", 1, "cus1"),
      ev("e", "visit"), ev("e", "checkout_start", 2),
      ev("f", "visit"), ev("f", "checkout_start", 2), ev("f", "payment_declined", 3),
      ev("g", "visit"), ev("g", "add_to_cart", 1), ev("g", "order_placed", 4),
    ], () => "novato");
    const by = Object.fromEntries(out.map((o) => [o.sessionId, o]));
    expect(by.a.exit).toBe("chegada"); expect(by.a.intent).toBe(false);
    expect(by.b.exit).toBe("navegacao");
    expect(by.c.exit).toBe("item");
    expect(by.d.exit).toBe("sacola"); expect(by.d.intent).toBe(true);
    expect(by.e.exit).toBe("checkout");
    expect(by.f.exit).toBe("pagamento");
    expect(by.g.converted).toBe(true); expect(by.g.exit).toBeUndefined();
    // d foi recuperada pelo CRM: pediu 2 h depois da sessão
    markRecovered(out, [{ customerId: "cus1", createdAt: new Date(Date.UTC(2026, 9, 1, 22, 1)).toISOString() }]);
    const r = evasion(out);
    expect(r.intentSessions).toBe(4); expect(r.converted).toBe(1); expect(r.recovered).toBe(1);
    expect(r.netEvasion).toBe(50); // (4 − 1 − 1) ÷ 4
    expect(prioritizeLeaks(r).order[0]).toBe("chegada");
  });

  it("escada de dados sobe com volume, cobertura e identificação", () => {
    const base = { pricedItems: 40, aggregateLines: 0, ordersWithItems: 0, identifiedShare: 0, periodDays: 0, coverage: 0, consistency: 1, costCoverage: 0, ownOrders: 0 };
    expect(computeLadder({ ...base, pricedItems: 0 }).blocked).toBe(true);
    expect(computeLadder(base).step).toBe(0);
    expect(computeLadder({ ...base, aggregateLines: 30 }).step).toBe(1);
    expect(computeLadder({ ...base, ordersWithItems: 1500, periodDays: 200, coverage: 0.97 }).step).toBe(2);
    expect(computeLadder({ ...base, ordersWithItems: 1500, periodDays: 200, coverage: 0.97, identifiedShare: 0.8 }).step).toBe(3);
    expect(computeLadder({ ...base, ordersWithItems: 1500, periodDays: 200, coverage: 0.7, identifiedShare: 0.8 }).step).toBe(1);
  });

  it("casa nomes dos canais com o cardápio sem escrita idêntica", () => {
    const cat = [{ id: "1", name: "Calabresa" }, { id: "2", name: "Calabresa Gourmet" }, { id: "3", name: "Marguerita" }, { id: "4", name: "Muçarela" }];
    expect(matchItem("Pizza Calabresa G", cat)).toMatchObject({ id: "1", status: "auto" });
    expect(matchItem("PIZZA MUCARELA GRANDE 40CM", cat)).toMatchObject({ id: "4", status: "auto" });
    expect(matchItem("Esfiha de carne", cat).status).toBe("sem_par");
  });

  it("Thompson sampling respeita a fatia de controle e favorece o melhor braço", () => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stats = [{ arm: "ctl", trials: 500, successes: 50, control: true }, { arm: "a", trials: 500, successes: 50 }, { arm: "b", trials: 500, successes: 90 }];
    const picks: Record<string, number> = { ctl: 0, a: 0, b: 0 };
    for (let i = 0; i < 2000; i++) picks[pickArm(stats, 0.1, rnd)]++;
    expect(picks.ctl / 2000).toBeGreaterThan(0.07); expect(picks.ctl / 2000).toBeLessThan(0.13);
    expect(picks.b).toBeGreaterThan(picks.a * 10);
  });
});

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

const csv = (rows: (string | number)[][]) => new TextEncoder().encode(rows.map((r) => r.join(";")).join("\n"));

for (const [label, mk] of backends) describe(`Algoritmo · SETUP, agentes e ciclo (${label})`, () => {
  let app: ReturnType<typeof createApp>; let db: Db; let token = ""; let runId = "";
  const T = "ten_forneria";
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.request("/admin/algo" + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  const upload = async (name: string, bytes: Uint8Array) => {
    const fd = new FormData(); fd.append("file", new File([bytes], name));
    const r = await app.request(`/admin/algo/setup/runs/${runId}/files`, { method: "POST", headers: { authorization: "Bearer " + token }, body: fd });
    return { status: r.status, body: (await r.json()) as any };
  };

  beforeAll(async () => {
    db = await mk();
    const deps: Deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: { async send() { return { id: "m", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://cardapio.test", cronSecret: "cron" };
    app = createApp(deps);
    await seedForneria(db, { photo: () => undefined, media: {}, history: true });
    const r = await app.request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "demo@forneria.com.br", password: "forneria2026" }) });
    token = ((await r.json()) as any).token;
  }, 90000);

  it("cria os 9 agentes (S, A–G e orquestrador) e abre a rodada de SETUP", async () => {
    const a = await call("GET", "/agents");
    expect(a.body.map((x: any) => x.code).sort().join("")).toBe("ABCDEFGOS");
    const run = await call("POST", "/setup/runs", { channels: ["ifood", "delivery_direto"], systems: ["saipos"] });
    expect(run.status).toBe(201); runId = run.body.id;
  });

  it("Agente S reconhece um relatório do iFood item a item, critica e não cria contatos de marketplace", async () => {
    const before = await db.count("customers", T);
    const rows: (string | number)[][] = [["ID do pedido", "Data do pedido", "Produto", "Quantidade", "Valor unitário", "Total do pedido", "Taxa de entrega", "Status", "Telefone"]];
    rows.push(["1001", "03/05/2026 19:30", "Pizza Calabresa G", 1, "108,00", "116,00", "8,00", "Concluído", "(21) 98888-0001"]);
    rows.push(["1001", "03/05/2026 19:30", "Pizza Calabresa G", 1, "108,00", "116,00", "8,00", "Concluído", "(21) 98888-0001"]); // linha repetida
    rows.push(["1002", "04/05/2026 20:10", "Pizza Marguerita", 2, "104,00", "300,00", "0", "Concluído", ""]); // total não fecha
    rows.push(["1003", "05/05/2026 21:00", "Esfiha Misteriosa", 3, "10,00", "30,00", "0", "Concluído", "(21) 98888-0003"]);
    rows.push(["1004", "06/05/2026 21:00", "Pizza Portuguesa", 1, "135,00", "135,00", "0", "Cancelado", ""]);
    const up = await upload("relatorio-ifood-pedidos-maio.csv", csv(rows));
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ channel: "ifood", kind: "pedidos_itens", status: "classificado" });
    expect(up.body.mapping).toMatchObject({ orderId: "ID do pedido", item: "Produto", qty: "Quantidade" });
    const ing = await call("POST", `/setup/files/${up.body.id}/ingest`, {});
    expect(ing.status).toBe(200);
    expect(ing.body).toMatchObject({ duplicates: 1, cancelled: 1 });
    expect(ing.body.critiques.map((c: any) => c.checkup)).toEqual(expect.arrayContaining(["coerencia", "duplicados", "cancelados", "casamento"]));
    expect(await db.count("customers", T)).toBe(before); // marketplace: só pseudônimo
    const lines = await db.sales.list(T, { fileId: up.body.id, includeCancelled: true });
    expect(lines.length).toBe(4);
    expect(lines.find((l) => l.externalOrderId === "1001")!.customerKey).toMatch(/^ck_/);
    expect(lines.find((l) => l.externalOrderId === "1001")!.itemId).toBeTruthy();
    const req = await call("GET", "/requests?status=aberto");
    expect(req.body.some((r: any) => r.title.includes("não casaram") && r.items.some((i: any) => i.label.includes("Esfiha")))).toBe(true);
    const f = await call("GET", "/findings?agent=S");
    expect(f.body.some((x: any) => x.checkup === "coerencia")).toBe(true);
  });

  it("canal próprio vira cliente unificado; relatório agregado entra como degrau 1", async () => {
    const up = await upload("delivery-direto-pedidos.csv", csv([["Pedido", "Data", "Item", "Qtd", "Preço", "Celular", "E-mail"], ["DD-1", "07/05/2026 20:00", "Calabresa", 1, "108", "21977770001", "ana@ex.com"], ["DD-2", "08/05/2026 20:00", "Muçarela", 1, "104", "", "ana@ex.com"]]));
    expect(up.body.channel).toBe("delivery_direto");
    await call("POST", `/setup/files/${up.body.id}/ingest`, {});
    const ana = await db.list<any>("customers", T, { where: { phone: "5521977770001" } });
    expect(ana.length).toBe(1);
    const ls = await db.sales.list(T, { fileId: up.body.id });
    expect(new Set(ls.map((l) => l.customerId)).size).toBe(1); // e-mail casou com o mesmo cliente

    const agg = await upload("99food-vendas-por-item-abril.csv", csv([["Produto", "Quantidade vendida", "Faturamento", "Data final"], ["Pizza Calabresa", 120, "12960,00", "30/04/2026"], ["Pizza Marguerita", 80, "8320,00", "30/04/2026"]]));
    expect(agg.body).toMatchObject({ channel: "99food", kind: "vendas_item" });
    const ing = await call("POST", `/setup/files/${agg.body.id}/ingest`, {});
    expect(ing.body.ladder.step).toBeGreaterThanOrEqual(1);
    const items = await call("GET", "/sales/items");
    expect(items.body[0].revenue).toBeGreaterThan(10000);
  });

  it("confirmar correspondência atualiza o histórico; dossiê pede aprovação e libera o lançamento", async () => {
    const opt = (await db.list<any>("option_groups", T)).flatMap((g) => g.options.map((o: any) => ({ id: `opt:${g.id}:${o.id}`, name: o.name })))[0];
    const m = await call("POST", "/sales/match", { itemRaw: "Esfiha Misteriosa", itemId: opt.id });
    expect(m.body.updated).toBe(1);
    const d = await call("POST", `/setup/runs/${runId}/dossier`);
    expect(d.body.dossier.sources.length).toBe(3);
    expect(d.body.decision).toMatchObject({ kind: "liberar_lancamento", status: "pendente", requiresApproval: true });
    const ok = await call("POST", `/decisions/${d.body.decision.id}/approve`);
    expect(ok.body.status).toBe("aplicada");
    const run = await call("GET", `/setup/runs/${runId}`);
    expect(run.body.run.status).toBe("liberado");
    expect(run.body.files.every((f: any) => !f.rows)).toBe(true);
  });

  it("uma volta do ciclo mede a evasão por perfil, grava métricas e redistribui a exploração", async () => {
    const day = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
    const c = await call("POST", "/cycle/run", { day });
    expect(c.status).toBe(200);
    expect(c.body.priority.length).toBeGreaterThan(0);
    const m = await call("GET", `/metrics?metric=evasao_liquida&from=${day}&to=${day}`);
    expect(m.body.map((x: any) => x.segment).sort()).toEqual(["novato", "recorrente", "todos"]);
    const agents = await call("GET", "/agents");
    expect(agents.body.reduce((a: number, x: any) => a + (x.explorationShare || 0), 0)).toBeGreaterThan(0.9);
    const f = await call("GET", "/findings?status=aberto");
    expect(f.body.some((x: any) => x.checkup === "maior_vazamento")).toBe(true);
    const cp = await call("GET", "/cockpit");
    expect(cp.body.leaks.leaks.length).toBe(7);
    expect(cp.body.evasion.novato.segment).toBe("novato");
    expect(cp.body.agents.length).toBe(9);
    // segunda chamada pelo cron no mesmo dia não refaz
    const tick = await app.request("/cron/tick", { method: "POST", headers: { "x-cron-secret": "cron" } });
    expect(tick.status).toBe(200);
  });

  it("Agente G: dono certo da alavanca, sorteio fixo por sessão e endpoint público para o cardápio", async () => {
    const bad = await call("POST", "/experiments", { agent: "F", lever: "ordem_itens", hypothesis: "Ordem nova converte mais", arms: [{ id: "a", name: "Atual" }, { id: "b", name: "Nova" }] });
    expect(bad.status).toBe(422);
    const e = await call("POST", "/experiments", { agent: "A", lever: "ordem_itens", hypothesis: "Curva A na primeira dobra converte mais", leak: "navegacao", arms: [{ id: "atual", name: "Ordem atual" }, { id: "curva_a", name: "Curva A primeiro", config: { firstFold: ["calabresa"] } }] });
    expect(e.status).toBe(201); expect(e.body.arms[0].control).toBe(true);
    const dup = await call("POST", "/experiments", { agent: "D", lever: "ordem_itens", hypothesis: "Outra ordem", arms: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
    expect(dup.status).toBe(409);
    const a1 = await app.request(`/public/forneria-original/experiments/${e.body.id}/assign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "sess_abc123" }) });
    const first = (await a1.json()) as any;
    for (let i = 0; i < 3; i++) { const again = await call("POST", `/experiments/${e.body.id}/assign`, { unitId: "sess_abc123" }); expect(again.body.arm).toBe(first.arm); }
    const st = await call("GET", `/experiments/${e.body.id}`);
    expect(st.body.stats.length).toBe(2);
  });
});
