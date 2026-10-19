-- 학생 본인의 제품 프로젝트에서만 실행하는 관리 작업자 초기화 틀입니다.
-- ALEPH 공용 운영 DB에서 실행하지 마세요. 서비스 키는 이 파일에 넣지 않습니다.
-- 먼저 product_kv.sql을 실행하고, 아래 두 문자열을 본인의 값으로 바꾸세요.
-- PRODUCT_PROJECT_ID는 서버 환경변수와 같아야 하며, 사용자 UUID는
-- 내 Supabase의 Authentication > Users에서 확인한 본인의 확인된 계정입니다.
-- 이 계정은 개인 개발용입니다. 심판 시험 신원 등록을 대신하지 않습니다.
begin;
do $product_operator_setup$
declare
  v_project text := 'YOUR_PRODUCT_PROJECT_ID';
  v_user_text text := 'YOUR_CONFIRMED_USER_UUID';
  v_user uuid;
  v_existing jsonb;
begin
  if v_project like 'YOUR_%' or v_user_text like 'YOUR_%' then
    raise exception 'product_operator_setup_values_required';
  end if;
  if v_project !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
      or v_user_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'product_operator_setup_values_invalid';
  end if;
  v_user := v_user_text::uuid;
  if not exists (select 1 from auth.users u where u.id = v_user
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false) then
    raise exception 'product_operator_setup_confirmed_account_required';
  end if;
  -- 같은 프로젝트에서 동시에 초기화하면 한 번에 하나씩 처리합니다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_project));
  select k.value into v_existing from public.product_kv k
    where k.project_id = v_project and k.coll = 'roles' and k.id = v_user_text
    for update;
  if found and v_existing <> pg_catalog.jsonb_build_object('role', 'operator') then
    raise exception 'product_operator_setup_existing_role_conflict';
  end if;
  insert into public.product_kv (project_id, coll, id, value)
    values (v_project, 'roles', v_user_text, pg_catalog.jsonb_build_object('role', 'operator'))
    on conflict (project_id, coll, id) do nothing;
end;
$product_operator_setup$;
commit;
