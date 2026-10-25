/**
 * Banco do algoritmo, separado do banco do cardápio/CRM.
 * - Postgres: esquema próprio `algo` (mesmo banco por padrão, ou outro via ALGO_DATABASE_URL), conexão própria.
 * - Memória: demonstração e testes.
 * O algoritmo só LÊ as tabelas do cardápio/CRM pelo `deps.db` e escreve aqui.
 */
import type { Deps } from "../deps";

export const ALGO_TABLES = ["setup_runs", "setup_files", "data_requests", "agents", "findings", "experiments", "decisions", "profiles", "item_costs"] as const;
export type AlgoTable = (typeof ALGO_TABLES)[number];
export interface Doc { id: string }
export interface AlgoListOpts { where?: Record<string, string | number | boolean | null>; limit?: number }

/** Linha de venda importada de qualquer canal (item a item, ou agregada por período). */
export interface SalesLineRow {
  id: string; fileId: string; channel: string; isAggregate?: boolean; externalOrderId?: string;
  orderedAt: string; periodFrom?: string; customerKey?: string; customerId?: string;
  itemRaw: string; itemId?: string; qty: number; unitPrice?: number; lineTotal?: number; discount?: number;
  orderTotal?: number; deliveryFee?: number; status: "concluido" | "cancelado"; district?: string; postalCode?: string; atypical?: boolean;
}
export interface SalesQuery { from?: string; to?: string; channel?: string; fileId?: string; itemId?: string | null; includeCancelled?: boolean; limit?: number }
export interface ItemTotal { itemId: string | null; itemRaw: string; qty: number; revenue: number; orders: number }
export interface AssignmentRow { experimentId: string; unitId: string; arm: string; ts: string }
export interface MetricRow { day: string; metric: string; segment: string; dim: string; value: number }

export interface AlgoDb {
  kind: "postgres" | "memory";
  get<T extends Doc>(t: AlgoTable, tenantId: string, id: string): Promise<T | null>;
  list<T extends Doc>(t: AlgoTable, tenantId: string, o?: AlgoListOpts): Promise<T[]>;
  put<T extends Doc>(t: AlgoTable, tenantId: string, doc: T): Promise<T>;
  patch<T extends Doc = Doc>(t: AlgoTable, tenantId: string, id: string, p: Record<string, unknown>): Promise<T | null>;
  remove(t: AlgoTable, tenantId: string, id: string): Promise<boolean>;
  sales: {
    insert(tenantId: string, rows: SalesLineRow[]): Promise<void>;
    list(tenantId: string, q?: SalesQuery): Promise<SalesLineRow[]>;
    itemTotals(tenantId: string, q?: SalesQuery): Promise<ItemTotal[]>;
    stats(tenantId: string, q?: SalesQuery): Promise<{ lines: number; orders: number; identifiedOrders: number; aggregateLines: number; first?: string; last?: string }>;
    removeFile(tenantId: string, fileId: string): Promise<number>;
    patch(tenantId: string, ids: string[], p: Partial<Pick<SalesLineRow, "itemId" | "atypical" | "customerId">>): Promise<number>;
  };
  assignments: {
    assign(tenantId: string, row: AssignmentRow): Promise<AssignmentRow>;
    list(tenantId: string, experimentId: string): Promise<AssignmentRow[]>;
  };
  metrics: {
    upsert(tenantId: string, rows: MetricRow[]): Promise<void>;
    list(tenantId: string, q: { metric?: string; segment?: string; from?: string; to?: string }): Promise<MetricRow[]>;
  };
  close?(): Promise<void>;
}

