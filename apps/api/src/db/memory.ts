import type { Db, Doc, EventRow, ListOpts, Table, Tenantish } from "./types";

type Row = { tenantId: string; doc: Doc; createdAt: string; updatedAt: string };
export interface MemorySnapshot { tenants: Tenantish[]; rows: Record<string, Row[]>; events: Record<string, EventRow[]> }

const get = (o: Doc, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), o as unknown);

function filter(rows: Row[], o?: ListOpts) {
  let r = rows;
  if (o?.where) for (const [k, v] of Object.entries(o.where)) r = r.filter((x) => (v === null ? get(x.doc, k) == null : String(get(x.doc, k)) === String(v)));
  if (o?.since) r = r.filter((x) => x.createdAt >= o.since!);
  if (o?.until) r = r.filter((x) => x.createdAt <= o.until!);
  return r;
}

/** Banco em memória com snapshot serializável (persistência opcional no navegador). */
export function memoryDb(initial?: MemorySnapshot, onChange?: (s: MemorySnapshot) => void): Db {
  const S: MemorySnapshot = initial ? structuredClone(initial) : { tenants: [], rows: {}, events: {} };
  const tbl = (t: Table) => (S.rows[t] ||= []);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => { if (!onChange) return; clearTimeout(timer); timer = setTimeout(() => onChange(S), 150); };
  const now = () => new Date().toISOString();
  const clone = <T>(x: T) => structuredClone(x);
  const db: Db = {
    kind: "memory",
    tenants: {
      async get(id) { return clone(S.tenants.find((t) => t.id === id) || null); },
      async bySlug(slug) { return clone(S.tenants.find((t) => t.slug === slug) || null); },
      async list() { return clone(S.tenants); },
      async put(t) { const i = S.tenants.findIndex((x) => x.id === t.id); if (i >= 0) S.tenants[i] = clone(t); else S.tenants.push(clone(t)); changed(); return t; },
    },
    async get(t, tenantId, id) { const r = tbl(t).find((x) => x.tenantId === tenantId && x.doc.id === id); return r ? clone(r.doc) as never : null; },
    async list(t, tenantId, o) {
      let r = filter(tbl(t).filter((x) => x.tenantId === tenantId), o);
      if (o?.orderBy) { const { field, dir } = o.orderBy; r = [...r].sort((a, b) => { const va = field === "createdAt" ? a.createdAt : get(a.doc, field), vb = field === "createdAt" ? b.createdAt : get(b.doc, field); const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? "")); return dir === "desc" ? -c : c; }); }
      else r = [...r].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (o?.offset) r = r.slice(o.offset);
      if (o?.limit) r = r.slice(0, o.limit);
      return clone(r.map((x) => x.doc)) as never;
    },
    async count(t, tenantId, o) { return filter(tbl(t).filter((x) => x.tenantId === tenantId), o).length; },
    async put(t, tenantId, doc) {
      const rows = tbl(t); const i = rows.findIndex((x) => x.tenantId === tenantId && x.doc.id === doc.id);
      const createdAt = (doc as { createdAt?: string }).createdAt || (i >= 0 ? rows[i].createdAt : now());
      const row = { tenantId, doc: clone(doc), createdAt, updatedAt: now() };
      if (i >= 0) rows[i] = row; else rows.push(row);
      changed(); return doc;
    },
    async patch(t, tenantId, id, p) {
      const r = tbl(t).find((x) => x.tenantId === tenantId && x.doc.id === id); if (!r) return null;
      r.doc = { ...r.doc, ...clone(p), id }; r.updatedAt = now(); changed(); return clone(r.doc) as never;
    },
    async remove(t, tenantId, id) { const rows = tbl(t); const i = rows.findIndex((x) => x.tenantId === tenantId && x.doc.id === id); if (i < 0) return false; rows.splice(i, 1); changed(); return true; },
    async findGlobal(t, field, value) { const r = tbl(t).find((x) => String(get(x.doc, field)).toLowerCase() === value.toLowerCase()); return r ? { tenantId: r.tenantId, doc: clone(r.doc) as never } : null; },
    events: {
      async insert(tenantId, rows) { (S.events[tenantId] ||= []).push(...clone(rows)); changed(); },
      async list(tenantId, o) {
        let r = S.events[tenantId] || [];
        if (o.since) r = r.filter((e) => e.ts >= o.since!);
        if (o.until) r = r.filter((e) => e.ts <= o.until!);
        if (o.sessionId) r = r.filter((e) => e.sessionId === o.sessionId);
        if (o.customerId) r = r.filter((e) => e.customerId === o.customerId);
        r = [...r].sort((a, b) => a.ts.localeCompare(b.ts));
        return clone(o.limit ? r.slice(-o.limit) : r);
      },
    },
  };
  (db as Db & { snapshot(): MemorySnapshot }).snapshot = () => clone(S);
  return db;
}
