export const TABLES = ["users", "api_keys", "stores", "categories", "items", "option_groups", "strategies", "coupons", "banners", "pages", "page_responses", "settings", "segments", "automations", "messages", "imports", "integrations", "menu_versions", "media", "webhooks", "ledger", "customers", "orders", "message_templates", "campaigns", "inbox", "leads", "credentials", "setup_runs", "setup_files", "data_requests", "agents", "findings", "experiments", "decisions", "profiles"] as const;
export type Table = (typeof TABLES)[number];

export interface Doc { id: string }
export interface Tenantish { id: string; slug: string; [k: string]: unknown }

export interface ListOpts {
  /** igualdade em campos do documento (ex.: { categoryId: "x", active: true }) */
  where?: Record<string, string | number | boolean | null>;
  orderBy?: { field: string; dir?: "asc" | "desc" };
  limit?: number;
  offset?: number;
  /** created_at >= since */
  since?: string;
  until?: string;
}

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

export interface EventRow { id: string; sessionId: string; customerId?: string; name: string; ts: string; source?: string; device?: string; props?: Record<string, unknown> }

/** Contrato único de persistência: Postgres em produção, memória no modo demonstração e nos testes. */
export interface Db {
  kind: "postgres" | "memory";
  tenants: {
    get(id: string): Promise<Tenantish | null>;
    bySlug(slug: string): Promise<Tenantish | null>;
    list(): Promise<Tenantish[]>;
    put(t: Tenantish): Promise<Tenantish>;
  };
  get<T extends Doc>(table: Table, tenantId: string, id: string): Promise<T | null>;
  list<T extends Doc>(table: Table, tenantId: string, opts?: ListOpts): Promise<T[]>;
  count(table: Table, tenantId: string, opts?: ListOpts): Promise<number>;
  put<T extends Doc>(table: Table, tenantId: string, doc: T): Promise<T>; // insert ou replace
  patch<T extends Doc = Doc>(table: Table, tenantId: string, id: string, patch: Record<string, unknown>): Promise<T | null>;
  remove(table: Table, tenantId: string, id: string): Promise<boolean>;
  /** busca global (sem tenant) — usada para login e chaves de API */
  findGlobal<T extends Doc>(table: "users" | "api_keys", field: string, value: string): Promise<{ tenantId: string; doc: T } | null>;
  events: {
    insert(tenantId: string, rows: EventRow[]): Promise<void>;
    list(tenantId: string, opts: { since?: string; until?: string; sessionId?: string; customerId?: string; limit?: number }): Promise<EventRow[]>;
  };
  /** histórico de vendas importado (Agente S) */
  sales: {
    insert(tenantId: string, rows: SalesLineRow[]): Promise<void>;
    list(tenantId: string, q?: SalesQuery): Promise<SalesLineRow[]>;
    /** soma por item (agregados entram com a quantidade e a receita informadas) */
    itemTotals(tenantId: string, q?: SalesQuery): Promise<ItemTotal[]>;
    /** quantas linhas, pedidos distintos, % identificados e período coberto */
    stats(tenantId: string, q?: SalesQuery): Promise<{ lines: number; orders: number; identifiedOrders: number; aggregateLines: number; first?: string; last?: string }>;
    removeFile(tenantId: string, fileId: string): Promise<number>;
    patch(tenantId: string, ids: string[], p: Partial<Pick<SalesLineRow, "itemId" | "atypical" | "customerId">>): Promise<number>;
  };
  /** atribuição de sessões/clientes a braços de teste (Agente G) */
  assignments: {
    /** grava se ainda não existir e devolve o braço vigente da unidade */
    assign(tenantId: string, row: AssignmentRow): Promise<AssignmentRow>;
    list(tenantId: string, experimentId: string): Promise<AssignmentRow[]>;
  };
  /** métricas diárias do ciclo vivo */
  metrics: {
    upsert(tenantId: string, rows: MetricRow[]): Promise<void>;
    list(tenantId: string, q: { metric?: string; segment?: string; from?: string; to?: string }): Promise<MetricRow[]>;
  };
  close?(): Promise<void>;
}
