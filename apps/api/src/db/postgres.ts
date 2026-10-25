import postgres from "postgres";
import type { Db, Doc, ListOpts, SalesLineRow, SalesQuery, Table } from "./types";

const ident = (s: string) => { if (!/^[a-zA-Z0-9_.]+$/.test(s)) throw new Error("campo inválido: " + s); return s; };
/** caminho "a.b" -> doc->'a'->>'b' */
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

export function postgresDb(url: string): Db {
  const sql = postgres(url, { max: 10, idle_timeout: 20, prepare: false, onnotice: () => {} });
  const salesWhere = (tenantId: string, q: SalesQuery = {}) => sql`tenant_id = ${tenantId}
    ${q.includeCancelled ? sql`` : sql`and status <> 'cancelado'`}
    ${q.from ? sql`and ordered_at >= ${q.from}` : sql``} ${q.to ? sql`and ordered_at <= ${q.to}` : sql``}
    ${q.channel ? sql`and channel = ${q.channel}` : sql``} ${q.fileId ? sql`and file_id = ${q.fileId}` : sql``}
    ${q.itemId === undefined ? sql`` : q.itemId === null ? sql`and item_id is null` : sql`and item_id = ${q.itemId}`}`;
  const where = (tenantId: string, o: ListOpts | undefined, params: unknown[]) => {
    params.push(tenantId);
    const parts = [`tenant_id = $${params.length}`];
    for (const [k, v] of Object.entries(o?.where || {})) {
      if (v === null) parts.push(`${jpath(k)} is null`);
      else { params.push(String(v)); parts.push(`${jpath(k)} = $${params.length}`); }
    }
    if (o?.since) { params.push(o.since); parts.push(`created_at >= $${params.length}`); }
    if (o?.until) { params.push(o.until); parts.push(`created_at <= $${params.length}`); }
    return parts.join(" and ");
  };
  const T = (t: Table) => `"${ident(t)}"`;
  return {
    kind: "postgres",
    tenants: {
      async get(id) { const r = await sql`select doc from tenants where id = ${id}`; return (r[0]?.doc as never) ?? null; },
      async bySlug(slug) { const r = await sql`select doc from tenants where slug = ${slug}`; return (r[0]?.doc as never) ?? null; },
      async list() { return (await sql`select doc from tenants order by created_at`).map((r) => r.doc as never); },
      async put(t) { await sql`insert into tenants (id, slug, doc) values (${t.id}, ${t.slug}, ${sql.json(t as never)}) on conflict (id) do update set slug = excluded.slug, doc = excluded.doc, updated_at = now()`; return t; },
    },
    async get(t, tenantId, id) { const r = await sql.unsafe(`select doc from ${T(t)} where tenant_id = $1 and id = $2`, [tenantId, id]); return (r[0]?.doc as never) ?? null; },
    async list(t, tenantId, o) {
      const params: unknown[] = [];
      let q = `select doc from ${T(t)} where ${where(tenantId, o, params)}`;
      if (o?.orderBy) { const f = o.orderBy.field === "createdAt" ? "created_at" : `(${jpath(o.orderBy.field)})`; q += ` order by ${f} ${o.orderBy.dir === "desc" ? "desc" : "asc"}`; }
      else q += " order by created_at desc";
      if (o?.limit) q += ` limit ${Number(o.limit)}`;
      if (o?.offset) q += ` offset ${Number(o.offset)}`;
      return (await sql.unsafe(q, params as never[])).map((r) => r.doc as never);
    },
    async count(t, tenantId, o) { const params: unknown[] = []; const r = await sql.unsafe(`select count(*)::int as n from ${T(t)} where ${where(tenantId, o, params)}`, params as never[]); return r[0].n as number; },
    async put(t, tenantId, doc) {
      const created = (doc as { createdAt?: string }).createdAt || new Date().toISOString();
      await sql`insert into ${sql(ident(t))} (id, tenant_id, doc, created_at) values (${doc.id}, ${tenantId}, ${sql.json(doc as never)}, ${created}) on conflict (id) do update set doc = excluded.doc, updated_at = now()`;
      return doc;
    },
    async patch(t, tenantId, id, p) {
      const r = await sql`update ${sql(ident(t))} set doc = doc || ${sql.json(p as never)}, updated_at = now() where tenant_id = ${tenantId} and id = ${id} returning doc`;
      return (r[0]?.doc as never) ?? null;
    },
    async remove(t, tenantId, id) { const r = await sql.unsafe(`delete from ${T(t)} where tenant_id = $1 and id = $2`, [tenantId, id]); return r.count > 0; },
    async findGlobal(t, field, value) {
      const r = await sql.unsafe(`select tenant_id, doc from ${T(t)} where lower(${jpath(field)}) = lower($1) limit 1`, [value]);
      return r[0] ? { tenantId: r[0].tenant_id as string, doc: r[0].doc as never } : null;
    },
    events: {
      async insert(tenantId, rows0) {
        const rows = rows0;
        for (let i = 0; i < rows.length; i += 5000) await insertChunk(rows.slice(i, i + 5000));
        async function insertChunk(rows: typeof rows0) {
        if (!rows.length) return;
        await sql`insert into events ${sql(rows.map((e) => ({ id: e.id, tenant_id: tenantId, session_id: e.sessionId, customer_id: e.customerId ?? null, name: e.name, ts: e.ts, source: e.source ?? null, device: e.device ?? null, props: e.props ? sql.json(e.props as never) : null })) as never)} on conflict (id) do nothing`;
        }
      },
      async list(tenantId, o) {
        const r = await sql`select id, session_id, customer_id, name, ts, source, device, props from events where tenant_id = ${tenantId}
          ${o.since ? sql`and ts >= ${o.since}` : sql``} ${o.until ? sql`and ts <= ${o.until}` : sql``}
          ${o.sessionId ? sql`and session_id = ${o.sessionId}` : sql``} ${o.customerId ? sql`and customer_id = ${o.customerId}` : sql``}
          order by ts asc ${o.limit ? sql`limit ${o.limit}` : sql``}`;
        return r.map((x) => ({ id: x.id, sessionId: x.session_id, customerId: x.customer_id ?? undefined, name: x.name, ts: new Date(x.ts).toISOString(), source: x.source ?? undefined, device: x.device ?? undefined, props: x.props ?? undefined }));
      },
    },
    sales: {
      async insert(tenantId, rows) {
        for (let i = 0; i < rows.length; i += 2000) {
          const chunk = rows.slice(i, i + 2000); if (!chunk.length) continue;
          await sql`insert into sales_lines ${sql(chunk.map((r) => ({ id: r.id, tenant_id: tenantId, file_id: r.fileId, channel: r.channel, is_aggregate: !!r.isAggregate, external_order_id: r.externalOrderId ?? null, ordered_at: r.orderedAt, period_from: r.periodFrom ?? null, customer_key: r.customerKey ?? null, customer_id: r.customerId ?? null, item_raw: r.itemRaw, item_id: r.itemId ?? null, qty: r.qty, unit_price: r.unitPrice ?? null, line_total: r.lineTotal ?? null, discount: r.discount ?? null, order_total: r.orderTotal ?? null, delivery_fee: r.deliveryFee ?? null, status: r.status, district: r.district ?? null, postal_code: r.postalCode ?? null, atypical: !!r.atypical })) as never)} on conflict (id) do nothing`;
        }
      },
      async list(tenantId, q) {
        const r = await sql`select * from sales_lines where ${salesWhere(tenantId, q)} order by ordered_at desc ${q?.limit ? sql`limit ${q.limit}` : sql``}`;
        return r.map((x) => salesRow(x));
      },
      async itemTotals(tenantId, q) {
        const r = await sql`select item_id, min(item_raw) as item_raw, sum(qty) as qty,
            sum(coalesce(line_total, coalesce(unit_price, 0) * qty)) as revenue,
            count(distinct case when external_order_id is not null then channel || ':' || external_order_id end) as orders
          from sales_lines where ${salesWhere(tenantId, q)}
          group by item_id, case when item_id is null then lower(item_raw) end order by revenue desc`;
        return r.map((x) => ({ itemId: (x.item_id as string) ?? null, itemRaw: x.item_raw as string, qty: Number(x.qty), revenue: Math.round(Number(x.revenue) * 100) / 100, orders: Number(x.orders) }));
      },
      async stats(tenantId, q) {
        const r = await sql`with o as (select channel, external_order_id, bool_or(customer_key is not null) as ident from sales_lines where ${salesWhere(tenantId, q)} and external_order_id is not null group by 1, 2)
          select (select count(*) from sales_lines where ${salesWhere(tenantId, q)})::int as lines,
                 (select count(*) from o)::int as orders, (select count(*) from o where ident)::int as identified,
                 (select count(*) from sales_lines where ${salesWhere(tenantId, q)} and is_aggregate)::int as agg,
                 (select min(ordered_at) from sales_lines where ${salesWhere(tenantId, q)}) as first,
                 (select max(ordered_at) from sales_lines where ${salesWhere(tenantId, q)}) as last`;
        const x = r[0];
        return { lines: x.lines, orders: x.orders, identifiedOrders: x.identified, aggregateLines: x.agg, first: iso(x.first), last: iso(x.last) };
      },
      async removeFile(tenantId, fileId) { const r = await sql`delete from sales_lines where tenant_id = ${tenantId} and file_id = ${fileId}`; return r.count; },
      async patch(tenantId, ids, p) {
        if (!ids.length) return 0;
        const set: Record<string, unknown> = {};
        if ("itemId" in p) set.item_id = p.itemId ?? null;
        if ("atypical" in p) set.atypical = !!p.atypical;
        if ("customerId" in p) set.customer_id = p.customerId ?? null;
        if (!Object.keys(set).length) return 0;
        const r = await sql`update sales_lines set ${sql(set as never)} where tenant_id = ${tenantId} and id in ${sql(ids)}`;
        return r.count;
      },
    },
    assignments: {
      async assign(tenantId, row) {
        await sql`insert into assignments (tenant_id, experiment_id, unit_id, arm, ts) values (${tenantId}, ${row.experimentId}, ${row.unitId}, ${row.arm}, ${row.ts}) on conflict do nothing`;
        const r = await sql`select arm, ts from assignments where tenant_id = ${tenantId} and experiment_id = ${row.experimentId} and unit_id = ${row.unitId}`;
        return { experimentId: row.experimentId, unitId: row.unitId, arm: r[0].arm, ts: iso(r[0].ts)! };
      },
      async list(tenantId, experimentId) {
        const r = await sql`select unit_id, arm, ts from assignments where tenant_id = ${tenantId} and experiment_id = ${experimentId} order by ts`;
        return r.map((x) => ({ experimentId, unitId: x.unit_id, arm: x.arm, ts: iso(x.ts)! }));
      },
    },
    metrics: {
      async upsert(tenantId, rows) {
        for (let i = 0; i < rows.length; i += 2000) {
          const chunk = rows.slice(i, i + 2000); if (!chunk.length) continue;
          await sql`insert into metrics_daily ${sql(chunk.map((m) => ({ tenant_id: tenantId, day: m.day, metric: m.metric, segment: m.segment, dim: m.dim, value: m.value })) as never)}
            on conflict (tenant_id, day, metric, segment, dim) do update set value = excluded.value`;
        }
      },
      async list(tenantId, q) {
        const r = await sql`select to_char(day, 'YYYY-MM-DD') as day, metric, segment, dim, value from metrics_daily where tenant_id = ${tenantId}
          ${q.metric ? sql`and metric = ${q.metric}` : sql``} ${q.segment ? sql`and segment = ${q.segment}` : sql``}
          ${q.from ? sql`and day >= ${q.from}` : sql``} ${q.to ? sql`and day <= ${q.to}` : sql``} order by day`;
        return r.map((x) => ({ day: x.day, metric: x.metric, segment: x.segment, dim: x.dim, value: Number(x.value) }));
      },
    },
    async close() { await sql.end(); },
  };
}

export async function migrate(url: string, files: { name: string; sql: string }[]) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  for (const f of files) {
    const done = await sql`select 1 from schema_migrations where name = ${f.name}`;
    if (done.length) continue;
    await sql.begin(async (tx) => { await tx.unsafe(f.sql); await tx`insert into schema_migrations (name) values (${f.name})`; });
    console.log("migração aplicada:", f.name);
  }
  await sql.end();
}