/* ---------------- ligação com a API (sem alterar o Deps compartilhado) ---------------- */
const registry = new WeakMap<object, AlgoDb>();
/** Usa um banco do algoritmo específico para estes deps (testes, ou servidor com outra conexão). */
export function registerAlgoDb(deps: Deps, db: AlgoDb) { registry.set(deps, db); return db; }
/** Banco do algoritmo destes deps: o registrado; senão Postgres se houver ALGO_DATABASE_URL/DATABASE_URL e o banco principal for Postgres; senão memória. */
export function algoDbOf(deps: Deps): AlgoDb {
  const hit = registry.get(deps); if (hit) return hit;
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const url = env.ALGO_DATABASE_URL || (deps.db.kind === "postgres" ? env.DATABASE_URL : undefined);
  return registerAlgoDb(deps, url ? lazyPostgresAlgoDb(url) : memoryAlgoDb());
}

/* ---------------- memória ---------------- */
const getPath = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), o);
function salesFilter(rows: SalesLineRow[], q: SalesQuery = {}) {
  return rows.filter((r) => (q.includeCancelled || r.status !== "cancelado")
    && (!q.from || r.orderedAt >= q.from) && (!q.to || r.orderedAt <= q.to)
    && (!q.channel || r.channel === q.channel) && (!q.fileId || r.fileId === q.fileId)
    && (q.itemId === undefined || (q.itemId === null ? !r.itemId : r.itemId === q.itemId)));
}
const orderKey = (r: SalesLineRow) => (r.externalOrderId ? `${r.channel}:${r.externalOrderId}` : null);

export function memoryAlgoDb(): AlgoDb {
  type Row = { tenantId: string; doc: Doc; createdAt: string };
  const rows: Record<string, Row[]> = {}; const sales: Record<string, SalesLineRow[]> = {};
  const asg: Record<string, AssignmentRow[]> = {}; const met: Record<string, MetricRow[]> = {};
  const tbl = (t: AlgoTable) => (rows[t] ||= []);
  const S = (t: string) => (sales[t] ||= []);
  const clone = <T>(x: T) => structuredClone(x);
  const match = (r: Row, tenantId: string, o?: AlgoListOpts) => r.tenantId === tenantId && Object.entries(o?.where || {}).every(([k, v]) => (v === null ? getPath(r.doc, k) == null : String(getPath(r.doc, k)) === String(v)));
  return {
    kind: "memory",
    async get(t, tenantId, id) { const r = tbl(t).find((x) => x.tenantId === tenantId && x.doc.id === id); return r ? (clone(r.doc) as never) : null; },
    async list(t, tenantId, o) { const r = tbl(t).filter((x) => match(x, tenantId, o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return clone((o?.limit ? r.slice(0, o.limit) : r).map((x) => x.doc)) as never; },
    async put(t, tenantId, doc) {
      const list = tbl(t); const i = list.findIndex((x) => x.tenantId === tenantId && x.doc.id === doc.id);
      const createdAt = (doc as { createdAt?: string }).createdAt || (i >= 0 ? list[i].createdAt : new Date().toISOString());
      const row = { tenantId, doc: clone(doc), createdAt }; if (i >= 0) list[i] = row; else list.push(row); return doc;
    },
    async patch(t, tenantId, id, p) { const r = tbl(t).find((x) => x.tenantId === tenantId && x.doc.id === id); if (!r) return null; r.doc = { ...r.doc, ...clone(p), id }; return clone(r.doc) as never; },
    async remove(t, tenantId, id) { const l = tbl(t); const i = l.findIndex((x) => x.tenantId === tenantId && x.doc.id === id); if (i < 0) return false; l.splice(i, 1); return true; },
    sales: {
      async insert(t, rs) { const ex = new Set(S(t).map((r) => r.id)); S(t).push(...clone(rs.filter((r) => !ex.has(r.id)))); },
      async list(t, q) { const r = salesFilter(S(t), q).sort((a, b) => b.orderedAt.localeCompare(a.orderedAt)); return clone(q?.limit ? r.slice(0, q.limit) : r); },
      async itemTotals(t, q) {
        const m = new Map<string, ItemTotal & { set: Set<string> }>();
        for (const r of salesFilter(S(t), q)) {
          const k = r.itemId || "raw:" + r.itemRaw.toLowerCase();
          const x = m.get(k) || { itemId: r.itemId || null, itemRaw: r.itemRaw, qty: 0, revenue: 0, orders: 0, set: new Set<string>() };
          x.qty += Number(r.qty) || 0; x.revenue += Number(r.lineTotal ?? (r.unitPrice ?? 0) * (r.qty || 0)) || 0;
          const ok = orderKey(r); if (ok) x.set.add(ok); m.set(k, x);
        }
        return [...m.values()].map(({ set, ...x }) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100, orders: set.size })).sort((a, b) => b.revenue - a.revenue);
      },
      async stats(t, q) {
        const r = salesFilter(S(t), q); const orders = new Map<string, boolean>();
        for (const x of r) { const k = orderKey(x); if (k) orders.set(k, orders.get(k) || !!x.customerKey); }
        const ts = r.map((x) => x.orderedAt).sort();
        return { lines: r.length, orders: orders.size, identifiedOrders: [...orders.values()].filter(Boolean).length, aggregateLines: r.filter((x) => x.isAggregate).length, first: ts[0], last: ts[ts.length - 1] };
      },
      async removeFile(t, fileId) { const before = S(t).length; sales[t] = S(t).filter((r) => r.fileId !== fileId); return before - sales[t].length; },
      async patch(t, ids, p) { const set = new Set(ids); let n = 0; for (const r of S(t)) if (set.has(r.id)) { Object.assign(r, clone(p)); n++; } return n; },
    },
    assignments: {
      async assign(t, row) { const l = (asg[t] ||= []); const cur = l.find((a) => a.experimentId === row.experimentId && a.unitId === row.unitId); if (cur) return clone(cur); l.push(clone(row)); return row; },
      async list(t, experimentId) { return clone((asg[t] || []).filter((a) => a.experimentId === experimentId)); },
    },
    metrics: {
      async upsert(t, rs) { const l = (met[t] ||= []); for (const r of rs) { const i = l.findIndex((m) => m.day === r.day && m.metric === r.metric && m.segment === r.segment && m.dim === r.dim); if (i >= 0) l[i] = clone(r); else l.push(clone(r)); } },
      async list(t, q) { return clone((met[t] || []).filter((m) => (!q.metric || m.metric === q.metric) && (!q.segment || m.segment === q.segment) && (!q.from || m.day >= q.from) && (!q.to || m.day <= q.to)).sort((a, b) => a.day.localeCompare(b.day))); },
    },
  };
}

