create table if not exists public.vault_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  sort_order integer not null unique,
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.vault_notes enable row level security;
revoke all privileges on table public.vault_notes from anon, authenticated;
grant select on table public.vault_notes to service_role;
