/** Implementação Postgres do banco do algoritmo (esquema `algo`, conexão própria). Só no servidor. */
import postgres from "postgres";
import { ALGO_MIGRATIONS, ALGO_SCHEMA } from "./schema";
import { ALGO_TABLES, type AlgoDb, type AlgoTable, type SalesLineRow, type SalesQuery } from "./db";

/* ---------------- Postgres (esquema algo) ---------------- */
const ident = (s: string) => { if (!/^[a-zA-Z0-9_.]+$/.test(s)) throw new Error("campo inválido: " + s); return s; };
const jpath = (f: string) => { const p = ident(f).split("."); return p.length === 1 ? `doc->>'${p[0]}'` : `doc->${p.slice(0, -1).map((x) => `'${x}'`).join("->")}->>'${p[p.length - 1]}'`; };
const num = (v: unknown) => (v == null ? undefined : Number(v));
const iso = (v: unknown) => (v == null ? undefined : new Date(v as string).toISOString());
const salesRow = (x: Record<string, unknown>): SalesLineRow => ({
  id: x.id as string, fileId: x.file_id as string, channel: x.channel as string, isAggregate: !!x.is_aggregate,
  externalOrderId: (x.external_order_id as string) ?? undefined, orderedAt: iso(x.ordered_at)!, periodFrom: iso(x.period_from),
  customerKey: (x.customer_key as string) ?? undefined, customerId: (x.customer_id as string) ?? undefined,
  itemRaw: x.item_raw as string, itemId: (x.item_id as string) ?? undefined, qty: Number(x.qty), unitPrice: num(x.unit_price),
  lineTotal: num(x.line_total), discount: num(x.discount), orderTotal: num(x.order_total), deliveryFee: num(x.delivery_fee),
  status: x.status as SalesLineRow["status"], district: (x.district as string) ?? undefined, postalCode: (x.postal_code as string) ?? undefined, atypical: !!x.atypical,
});

