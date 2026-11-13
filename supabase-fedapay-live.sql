-- Sandbox provider ledger, shared with the public site's authenticated projects.
-- A single unresolved attempt per project must be shared by both providers.
create table public.trimemo_live_payment_intents (
  reference text primary key check (reference ~ '^[A-Za-z0-9_-]{10,100}$'),
  project_id text not null check (length(project_id) between 1 and 200),
  user_id uuid not null,
  provider text not null check (provider in ('fedapay', 'paypal')),
  provider_id text,
  amount numeric(15,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  state text not null default 'creating' check (state in ('creating', 'ready', 'paid', 'closed')),
  project_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id)
);
-- Creating covers uncertain network errors; paid remains locked. No timer
-- releases a potentially paid attempt without provider reconciliation.
create unique index trimemo_live_payment_intents_one_open_per_project
  on public.trimemo_live_payment_intents(project_id)
  where state in ('creating', 'ready', 'paid');
create index trimemo_live_payment_intents_owner_idx on public.trimemo_live_payment_intents(user_id, project_id);
alter table public.trimemo_live_payment_intents enable row level security;
revoke all on table public.trimemo_live_payment_intents from public, anon, authenticated;
grant select, insert, update on table public.trimemo_live_payment_intents to service_role;

-- Only the trusted backend calls this function, after checking the provider.
-- Recording the order and changing the intent are one database transaction.
create function public.confirm_trimemo_fedapay_live(
  p_reference text, p_provider_id text, p_user_id uuid,
  p_project_id text, p_amount numeric, p_currency text, p_fingerprint text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare intent public.trimemo_live_payment_intents%rowtype;
declare existing public.trimemo_orders%rowtype;
declare payment_id text := 'fedapay-live:' || p_provider_id;
begin
  select * into intent from public.trimemo_live_payment_intents where reference=p_reference for update;
  if not found or intent.provider <> 'fedapay' or intent.provider_id is distinct from p_provider_id
    or intent.user_id is distinct from p_user_id or intent.project_id is distinct from p_project_id
    or intent.amount is distinct from p_amount or intent.currency is distinct from p_currency
    or intent.currency <> 'XOF' or intent.state not in ('creating','ready','paid')
    or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid payment intent';
  end if;
  insert into public.trimemo_orders(order_id, project_id, project_fingerprint, status, amount, currency, capture_id, project_snapshot, paid_at, owner_id)
    values(payment_id,intent.project_id,p_fingerprint,'paid',intent.amount::text,intent.currency,p_provider_id,intent.project_snapshot,now(),intent.user_id)
    on conflict (order_id) do nothing;
  select * into existing from public.trimemo_orders where order_id=payment_id for update;
  if existing.project_id is distinct from intent.project_id or existing.owner_id is distinct from intent.user_id
    or existing.project_fingerprint is distinct from p_fingerprint or existing.amount::numeric is distinct from intent.amount
    or existing.currency is distinct from intent.currency or existing.status <> 'paid'
    or coalesce(existing.refund_status,'none') <> 'none' or existing.consumed_at is not null then
    raise exception 'Payment order conflict';
  end if;
  update public.trimemo_live_payment_intents set state='paid', updated_at=now() where reference=p_reference;
  return jsonb_build_object('status','PAID','order_id',payment_id,'project',intent.project_snapshot);
end;
$$;
revoke all on function public.confirm_trimemo_fedapay_live(text,text,uuid,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.confirm_trimemo_fedapay_live(text,text,uuid,text,numeric,text,text) to service_role;
