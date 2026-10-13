begin;

create table if not exists public.device_approvals (
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  primary key (owner_id, device_id),
  check ((status = 'approved' and approved_at is not null) or status <> 'approved')
);

alter table public.device_approvals enable row level security;
revoke all on table public.device_approvals from public, anon, authenticated;
grant select, insert, update on table public.device_approvals to service_role;

commit;
