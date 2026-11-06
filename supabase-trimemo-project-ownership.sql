-- Trimémo: enforce one client owner per project.
-- Run after reviewing duplicates; the migration deliberately stops rather than silently
-- deleting or reassigning any existing client project records.
do $$
begin
  if exists (
    select project_id
    from public.trimemo_client_projects
    group by project_id
    having count(distinct user_id) > 1
  ) then
    raise exception 'Migration stopped: some Trimémo projects are linked to multiple users. Review trimemo_client_projects duplicates before retrying.';
  end if;
end $$;

create unique index if not exists trimemo_client_projects_project_id_uidx
  on public.trimemo_client_projects(project_id);

-- Client ownership and payment status are maintained only by server-side API calls.
alter table public.trimemo_client_projects enable row level security;
revoke all on public.trimemo_client_projects from anon, authenticated;
