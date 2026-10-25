import { Hono } from "hono";
import { z } from "zod";
import { AGENTS, CAPABILITIES, LEAKS, LEVERS, SALES_FIELDS, type AgentState, type DataRequest, type Decision, type Experiment, type Finding, type SetupFile, type SetupRun } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { addFile, assignArm, buildDossier, cockpit, createExperiment, decide, ensureAgents, evasionReport, experimentStats, ingestFile, recomputeLadder, runCycle, startRun } from "../services/algo";

type W<T> = T & { id: string };
const channels = ["ifood", "99food", "delivery_direto", "saipos", "pdv", "proprio", "outro"] as const;
const kinds = ["pedidos_itens", "vendas_item", "pedidos", "clientes", "promocoes", "cardapio", "operacao", "desconhecido"] as const;
const range = (c: { req: { query(k: string): string | undefined } }, now: Date, days = 28) => {
  const to = c.req.query("to") ? new Date(c.req.query("to")! + "T23:59:59.999Z") : now;
  const from = c.req.query("from") ? new Date(c.req.query("from")! + "T00:00:00.000Z") : new Date(+to - days * 864e5);
  return { from: from.toISOString(), to: to.toISOString() };
};

/** /admin/algo — camada 0 (SETUP), agentes A–G, orquestrador e ciclo vivo. */
export function algoRoutes() {
  const r = new Hono<Env>();

  /* ---------- catálogo fixo (rótulos para a interface) ---------- */
  r.get("/catalog", (c) => c.json({ agents: AGENTS, leaks: LEAKS, levers: LEVERS, capabilities: CAPABILITIES, salesFields: SALES_FIELDS, channels, kinds }));

  /* ---------- cockpit ---------- */
  r.get("/cockpit", async (c) => { const { from, to } = range(c, c.get("deps").now()); return c.json(await cockpit(ctxOf(c), from, to)); });
  r.get("/evasion", async (c) => { const { from, to } = range(c, c.get("deps").now(), 7); return c.json(await evasionReport(ctxOf(c), from, to)); });
  r.get("/metrics", async (c) => c.json(await c.get("deps").db.metrics.list(c.get("tenantId"), { metric: c.req.query("metric"), segment: c.req.query("segment"), from: c.req.query("from"), to: c.req.query("to") })));
  r.post("/cycle/run", async (c) => { const i = await body(c, z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })); return c.json(await runCycle(ctxOf(c), i.day)); });

  /* ---------- agentes ---------- */
  r.get("/agents", async (c) => c.json(await ensureAgents(ctxOf(c))));
  r.patch("/agents/:code", async (c) => {
    const code = c.req.param("code").toUpperCase();
    if (!AGENTS.some((a) => a.code === code)) throw new HttpError(404, "Agente não encontrado");
    await ensureAgents(ctxOf(c));
    const i = await body(c, z.object({ enabled: z.boolean().optional(), mode: z.enum(["regras", "modelo"]).optional(), params: z.record(z.union([z.number(), z.string(), z.boolean()])).optional() }));
    const cur = (await c.get("deps").db.get<W<AgentState>>("agents", c.get("tenantId"), code))!;
    return c.json(await c.get("deps").db.patch("agents", c.get("tenantId"), code, { ...i, params: { ...cur.params, ...(i.params || {}) } }));
  });

  /* ---------- camada 0: SETUP (Agente S) ---------- */
  r.get("/setup/runs", async (c) => c.json(await c.get("deps").db.list<W<SetupRun>>("setup_runs", c.get("tenantId"), { limit: 20 })));
  r.post("/setup/runs", async (c) => {
    const i = await body(c, z.object({ channels: z.array(z.enum(channels)).default([]), systems: z.array(z.string()).default([]), notes: z.string().optional() }));
    return c.json(await startRun(ctxOf(c), { channels: i.channels, systems: i.systems, notes: i.notes }), 201);
  });
  r.get("/setup/runs/:id", async (c) => {
    const db = c.get("deps").db; const T = c.get("tenantId"); const id = c.req.param("id");
    const run = await db.get<W<SetupRun>>("setup_runs", T, id); if (!run) throw new HttpError(404, "Rodada não encontrada");
    const files = (await db.list<W<SetupFile>>("setup_files", T, { where: { runId: id }, limit: 500 })).map(({ rows: _r, ...f }) => f);
    const requests = (await db.list<W<DataRequest>>("data_requests", T, { limit: 500 })).filter((x) => x.runId === id || !x.runId).sort((a, b) => b.impact - a.impact);
    return c.json({ run, files, requests });
  });
  /** campo livre: qualquer relatório de qualquer canal */
  r.post("/setup/runs/:id/files", async (c) => {
    const form = await c.req.formData(); const f = form.get("file");
    if (!(f instanceof File)) throw new HttpError(400, "Envie o arquivo no campo file");
    if (f.size > 25e6) throw new HttpError(413, "Arquivo acima de 25 MB");
    return c.json(await addFile(ctxOf(c), c.req.param("id"), new Uint8Array(await f.arrayBuffer()), f.name), 201);
  });
  r.post("/setup/files/:id/ingest", async (c) => {
    const i = await body(c, z.object({ mapping: z.record(z.string()).optional(), channel: z.enum(channels).optional(), kind: z.enum(kinds).optional() }));
    return c.json(await ingestFile(ctxOf(c), c.req.param("id"), i));
  });
  r.post("/setup/files/:id/discard", async (c) => {
    const db = c.get("deps").db; const T = c.get("tenantId"); const id = c.req.param("id");
    const removed = await db.sales.removeFile(T, id);
    await db.patch("setup_files", T, id, { status: "descartado", rows: [] });
    return c.json({ removed, ladder: await recomputeLadder(ctxOf(c)) });
  });
  r.get("/setup/ladder", async (c) => c.json(await recomputeLadder(ctxOf(c))));
  r.post("/setup/runs/:id/dossier", async (c) => c.json(await buildDossier(ctxOf(c), c.req.param("id"))));

  /** histórico importado: totais por item (Pareto/BCG) e amostra de linhas */
  r.get("/sales/items", async (c) => c.json(await c.get("deps").db.sales.itemTotals(c.get("tenantId"), { from: c.req.query("from"), to: c.req.query("to"), channel: c.req.query("channel") })));
  r.get("/sales/stats", async (c) => c.json(await c.get("deps").db.sales.stats(c.get("tenantId"), { channel: c.req.query("channel") })));
  /** confirma a correspondência de um nome vendido com o item do cardápio (responde ao pedido do Agente S) */
  r.post("/sales/match", async (c) => {
    const i = await body(c, z.object({ itemRaw: z.string().min(1), itemId: z.string().min(1) }));
    const db = c.get("deps").db; const T = c.get("tenantId");
    const lines = (await db.sales.list(T, { itemId: null, includeCancelled: true })).filter((l) => l.itemRaw.toLowerCase() === i.itemRaw.toLowerCase());
    return c.json({ updated: await db.sales.patch(T, lines.map((l) => l.id), { itemId: i.itemId }), ladder: await recomputeLadder(ctxOf(c)) });
  });

  /* ---------- pedidos à marca ---------- */
  r.get("/requests", async (c) => { const st = c.req.query("status"); return c.json((await c.get("deps").db.list<W<DataRequest>>("data_requests", c.get("tenantId"), { where: st ? { status: st } : undefined, limit: 500 })).sort((a, b) => b.impact - a.impact)); });
  r.patch("/requests/:id", async (c) => {
    const i = await body(c, z.object({ status: z.enum(["aberto", "enviado", "respondido", "resolvido", "descartado"]) }));
    const out = await c.get("deps").db.patch("data_requests", c.get("tenantId"), c.req.param("id"), i); if (!out) throw new HttpError(404, "Pedido não encontrado"); return c.json(out);
  });

  /* ---------- achados ---------- */
  r.get("/findings", async (c) => {
    const where: Record<string, string> = {}; for (const k of ["agent", "status", "severity"]) { const v = c.req.query(k); if (v) where[k] = k === "agent" ? v.toUpperCase() : v; }
    return c.json(await c.get("deps").db.list<W<Finding>>("findings", c.get("tenantId"), { where, limit: 500 }));
  });
  r.patch("/findings/:id", async (c) => {
    const i = await body(c, z.object({ status: z.enum(["aberto", "em_teste", "resolvido", "descartado"]) }));
    const out = await c.get("deps").db.patch("findings", c.get("tenantId"), c.req.param("id"), { ...i, updatedAt: c.get("deps").now().toISOString() }); if (!out) throw new HttpError(404, "Achado não encontrado"); return c.json(out);
  });

  /* ---------- decisões (fila de aprovação) ---------- */
  r.get("/decisions", async (c) => { const st = c.req.query("status"); return c.json(await c.get("deps").db.list<W<Decision>>("decisions", c.get("tenantId"), { where: st ? { status: st } : undefined, limit: 500 })); });
  r.post("/decisions/:id/approve", async (c) => c.json(await decide(ctxOf(c), c.req.param("id"), true, c.get("admin")!.sub)));
  r.post("/decisions/:id/reject", async (c) => c.json(await decide(ctxOf(c), c.req.param("id"), false, c.get("admin")!.sub)));

  /* ---------- testes (Agente G) ---------- */
  r.get("/experiments", async (c) => { const st = c.req.query("status"); return c.json(await c.get("deps").db.list<W<Experiment>>("experiments", c.get("tenantId"), { where: st ? { status: st } : undefined, limit: 200 })); });
  r.post("/experiments", async (c) => {
    const i = await body(c, z.object({
      agent: z.enum(["A", "B", "C", "D", "E", "F"]), lever: z.enum(Object.keys(LEVERS) as [keyof typeof LEVERS, ...(keyof typeof LEVERS)[]]),
      hypothesis: z.string().min(5), leak: z.enum(["chegada", "navegacao", "item", "sacola", "checkout", "pagamento", "recompra"]).optional(),
      unit: z.enum(["sessao", "cliente"]).optional(), metric: z.enum(["conversao_intencao", "abertura_item", "sacola_pedido", "recuperacao"]).optional(), findingId: z.string().optional(),
      arms: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), config: z.record(z.unknown()).default({}), control: z.boolean().optional() })).min(2),
    }));
    return c.json(await createExperiment(ctxOf(c), i as never), 201);
  });
  r.get("/experiments/:id", async (c) => c.json(await experimentStats(ctxOf(c), c.req.param("id"))));
  r.post("/experiments/:id/assign", async (c) => { const i = await body(c, z.object({ unitId: z.string().min(4) })); return c.json(await assignArm(ctxOf(c), c.req.param("id"), i.unitId)); });

  return r;
}
