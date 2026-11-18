create table if not exists public.trimemo_owner_projects (project_id uuid primary key,subject text not null,state jsonb not null,updated_at timestamptz not null default now());
alter table public.trimemo_owner_projects enable row level security;
revoke all on public.trimemo_owner_projects from anon, authenticated;
grant all on public.trimemo_owner_projects to service_role;
