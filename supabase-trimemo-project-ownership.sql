-- Migration de sécurité Trimémo : rattacher chaque sauvegarde à un compte client.
-- À exécuter dans Supabase SQL Editor AVANT le déploiement de cette branche.
alter table public.trimemo_project_state
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- Reprendre automatiquement les propriétaires uniquement lorsqu'un seul compte est associé au projet.
with unique_owners as (
  select project_id, min(user_id::text)::uuid as user_id
  from public.trimemo_client_projects
  group by project_id
  having count(distinct user_id) = 1
)
update public.trimemo_project_state as state
set owner_id = unique_owners.user_id
from unique_owners
where state.project_id = unique_owners.project_id
  and state.owner_id is null;

create index if not exists trimemo_project_state_owner_id_idx
  on public.trimemo_project_state (owner_id);

-- Vérification : cette requête doit retourner les projets ambigus/non rattachés.
select state.project_id, count(distinct membership.user_id) as account_count
from public.trimemo_project_state as state
left join public.trimemo_client_projects as membership
  on membership.project_id::text = state.project_id::text
where state.owner_id is null
group by state.project_id
order by account_count desc;
