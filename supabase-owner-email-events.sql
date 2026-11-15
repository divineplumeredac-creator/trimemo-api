-- Registre prive des alertes commerciales (une alerte par commande confirmée).
-- Accessible uniquement au serveur avec la cle service_role Supabase.
create table if not exists public.trimemo_owner_email_events (
  event_key text primary key,
  status text not null default 'reserved' check (status in ('reserved', 'accepted', 'failed')),
  recipient text not null,
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_email_event_key_length check (char_length(event_key) between 1 and 200)
);
alter table public.trimemo_owner_email_events enable row level security;
revoke all on table public.trimemo_owner_email_events from public, anon, authenticated;
grant select, insert, update on table public.trimemo_owner_email_events to service_role;
comment on table public.trimemo_owner_email_events is
  'Alerte commerciale administrateur, déduplication durable des paiements vérifiés.';
