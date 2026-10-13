-- Exécuter une seule fois dans Supabase SQL Editor.
create table if not exists public.trimemo_project_state (
  project_id uuid primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists trimemo_project_state_expires_at_idx
  on public.trimemo_project_state (expires_at);

alter table public.trimemo_project_state enable row level security;
-- Aucun accès direct anon/authenticated : toutes les opérations passent par l'API Vercel
-- avec SUPABASE_SERVICE_ROLE_KEY, conservée uniquement côté serveur.
revoke all on public.trimemo_project_state from anon, authenticated;
