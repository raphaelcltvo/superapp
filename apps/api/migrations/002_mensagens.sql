-- Mensagens: modelos (WhatsApp/e-mail), campanhas e caixa de entrada do WhatsApp.
do $$
declare t text;
begin
  foreach t in array array['message_templates','campaigns','inbox']
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
alter table messages add column if not exists campaign_id text generated always as (doc->>'campaignId') stored;
alter table messages add column if not exists customer_id text generated always as (doc->>'customerId') stored;
create index if not exists messages_campaign_idx on messages (tenant_id, campaign_id);
create index if not exists messages_customer_idx on messages (tenant_id, customer_id);
alter table customers add column if not exists email text generated always as (lower(doc->>'email')) stored;
create index if not exists customers_email_idx on customers (tenant_id, email);
