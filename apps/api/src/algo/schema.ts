/**
 * Esquema próprio do algoritmo (`algo`), separado das tabelas do cardápio/CRM (`public`).
 * Pode morar no mesmo banco (padrão) ou em outro (ALGO_DATABASE_URL): por isso não há chave estrangeira
 * para `public.tenants` — a ligação com a marca é pelo `tenant_id`.
 * Cada versão roda uma única vez e fica registrada em `algo.schema_migrations`.
 */
export const ALGO_SCHEMA = "algo";

export const ALGO_MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_algoritmo",
    sql: `
-- Entidades em documento (mesmo padrão do restante da API)
--   setup_runs     rodada de SETUP conduzida pelo Agente S (inventário, degrau, dossiê, liberação)
--   setup_files    cada arquivo do campo livre (canal, tipo, de-para, críticas, status)
--   data_requests  pedidos à marca priorizados por impacto (o Agente S é o canal único)
--   agents         estado de cada agente por marca (S, A–G e O = orquestrador)
--   findings       achados dos checkups
--   experiments    testes do Agente G
--   decisions      registro do orquestrador e fila de aprovação humana
--   profiles       perfis de cliente (Agente C)
--   item_costs     custo (CMV) por item do cardápio, mantido pelo algoritmo
do $$
declare t text;
begin
  foreach t in array array['setup_runs','setup_files','data_requests','agents','findings','experiments','decisions','profiles','item_costs']
  loop
    execute format('create table if not exists algo.%I (
      id text not null,
      tenant_id text not null,
      doc jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (tenant_id, id)
    )', t);
    execute format('create index if not exists %I on algo.%I (tenant_id, created_at desc)', t || '_tenant_idx', t);
  end loop;
end $$;

create index if not exists setup_files_run_idx on algo.setup_files (tenant_id, (doc->>'runId'));
create index if not exists data_requests_status_idx on algo.data_requests (tenant_id, (doc->>'status'));
create index if not exists findings_agent_idx on algo.findings (tenant_id, (doc->>'agent'), (doc->>'status'));
create index if not exists findings_dedupe_idx on algo.findings (tenant_id, (doc->>'dedupeKey'));
create index if not exists experiments_status_idx on algo.experiments (tenant_id, (doc->>'status'));
create index if not exists decisions_status_idx on algo.decisions (tenant_id, (doc->>'status'));

-- Histórico de vendas item a item de QUALQUER canal (iFood, 99Food, Delivery Direto, PDV...)
create table if not exists algo.sales_lines (
  id text primary key,
  tenant_id text not null,
  file_id text not null,
  channel text not null,
  is_aggregate boolean not null default false,
  external_order_id text,
  ordered_at timestamptz not null,
  period_from timestamptz,
  customer_key text,
  customer_id text,
  item_raw text not null,
  item_id text,
  qty numeric(12,3) not null default 1,
  unit_price numeric(12,2),
  line_total numeric(12,2),
  discount numeric(12,2),
  order_total numeric(12,2),
  delivery_fee numeric(12,2),
  status text not null default 'concluido',
  district text,
  postal_code text,
  atypical boolean not null default false
);
create index if not exists sales_lines_tenant_ts on algo.sales_lines (tenant_id, ordered_at desc);
create index if not exists sales_lines_item on algo.sales_lines (tenant_id, item_id);
create index if not exists sales_lines_file on algo.sales_lines (tenant_id, file_id);
create index if not exists sales_lines_order on algo.sales_lines (tenant_id, channel, external_order_id);
create index if not exists sales_lines_customer on algo.sales_lines (tenant_id, customer_key);

-- Sorteio fixo de cada sessão/cliente num braço de teste (Agente G)
create table if not exists algo.assignments (
  tenant_id text not null,
  experiment_id text not null,
  unit_id text not null,
  arm text not null,
  ts timestamptz not null default now(),
  primary key (tenant_id, experiment_id, unit_id)
);

-- Métricas diárias do ciclo vivo (cockpit)
create table if not exists algo.metrics_daily (
  tenant_id text not null,
  day date not null,
  metric text not null,
  segment text not null default 'todos',
  dim text not null default '',
  value numeric not null,
  primary key (tenant_id, day, metric, segment, dim)
);
create index if not exists metrics_daily_metric on algo.metrics_daily (tenant_id, metric, day desc);
`,
  },
];
