-- Le verrou, le compteur et les réponses sont mis à jour ensemble par CAS
-- (revision) ; les droits d'accès restent réservés au serveur.
create table if not exists public.trimemo_preview_ledger (
  project_id uuid primary key,
  owner_id uuid not null,
  limit_words integer not null check (limit_words between 1 and 2500),
  used_words integer not null default 0 check (used_words >= 0),
  revision integer not null default 0,
  active_token uuid,
  active_until timestamptz,
  receipts jsonb not null default '{}'::jsonb
);
alter table public.trimemo_preview_ledger enable row level security;
revoke all on table public.trimemo_preview_ledger from public, anon, authenticated;
grant select, insert, update on table public.trimemo_preview_ledger to service_role;