/** Aplica as versões do esquema `algo` que ainda não rodaram (idempotente, isolado do restante). */
export async function migrateAlgo(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try { await runMigrations(sql); } finally { await sql.end(); }
}
async function runMigrations(sql: postgres.Sql) {
  await sql.unsafe(`create schema if not exists ${ALGO_SCHEMA}; create table if not exists ${ALGO_SCHEMA}.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  for (const m of ALGO_MIGRATIONS) {
    const done = await sql`select 1 from algo.schema_migrations where name = ${m.name}`;
    if (done.length) continue;
    await sql.begin(async (tx) => { await tx.unsafe(m.sql); await tx`insert into algo.schema_migrations (name) values (${m.name})`; });
  }
}

export function postgresAlgoDb(url: string): AlgoDb {
  const sql = postgres(url, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
  let ready: Promise<void> | undefined;
  const R = () => (ready ||= runMigrations(sql).catch((e) => { ready = undefined; throw e; }));
  const T0 = (t: AlgoTable) => { if (!ALGO_TABLES.includes(t)) throw new Error("tabela inválida: " + t); return `algo.${t}`; };
  const T = (t: AlgoTable) => `algo."${T0(t).slice(5)}"`;
  /** remove `undefined` (o driver recusa) mantendo o mesmo JSON */
  const clean = (x: unknown) => JSON.parse(JSON.stringify(x ?? {})) as never;
  const salesWhere = (tenantId: string, q: SalesQuery = {}) => sql`tenant_id = ${tenantId}
    ${q.includeCancelled ? sql`` : sql`and status <> 'cancelado'`}
    ${q.from ? sql`and ordered_at >= ${q.from}` : sql``} ${q.to ? sql`and ordered_at <= ${q.to}` : sql``}
    ${q.channel ? sql`and channel = ${q.channel}` : sql``} ${q.fileId ? sql`and file_id = ${q.fileId}` : sql``}
    ${q.itemId === undefined ? sql`` : q.itemId === null ? sql`and item_id is null` : sql`and item_id = ${q.itemId}`}`;
  return {
    kind: "postgres",
    async get(t, tenantId, id) { await R(); const r = await sql.unsafe(`select doc from ${T(t)} where tenant_id = $1 and id = $2`, [tenantId, id]); return (r[0]?.doc as never) ?? null; },
    async list(t, tenantId, o) {
      await R(); const params: unknown[] = [tenantId]; const parts = ["tenant_id = $1"];
      for (const [k, v] of Object.entries(o?.where || {})) { if (v === null) parts.push(`${jpath(k)} is null`); else { params.push(String(v)); parts.push(`${jpath(k)} = $${params.length}`); } }
      const q = `select doc from ${T(t)} where ${parts.join(" and ")} order by created_at desc${o?.limit ? ` limit ${Number(o.limit)}` : ""}`;
      return (await sql.unsafe(q, params as never[])).map((r) => r.doc as never);
    },
    async put(t, tenantId, doc) {
      await R(); const created = (doc as { createdAt?: string }).createdAt || new Date().toISOString();
      await sql`insert into ${sql(T0(t))} (id, tenant_id, doc, created_at) values (${doc.id}, ${tenantId}, ${sql.json(clean(doc))}, ${created}) on conflict (tenant_id, id) do update set doc = excluded.doc, updated_at = now()`;
      return doc;
    },
    async patch(t, tenantId, id, p) {
      await R();
      const r = await sql`update ${sql(T0(t))} set doc = doc || ${sql.json(clean(p))} || jsonb_build_object('id', ${id}::text), updated_at = now() where tenant_id = ${tenantId} and id = ${id} returning doc`;
      return (r[0]?.doc as never) ?? null;
    },
    async remove(t, tenantId, id) { await R(); const r = await sql.unsafe(`delete from ${T(t)} where tenant_id = $1 and id = $2`, [tenantId, id]); return r.count > 0; },
    sales: {
      async insert(tenantId, rows) {
        await R();
        for (let i = 0; i < rows.length; i += 2000) {
          const chunk = rows.slice(i, i + 2000); if (!chunk.length) continue;
          await sql`insert into algo.sales_lines ${sql(chunk.map((r) => ({ id: r.id, tenant_id: tenantId, file_id: r.fileId, channel: r.channel, is_aggregate: !!r.isAggregate, external_order_id: r.externalOrderId ?? null, ordered_at: r.orderedAt, period_from: r.periodFrom ?? null, customer_key: r.customerKey ?? null, customer_id: r.customerId ?? null, item_raw: r.itemRaw, item_id: r.itemId ?? null, qty: r.qty, unit_price: r.unitPrice ?? null, line_total: r.lineTotal ?? null, discount: r.discount ?? null, order_total: r.orderTotal ?? null, delivery_fee: r.deliveryFee ?? null, status: r.status, district: r.district ?? null, postal_code: r.postalCode ?? null, atypical: !!r.atypical })) as never)} on conflict (id) do nothing`;
        }
      },
      async list(tenantId, q) { await R(); const r = await sql`select * from algo.sales_lines where ${salesWhere(tenantId, q)} order by ordered_at desc ${q?.limit ? sql`limit ${q.limit}` : sql``}`; return r.map((x) => salesRow(x)); },
      async itemTotals(tenantId, q) {
        await R();
        const r = await sql`select item_id, min(item_raw) as item_raw, sum(qty) as qty,
            sum(coalesce(line_total, coalesce(unit_price, 0) * qty)) as revenue,
            count(distinct case when external_order_id is not null then channel || ':' || external_order_id end) as orders
          from algo.sales_lines where ${salesWhere(tenantId, q)}
          group by item_id, case when item_id is null then lower(item_raw) end order by revenue desc`;
        return r.map((x) => ({ itemId: (x.item_id as string) ?? null, itemRaw: x.item_raw as string, qty: Number(x.qty), revenue: Math.round(Number(x.revenue) * 100) / 100, orders: Number(x.orders) }));
      },
      async stats(tenantId, q) {
        await R();
        const r = await sql`with o as (select channel, external_order_id, bool_or(customer_key is not null) as ident from algo.sales_lines where ${salesWhere(tenantId, q)} and external_order_id is not null group by 1, 2)
          select (select count(*) from algo.sales_lines where ${salesWhere(tenantId, q)})::int as lines,
                 (select count(*) from o)::int as orders, (select count(*) from o where ident)::int as identified,
                 (select count(*) from algo.sales_lines where ${salesWhere(tenantId, q)} and is_aggregate)::int as agg,
                 (select min(ordered_at) from algo.sales_lines where ${salesWhere(tenantId, q)}) as first,
                 (select max(ordered_at) from algo.sales_lines where ${salesWhere(tenantId, q)}) as last`;
        const x = r[0];
        return { lines: x.lines, orders: x.orders, identifiedOrders: x.identified, aggregateLines: x.agg, first: iso(x.first), last: iso(x.last) };
      },
      async removeFile(tenantId, fileId) { await R(); const r = await sql`delete from algo.sales_lines where tenant_id = ${tenantId} and file_id = ${fileId}`; return r.count; },
      async patch(tenantId, ids, p) {
        await R(); if (!ids.length) return 0;
        const set: Record<string, unknown> = {};
        if ("itemId" in p) set.item_id = p.itemId ?? null;
        if ("atypical" in p) set.atypical = !!p.atypical;
        if ("customerId" in p) set.customer_id = p.customerId ?? null;
        if (!Object.keys(set).length) return 0;
        const r = await sql`update algo.sales_lines set ${sql(set as never)} where tenant_id = ${tenantId} and id in ${sql(ids)}`;
        return r.count;
      },
    },
    assignments: {
      async assign(tenantId, row) {
        await R();
        await sql`insert into algo.assignments (tenant_id, experiment_id, unit_id, arm, ts) values (${tenantId}, ${row.experimentId}, ${row.unitId}, ${row.arm}, ${row.ts}) on conflict do nothing`;
        const r = await sql`select arm, ts from algo.assignments where tenant_id = ${tenantId} and experiment_id = ${row.experimentId} and unit_id = ${row.unitId}`;
        return { experimentId: row.experimentId, unitId: row.unitId, arm: r[0].arm, ts: iso(r[0].ts)! };
      },
      async list(tenantId, experimentId) {
        await R(); const r = await sql`select unit_id, arm, ts from algo.assignments where tenant_id = ${tenantId} and experiment_id = ${experimentId} order by ts`;
        return r.map((x) => ({ experimentId, unitId: x.unit_id, arm: x.arm, ts: iso(x.ts)! }));
      },
    },
    metrics: {
      async upsert(tenantId, rows) {
        await R();
        for (let i = 0; i < rows.length; i += 2000) {
          const chunk = rows.slice(i, i + 2000); if (!chunk.length) continue;
          await sql`insert into algo.metrics_daily ${sql(chunk.map((m) => ({ tenant_id: tenantId, day: m.day, metric: m.metric, segment: m.segment, dim: m.dim, value: m.value })) as never)}
            on conflict (tenant_id, day, metric, segment, dim) do update set value = excluded.value`;
        }
      },
      async list(tenantId, q) {
        await R();
        const r = await sql`select to_char(day, 'YYYY-MM-DD') as day, metric, segment, dim, value from algo.metrics_daily where tenant_id = ${tenantId}
          ${q.metric ? sql`and metric = ${q.metric}` : sql``} ${q.segment ? sql`and segment = ${q.segment}` : sql``}
          ${q.from ? sql`and day >= ${q.from}` : sql``} ${q.to ? sql`and day <= ${q.to}` : sql``} order by day`;
        return r.map((x) => ({ day: x.day, metric: x.metric, segment: x.segment, dim: x.dim, value: Number(x.value) }));
      },
    },
    async close() { await sql.end(); },
  };
}
