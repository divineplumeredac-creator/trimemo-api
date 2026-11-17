create table if not exists public.trimemo_project_incidents (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null,
 user_id uuid not null,
 stage text not null check (stage in ('estimation','problematique','plan','redaction','apercu')),
 status text not null default 'open' check (status in ('open','sending','sent','failed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 provider_message_id text,
 error_code text
);
create unique index if not exists trimemo_incidents_open_project_stage on public.trimemo_project_incidents(project_id,stage) where status in ('open','sending','failed');
alter table public.trimemo_project_incidents enable row level security;
revoke all on public.trimemo_project_incidents from anon, authenticated;

grant all on public.trimemo_project_incidents to service_role;
