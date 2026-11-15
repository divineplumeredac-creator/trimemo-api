-- Synchronisé avec la migration Supabase du 15 novembre 2026.
create table if not exists public.trimemo_account_preview_usage (
  project_id uuid primary key,
  owner_id uuid not null,
  first_requested_at timestamptz not null default now()
);
create index if not exists trimemo_account_preview_usage_owner_time
 on public.trimemo_account_preview_usage (owner_id, first_requested_at desc);
alter table public.trimemo_account_preview_usage enable row level security;
revoke all on public.trimemo_account_preview_usage from anon, authenticated;
create or replace function public.trimemo_claim_preview_project(
 p_project_id uuid, p_owner_id uuid, p_max_projects integer default 3
) returns boolean language plpgsql security invoker set search_path = '' as $body$
declare existing_owner uuid;
begin
 if p_project_id is null or p_owner_id is null or p_max_projects < 1 or p_max_projects > 20 then
  raise exception 'Invalid preview claim parameters';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text, 691517));
 select owner_id into existing_owner from public.trimemo_account_preview_usage where project_id = p_project_id;
 if found then return existing_owner = p_owner_id; end if;
 if (select count(*) from public.trimemo_account_preview_usage
 where owner_id = p_owner_id and first_requested_at > pg_catalog.now() - interval '24 hours') >= p_max_projects
 then return false; end if;
 insert into public.trimemo_account_preview_usage(project_id,owner_id)
 values(p_project_id,p_owner_id) on conflict (project_id) do nothing;
 return exists(select 1 from public.trimemo_account_preview_usage
 where project_id=p_project_id and owner_id=p_owner_id);
end $body$;
revoke all on function public.trimemo_claim_preview_project(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.trimemo_claim_preview_project(uuid,uuid,integer) to service_role;
