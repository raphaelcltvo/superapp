-- Primeira visita: leads (triagem + contato antes do 1º pedido) e senhas do pagamento online.
do $$
declare t text;
begin
  foreach t in array array['leads','credentials']
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
alter table leads add column if not exists customer_id text generated always as (doc->>'customerId') stored;
create index if not exists leads_customer_idx on leads (tenant_id, customer_id);
