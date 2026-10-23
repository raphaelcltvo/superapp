-- Superapp: cardápio whitelabel multi-marca.
-- Cada entidade guarda o documento completo em `doc` (jsonb) e expõe colunas geradas para busca e índices.
create table if not exists tenants (
  id text primary key,
  slug text unique not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['users','api_keys','stores','categories','items','option_groups','strategies','coupons','banners','pages','page_responses','settings','segments','automations','messages','imports','integrations','menu_versions','media','webhooks','ledger','customers','orders']
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

-- índices de negócio
alter table customers add column if not exists phone text generated always as (doc->>'phone') stored;
create unique index if not exists customers_phone_uq on customers (tenant_id, phone) where phone is not null;
alter table orders add column if not exists customer_id text generated always as (doc->>'customerId') stored;
alter table orders add column if not exists status text generated always as (doc->>'status') stored;
create index if not exists orders_customer_idx on orders (tenant_id, customer_id);
alter table ledger add column if not exists customer_id text generated always as (doc->>'customerId') stored;
create index if not exists ledger_customer_idx on ledger (tenant_id, customer_id);
alter table users add column if not exists email text generated always as (lower(doc->>'email')) stored;
create unique index if not exists users_email_uq on users (email);
alter table api_keys add column if not exists key_hash text generated always as (doc->>'keyHash') stored;
create unique index if not exists api_keys_hash_uq on api_keys (key_hash);
create index if not exists items_category_idx on items (tenant_id, (doc->>'categoryId'));
create index if not exists banners_slot_idx on banners (tenant_id, (doc->>'slot'));
create unique index if not exists pages_slug_uq on pages (tenant_id, (doc->>'slug'));

-- eventos de navegação (alto volume): colunas tipadas
create table if not exists events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  session_id text not null,
  customer_id text,
  name text not null,
  ts timestamptz not null,
  source text,
  device text,
  props jsonb
);
create index if not exists events_tenant_ts on events (tenant_id, ts desc);
create index if not exists events_session on events (tenant_id, session_id);

create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());
