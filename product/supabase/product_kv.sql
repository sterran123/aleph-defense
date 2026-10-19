-- 방어전 4~6차 제품 저장소(내 Supabase 프로젝트에 한 번 실행). 무료 플랜으로 충분합니다.
-- 이 표는 서버(Vercel 함수)가 서비스 키로만 읽고 씁니다. 브라우저(anon·authenticated)는 접근할 수 없습니다.
create table if not exists public.product_kv (
  project_id text not null,
  coll text not null,
  id text not null,
  value jsonb not null,
  ver bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (project_id, coll, id)
);

alter table public.product_kv enable row level security;
revoke all on table public.product_kv from anon, authenticated;
-- 새 표에 자동 권한을 주지 않는 프로젝트에서도 서버 역할만 접근할 수 있게 합니다.
-- 근거: https://supabase.com/docs/guides/api/securing-your-api#grant-access-explicitly
grant select, insert, update, delete on table public.product_kv to service_role;
-- 정책을 하나도 만들지 않습니다. RLS 가 켜져 있고 정책이 없으면 anon·authenticated 는 아무 행도 못 봅니다.

-- 읽은 행의 판(ver)이 그대로일 때만 쓰기를 한꺼번에 반영합니다. 하나라도 바뀌었으면 전체를 거부합니다.
create or replace function public.product_kv_apply(p_project text, p_reads jsonb, p_writes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  w jsonb;
  cur bigint;
begin
  -- 같은 프로젝트의 반영은 한 번에 하나씩(없던 행을 동시에 만드는 경우까지 막음)
  perform pg_advisory_xact_lock(hashtext(p_project));
  for r in select * from jsonb_array_elements(coalesce(p_reads, '[]'::jsonb)) loop
    select k.ver into cur from public.product_kv k
      where k.project_id = p_project and k.coll = r->>'coll' and k.id = r->>'id'
      for update;
    if coalesce(cur, 0) <> (r->>'ver')::bigint then
      raise exception 'product_kv_conflict';
    end if;
  end loop;
  for w in select * from jsonb_array_elements(coalesce(p_writes, '[]'::jsonb)) loop
    if (w->>'deleted')::boolean then
      delete from public.product_kv k where k.project_id = p_project and k.coll = w->>'coll' and k.id = w->>'id';
    else
      insert into public.product_kv as k (project_id, coll, id, value, ver)
        values (p_project, w->>'coll', w->>'id', w->'value', 1)
      on conflict (project_id, coll, id)
        do update set value = excluded.value, ver = k.ver + 1, updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.product_kv_apply(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.product_kv_apply(text, jsonb, jsonb) to service_role;