/* ---------------- Postgres: carregado só no servidor ---------------- */
/**
 * O driver Postgres não roda no navegador (demonstração). Por isso a implementação fica em
 * db-postgres.ts e só é carregada quando há uma URL de banco — o empacotador da demo nunca a enxerga.
 */
function lazyPostgresAlgoDb(url: string): AlgoDb {
  let real: Promise<AlgoDb> | undefined;
  const load = () => (real ||= import(/* @vite-ignore */ new URL("./db-postgres.ts", import.meta.url).href).then((m: { postgresAlgoDb(u: string): AlgoDb }) => m.postgresAlgoDb(url)));
  const call = (path: string[]) => async (...args: unknown[]) => { let o: any = await load(); for (const k of path.slice(0, -1)) o = o[k]; return o[path[path.length - 1]](...args); };
  const group = (g: string, fns: string[]) => Object.fromEntries(fns.map((f) => [f, call([g, f])]));
  return {
    kind: "postgres",
    get: call(["get"]) as AlgoDb["get"], list: call(["list"]) as AlgoDb["list"], put: call(["put"]) as AlgoDb["put"], patch: call(["patch"]) as AlgoDb["patch"], remove: call(["remove"]) as AlgoDb["remove"],
    sales: group("sales", ["insert", "list", "itemTotals", "stats", "removeFile", "patch"]) as AlgoDb["sales"],
    assignments: group("assignments", ["assign", "list"]) as AlgoDb["assignments"],
    metrics: group("metrics", ["upsert", "list"]) as AlgoDb["metrics"],
    async close() { if (real) await (await real).close?.(); },
  };
}
