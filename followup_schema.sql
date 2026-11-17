create table if not exists public.trimemo_followup_messages (
 project_id uuid not null, user_id uuid not null, kind text not null check (kind in ('unpaid','paid_incomplete')),
 status text not null check (status in ('sending','sent','failed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), provider_message_id text, error_code text,
 primary key(project_id,kind)
);
create table if not exists public.trimemo_followup_optouts (user_id uuid primary key, created_at timestamptz not null default now());
alter table public.trimemo_followup_messages enable row level security;
alter table public.trimemo_followup_optouts enable row level security;
revoke all on public.trimemo_followup_messages, public.trimemo_followup_optouts from anon, authenticated;
grant all on public.trimemo_followup_messages, public.trimemo_followup_optouts to service_role;
