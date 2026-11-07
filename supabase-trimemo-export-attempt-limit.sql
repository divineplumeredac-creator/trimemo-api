alter table public.trimemo_orders
  add column if not exists export_attempts integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trimemo_orders_export_attempts_nonnegative'
      and conrelid = 'public.trimemo_orders'::regclass
  ) then
    alter table public.trimemo_orders
      add constraint trimemo_orders_export_attempts_nonnegative
      check (export_attempts >= 0);
  end if;
end;
$$;

create or replace function public.claim_trimemo_export_attempt(
  p_order_id text,
  p_project_id text,
  p_project_fingerprint text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  claimed_attempt integer;
begin
  update public.trimemo_orders
     set export_attempts = export_attempts + 1,
         updated_at = pg_catalog.now()
   where order_id = p_order_id
     and project_id = p_project_id
     and project_fingerprint = p_project_fingerprint
     and status in ('paid', 'consumed')
     and coalesce(refund_status, 'none') = 'none'
     and export_attempts < 3
  returning export_attempts into claimed_attempt;

  return coalesce(claimed_attempt, 0);
end;
$function$;

revoke all on function public.claim_trimemo_export_attempt(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_trimemo_export_attempt(text, text, text) to service_role;
