-- Ownership hardening for Trimemo's account links, project states, and orders.
-- Existing owner values may be set once; a set owner cannot be reassigned.
create or replace function public.trimemo_prevent_owner_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_TABLE_NAME = 'trimemo_client_projects' then
    if OLD.user_id is distinct from NEW.user_id then
      raise exception 'Trimemo project ownership cannot be reassigned';
    end if;
  elsif TG_TABLE_NAME in ('trimemo_project_state', 'trimemo_orders') then
    if OLD.owner_id is not null and NEW.owner_id is distinct from OLD.owner_id then
      raise exception 'Trimemo record ownership cannot be reassigned';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trimemo_client_projects_owner_immutable on public.trimemo_client_projects;
create trigger trimemo_client_projects_owner_immutable
before update of user_id on public.trimemo_client_projects
for each row execute function public.trimemo_prevent_owner_reassignment();

drop trigger if exists trimemo_project_state_owner_immutable on public.trimemo_project_state;
create trigger trimemo_project_state_owner_immutable
before update of owner_id on public.trimemo_project_state
for each row execute function public.trimemo_prevent_owner_reassignment();

drop trigger if exists trimemo_orders_owner_immutable on public.trimemo_orders;
create trigger trimemo_orders_owner_immutable
before update of owner_id on public.trimemo_orders
for each row execute function public.trimemo_prevent_owner_reassignment();
