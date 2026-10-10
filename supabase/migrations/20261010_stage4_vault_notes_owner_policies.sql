begin;

alter table public.vault_notes enable row level security;

revoke all on table public.vault_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.vault_notes to authenticated;

drop policy if exists vault_notes_select_own on public.vault_notes;
create policy vault_notes_select_own
  on public.vault_notes for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists vault_notes_insert_own on public.vault_notes;
create policy vault_notes_insert_own
  on public.vault_notes for insert to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists vault_notes_update_own on public.vault_notes;
create policy vault_notes_update_own
  on public.vault_notes for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists vault_notes_delete_own on public.vault_notes;
create policy vault_notes_delete_own
  on public.vault_notes for delete to authenticated
  using (auth.uid() = owner_id);

commit;
