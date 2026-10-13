begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.vault_note_backups (
  note_id uuid primary key,
  owner_id uuid not null,
  title text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null default now()
);

alter table public.vault_note_backups enable row level security;
revoke all on table public.vault_note_backups from public, anon, authenticated;
grant select, insert on table public.vault_note_backups to service_role;

-- Seed the durable first copy from existing notes before the next restore exercise.
-- Existing backups are never overwritten by a later migration run.
insert into public.vault_note_backups (note_id, owner_id, title, content, content_sha256)
select notes.id, notes.owner_id, notes.title, notes.content,
       encode(digest(convert_to(notes.content, 'UTF8'), 'sha256'), 'hex')
from public.vault_notes as notes
where notes.owner_id is not null
on conflict (note_id) do nothing;

create table if not exists public.vault_note_restore_audit (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  actor_id uuid not null,
  backup_sha256 text not null check (backup_sha256 ~ '^[a-f0-9]{64}$'),
  action text not null check (action = 'restore'),
  created_at timestamptz not null default now()
);

alter table public.vault_note_restore_audit enable row level security;
revoke all on table public.vault_note_restore_audit from public, anon, authenticated;
grant select, insert on table public.vault_note_restore_audit to service_role;

create or replace function public.restore_vault_note_with_audit(
  p_note_id uuid,
  p_owner_id uuid,
  p_title text,
  p_content text,
  p_content_sha256 text
)
returns table (id uuid, owner_id uuid, title text, content text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  saved public.vault_note_backups%rowtype;
  current_note public.vault_notes%rowtype;
  restored public.vault_notes%rowtype;
  actual_hash text;
begin
  select * into saved
  from public.vault_note_backups
  where note_id = p_note_id
  for share;

  if not found then
    raise exception 'verified backup missing' using errcode = 'P0002';
  end if;

  actual_hash := encode(digest(convert_to(saved.content, 'UTF8'), 'sha256'), 'hex');
  if saved.note_id is distinct from p_note_id
     or saved.owner_id is distinct from p_owner_id
     or saved.title is distinct from p_title
     or saved.content is distinct from p_content
     or saved.content_sha256 is distinct from p_content_sha256
     or saved.content_sha256 is distinct from actual_hash then
    raise exception 'verified backup mismatch' using errcode = '23514';
  end if;

  select notes.* into current_note
  from public.vault_notes as notes
  where notes.id = p_note_id
  for update;

  if found then
    if current_note.owner_id is distinct from p_owner_id then
      raise exception 'note owner mismatch' using errcode = 'P0002';
    end if;

    update public.vault_notes as notes
    set title = saved.title,
        content = saved.content
    where notes.id = p_note_id and notes.owner_id = p_owner_id
    returning notes.* into restored;
  else
    insert into public.vault_notes (id, owner_id, title, content)
    values (saved.note_id, saved.owner_id, saved.title, saved.content)
    returning * into restored;
  end if;

  actual_hash := encode(digest(convert_to(restored.content, 'UTF8'), 'sha256'), 'hex');
  if restored.id is distinct from saved.note_id
     or restored.owner_id is distinct from saved.owner_id
     or restored.title is distinct from saved.title
     or actual_hash is distinct from saved.content_sha256 then
    raise exception 'restored row mismatch' using errcode = '23514';
  end if;

  insert into public.vault_note_restore_audit (note_id, actor_id, backup_sha256, action)
  values (saved.note_id, p_owner_id, saved.content_sha256, 'restore');

  return query select restored.id, restored.owner_id, restored.title, restored.content;
end;
$$;

revoke all on function public.restore_vault_note_with_audit(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.restore_vault_note_with_audit(uuid, uuid, text, text, text)
  to service_role;

commit;
