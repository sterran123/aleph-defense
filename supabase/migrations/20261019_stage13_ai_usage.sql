-- 13단계 패키징: /api/ai 의 사용자별 하루 호출 상한 기록용 표.
-- 서버(서비스 키)만 읽고 씁니다. anon·authenticated 역할에는 권한을 주지 않습니다.
create table if not exists public.ai_usage (
  user_id uuid not null,
  day date not null,
  used integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;
grant select, insert, update on table public.ai_usage to service_role;

-- 상한 검사는 서버가 합니다. 이 함수는 호출을 한 번 올리고 새 값만 돌려줍니다.
-- 상한을 넘은 호출도 거부 기록으로 남기기 위해 끝까지 셉니다.
create or replace function public.ai_usage_hit(p_user uuid, p_day date, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur integer;
begin
  insert into public.ai_usage (user_id, day, used) values (p_user, p_day, 1)
    on conflict (user_id, day) do update
      set used = public.ai_usage.used + 1
    returning used into cur;
  return cur;
end;
$$;

revoke all on function public.ai_usage_hit(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.ai_usage_hit(uuid, date, integer) to service_role;
