import postgres from "postgres";
import type { Db, Doc, ListOpts, Table } from "./types";

const ident = (s: string) => { if (!/^[a-zA-Z0-9_.]+$/.test(s)) throw new Error("campo inválido: " + s); return s; };
/** caminho "a.b" -> doc->'a'->>'b' */
const jpath = (f: string) => { const p = ident(f).split("."); return p.length === 1 ? `doc->>'${p[0]}'` : `doc->${p.slice(0, -1).map((x) => `'${x}'`).join("->")}->>'${p[p.length - 1]}'`; };

export function postgresDb(url: string): Db {
  const sql = postgres(url, { max: 10, idle_timeout: 20, prepare: false, onnotice: () => {} });
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
