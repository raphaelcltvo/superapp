import type { AssignmentRow, Db, Doc, EventRow, ItemTotal, ListOpts, MetricRow, SalesLineRow, SalesQuery, Table, Tenantish } from "./types";

type Row = { tenantId: string; doc: Doc; createdAt: string; updatedAt: string };
export interface MemorySnapshot { tenants: Tenantish[]; rows: Record<string, Row[]>; events: Record<string, EventRow[]>; sales?: Record<string, SalesLineRow[]>; assignments?: Record<string, AssignmentRow[]>; metrics?: Record<string, MetricRow[]> }

const get = (o: Doc, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), o as unknown);

function filter(rows: Row[], o?: ListOpts) {
  let r = rows;
  if (o?.where) for (const [k, v] of Object.entries(o.where)) r = r.filter((x) => (v === null ? get(x.doc, k) == null : String(get(x.doc, k)) === String(v)));
  if (o?.since) r = r.filter((x) => x.createdAt >= o.since!);
  if (o?.until) r = r.filter((x) => x.createdAt <= o.until!);
  return r;
}

function salesFilter(rows: SalesLineRow[], q: SalesQuery = {}) {
  return rows.filter((r) => (q.includeCancelled || r.status !== "cancelado")
    && (!q.from || r.orderedAt >= q.from) && (!q.to || r.orderedAt <= q.to)
    && (!q.channel || r.channel === q.channel) && (!q.fileId || r.fileId === q.fileId)
    && (q.itemId === undefined || (q.itemId === null ? !r.itemId : r.itemId === q.itemId)));
}
const orderKey = (r: SalesLineRow) => r.externalOrderId ? `${r.channel}:${r.externalOrderId}` : null;

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
    sales: undefined as never, assignments: undefined as never, metrics: undefined as never,
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
  const sales = (t: string) => ((S.sales ||= {})[t] ||= []);
  const asg = (t: string) => ((S.assignments ||= {})[t] ||= []);
  const met = (t: string) => ((S.metrics ||= {})[t] ||= []);
  db.sales = {
    async insert(t, rows) { const ex = new Set(sales(t).map((r) => r.id)); sales(t).push(...clone(rows.filter((r) => !ex.has(r.id)))); changed(); },
    async list(t, q) { const r = salesFilter(sales(t), q).sort((a, b) => b.orderedAt.localeCompare(a.orderedAt)); return clone(q?.limit ? r.slice(0, q.limit) : r); },
    async itemTotals(t, q) {
      const m = new Map<string, ItemTotal & { set: Set<string> }>();
      for (const r of salesFilter(sales(t), q)) {
        const k = r.itemId || "raw:" + r.itemRaw.toLowerCase();
        const x = m.get(k) || { itemId: r.itemId || null, itemRaw: r.itemRaw, qty: 0, revenue: 0, orders: 0, set: new Set<string>() };
        x.qty += Number(r.qty) || 0; x.revenue += Number(r.lineTotal ?? (r.unitPrice ?? 0) * (r.qty || 0)) || 0;
        const ok = orderKey(r); if (ok) x.set.add(ok); m.set(k, x);
      }
      return [...m.values()].map(({ set, ...x }) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100, orders: set.size })).sort((a, b) => b.revenue - a.revenue);
    },
    async stats(t, q) {
      const r = salesFilter(sales(t), q); const orders = new Map<string, boolean>();
      for (const x of r) { const k = orderKey(x); if (k) orders.set(k, orders.get(k) || !!x.customerKey); }
      const ts = r.map((x) => x.orderedAt).sort();
      return { lines: r.length, orders: orders.size, identifiedOrders: [...orders.values()].filter(Boolean).length, aggregateLines: r.filter((x) => x.isAggregate).length, first: ts[0], last: ts[ts.length - 1] };
    },
    async removeFile(t, fileId) { const before = sales(t).length; (S.sales ||= {})[t] = sales(t).filter((r) => r.fileId !== fileId); changed(); return before - sales(t).length; },
    async patch(t, ids, p) { const set = new Set(ids); let n = 0; for (const r of sales(t)) if (set.has(r.id)) { Object.assign(r, clone(p)); n++; } changed(); return n; },
  };
  db.assignments = {
    async assign(t, row) { const cur = asg(t).find((a) => a.experimentId === row.experimentId && a.unitId === row.unitId); if (cur) return clone(cur); asg(t).push(clone(row)); changed(); return row; },
    async list(t, experimentId) { return clone(asg(t).filter((a) => a.experimentId === experimentId)); },
  };
  db.metrics = {
    async upsert(t, rows) { for (const r of rows) { const i = met(t).findIndex((m) => m.day === r.day && m.metric === r.metric && m.segment === r.segment && m.dim === r.dim); if (i >= 0) met(t)[i] = clone(r); else met(t).push(clone(r)); } changed(); },
    async list(t, q) { return clone(met(t).filter((m) => (!q.metric || m.metric === q.metric) && (!q.segment || m.segment === q.segment) && (!q.from || m.day >= q.from) && (!q.to || m.day <= q.to)).sort((a, b) => a.day.localeCompare(b.day))); },
  };
  (db as Db & { snapshot(): MemorySnapshot }).snapshot = () => clone(S);
  return db;
}
