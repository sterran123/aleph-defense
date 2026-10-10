create sequence if not exists public.vault_notes_sort_order_seq;

select setval(
  'public.vault_notes_sort_order_seq',
  coalesce((select max(sort_order) from public.vault_notes), 0) + 1,
  false
);

alter table public.vault_notes
  alter column sort_order
  set default nextval('public.vault_notes_sort_order_seq'::regclass);

revoke all on sequence public.vault_notes_sort_order_seq from public, anon, authenticated;
grant usage, select on sequence public.vault_notes_sort_order_seq to service_role;
grant select, insert, update, delete on table public.vault_notes to service_role;
