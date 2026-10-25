-- Algoritmo do Superapp: camada 0 (SETUP / Agente S), agentes A–G, orquestrador e ciclo vivo.
-- Mesmo padrão das migrações anteriores: entidades em `doc` (jsonb) com colunas geradas para filtro;
-- fatos de alto volume (vendas importadas, atribuições de teste, métricas diárias) em colunas tipadas.

-- 1) Entidades (documento por linha)
--   setup_runs     rodada de SETUP conduzida pelo Agente S (inventário, degrau, dossiê, liberação)
--   setup_files    cada arquivo recebido no campo livre (canal, tipo, mapeamento, críticas, status)
--   data_requests  pedidos à marca, priorizados por impacto (canal único: o Agente S consolida)
--   agents         estado de cada agente por marca (S, A–G e O = orquestrador): parâmetros, crédito, saúde
--   findings       achados dos checkups (agente, semáforo, evidência, ação proposta, status)
--   experiments    testes do Agente G (alavanca, braços, controle, vencedor)
--   decisions      registro do orquestrador (aplicar, reverter, aprovação humana, disjuntor)
--   profiles       perfis de cliente usados pelo Agente C (contexto, cesta, cluster)
do $$
declare t text;
begin
  foreach t in array array['setup_runs','setup_files','data_requests','agents','findings','experiments','decisions','profiles']
  loop
    execute format('create table if not exists %I (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      doc jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )', t);
    execute format('create index if not exists %I on %I (tenant_id, created_at desc)', t || '_tenant_idx', t);
  end loop;
end $$;

alter table setup_files add column if not exists run_id text generated always as (doc->>'runId') stored;
alter table setup_files add column if not exists status text generated always as (doc->>'status') stored;
create index if not exists setup_files_run_idx on setup_files (tenant_id, run_id);

alter table data_requests add column if not exists status text generated always as (doc->>'status') stored;
create index if not exists data_requests_status_idx on data_requests (tenant_id, status);

alter table findings add column if not exists agent text generated always as (doc->>'agent') stored;
alter table findings add column if not exists status text generated always as (doc->>'status') stored;
alter table findings add column if not exists severity text generated always as (doc->>'severity') stored;
create index if not exists findings_agent_idx on findings (tenant_id, agent, status);
-- um achado aberto por checkup e alvo: o ciclo atualiza em vez de duplicar
alter table findings add column if not exists dedupe_key text generated always as (doc->>'dedupeKey') stored;
create unique index if not exists findings_open_uq on findings (tenant_id, dedupe_key) where status in ('aberto', 'em_teste') and dedupe_key is not null;

alter table experiments add column if not exists status text generated always as (doc->>'status') stored;
create index if not exists experiments_status_idx on experiments (tenant_id, status);

alter table decisions add column if not exists status text generated always as (doc->>'status') stored;
create index if not exists decisions_status_idx on decisions (tenant_id, status);

-- 2) Histórico de vendas item a item vindo de QUALQUER canal (iFood, 99Food, Delivery Direto, PDV...)
--    is_aggregate = linha de relatório agregado ("vendas por item no período"), sem pedido individual.
--    customer_key = chave pseudonimizada (hash do telefone/e-mail); customer_id só para canais próprios.
create table if not exists sales_lines (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
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
create index if not exists sales_lines_tenant_ts on sales_lines (tenant_id, ordered_at desc);
create index if not exists sales_lines_item on sales_lines (tenant_id, item_id);
create index if not exists sales_lines_file on sales_lines (tenant_id, file_id);
create index if not exists sales_lines_order on sales_lines (tenant_id, channel, external_order_id);
create index if not exists sales_lines_customer on sales_lines (tenant_id, customer_key);

-- 3) Atribuição de cada sessão/cliente a um braço de teste (Agente G)
create table if not exists assignments (
  tenant_id text not null references tenants(id) on delete cascade,
  experiment_id text not null,
  unit_id text not null,
  arm text not null,
  ts timestamptz not null default now(),
  primary key (tenant_id, experiment_id, unit_id)
);
create index if not exists assignments_arm on assignments (tenant_id, experiment_id, arm);

-- 4) Métricas diárias do ciclo vivo (cockpit): evasão líquida, vazamentos, conversão por perfil...
--    segment: 'todos' | 'novato' | 'recorrente'; dim: canal, ponto de saída ou agente ('' quando não se aplica)
create table if not exists metrics_daily (
  tenant_id text not null references tenants(id) on delete cascade,
  day date not null,
  metric text not null,
  segment text not null default 'todos',
  dim text not null default '',
  value numeric not null,
  primary key (tenant_id, day, metric, segment, dim)
);
create index if not exists metrics_daily_metric on metrics_daily (tenant_id, metric, day desc);

-- 5) Eventos: busca por nome (mapa de evasão e contrato de eventos)
create index if not exists events_name_ts on events (tenant_id, name, ts desc);
