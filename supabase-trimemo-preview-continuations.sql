-- Nouveau stockage privé ; aucune modification des projets et commandes existants.
create table if not exists public.trimemo_preview_continuations (
  id uuid primary key,
  project_id uuid not null,
  owner_id uuid not null,
  block_id text not null,
  plan_id text not null,
  problematic_id text not null,
  visible_content text not null,
  remainder text not null,
  created_at timestamptz not null default now()
);
alter table public.trimemo_preview_continuations enable row level security;
revoke all on table public.trimemo_preview_continuations from public, anon, authenticated;
grant select, insert on table public.trimemo_preview_continuations to service_role;
