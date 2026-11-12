-- Preparation only: apply in an isolated test database after integration.
-- A single unresolved attempt per project must be shared by both providers.
create table public.trimemo_payment_intents (
  reference text primary key check (reference ~ '^[A-Za-z0-9_-]{10,100}$'),
  project_id text not null check (length(project_id) between 1 and 200),
  user_id uuid not null,
  provider text not null check (provider in ('fedapay', 'paypal')),
  provider_id text,
  amount numeric(15,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  state text not null default 'creating' check (state in ('creating', 'ready', 'paid', 'closed')),
  project_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id)
);
-- Creating covers uncertain network errors; paid remains locked. No timer
-- releases a potentially paid attempt without provider reconciliation.
create unique index trimemo_payment_intents_one_open_per_project
  on public.trimemo_payment_intents(project_id)
  where state in ('creating', 'ready', 'paid');
create index trimemo_payment_intents_owner_idx on public.trimemo_payment_intents(user_id, project_id);
alter table public.trimemo_payment_intents enable row level security;
revoke all on table public.trimemo_payment_intents from public, anon, authenticated;
grant select, insert, update on table public.trimemo_payment_intents to service_role;
