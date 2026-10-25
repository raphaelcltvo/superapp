export const TABLES = ["users", "api_keys", "stores", "categories", "items", "option_groups", "strategies", "coupons", "banners", "pages", "page_responses", "settings", "segments", "automations", "messages", "imports", "integrations", "menu_versions", "media", "webhooks", "ledger", "customers", "orders", "message_templates", "campaigns", "inbox", "leads", "credentials"] as const;
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
  close?(): Promise<void>;
}
