-- Run once in the Supabase SQL editor before enabling premium payment/export.
create table if not exists public.trimemo_orders (
  order_id text primary key,
  project_id text not null,
  project_fingerprint text not null,
  status text not null check (status in ('pending','paid','consumed','refunded')),
  amount text not null,
  currency text not null,
  capture_id text,
  project_snapshot jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  consumed_at timestamptz,
  refund_status text,
  refunded_at timestamptz,
  refund_id text,
  refund_amount text,
  updated_at timestamptz not null default now()
);
create index if not exists trimemo_orders_project_id_idx on public.trimemo_orders(project_id);
-- Idempotent migration for an existing table created by an earlier version.
alter table public.trimemo_orders add column if not exists project_snapshot jsonb;
alter table public.trimemo_orders add column if not exists created_at timestamptz not null default now();
alter table public.trimemo_orders add column if not exists refund_status text;
alter table public.trimemo_orders add column if not exists refunded_at timestamptz;
alter table public.trimemo_orders add column if not exists refund_id text;
alter table public.trimemo_orders add column if not exists refund_amount text;
alter table public.trimemo_orders add column if not exists updated_at timestamptz not null default now();
alter table public.trimemo_orders alter column paid_at drop not null;
alter table public.trimemo_orders drop constraint if exists trimemo_orders_status_check;
alter table public.trimemo_orders add constraint trimemo_orders_status_check check (status in ('pending','paid','consumed','refunded'));
alter table public.trimemo_orders enable row level security;
-- No client policies: only the backend service-role key may access this table.


-- Private project-file cache. Files and extracted guide text are retained for up to 30 days.
create table if not exists public.trimemo_project_files (
  project_id text primary key,
  files jsonb not null default '[]'::jsonb,
  file_metadata jsonb not null default '[]'::jsonb,
  document_context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists trimemo_project_files_expires_at_idx on public.trimemo_project_files(expires_at);
alter table public.trimemo_project_files enable row level security;
-- No anon/authenticated policies: service-role access is server-only.


create or replace function public.cleanup_expired_trimemo_project_files()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from public.trimemo_project_files where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.cleanup_expired_trimemo_project_files() from public, anon, authenticated;
