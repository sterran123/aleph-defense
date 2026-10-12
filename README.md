# BYTE BACK 방어전 · 5단계

이 저장소는 1~4단계에서 만든 같은 자료실을 이어서 개발합니다. 데이터와 테스트 계정은 실습용 가상 자료입니다. 실제 개인정보, 비밀번호, 토큰, 비밀 키를 넣지 마세요.

## 5단계 서버 전용 데이터 접근과 사용자별 메모 API

- 브라우저는 Supabase 공식 JavaScript SDK를 이메일·비밀번호 로그인과 로그아웃에만 사용합니다. `public.vault_notes`의 데이터 CRUD는 브라우저에서 직접 호출하지 않고 `/api/notes` 서버 함수로 처리합니다. 브라우저용 Supabase URL과 publishable key는 빌드 시 `public/auth-config.json`에 주입되며, 이 파일은 Git에서 무시합니다.
- `/api/notes`와 `/api/notes/:id`는 `src/verify-login.mjs`로 bearer 토큰을 검증합니다. `aleph.config.json`의 `identityProvider`는 Supabase Auth issuer, `authenticated` audience, JWKS 주소를 기록합니다. 브라우저가 보낸 `userId`나 `role`은 신뢰하지 않습니다. `SUPABASE_SECRET_KEY`는 서버 함수에만 사용합니다.
- `GET /api/notes`는 검증된 사용자 ID의 `owner_id` 행만 반환하고, POST는 확인된 ID를 `owner_id`로 저장합니다. 항목 GET/PUT/DELETE도 ID와 검증된 소유자를 함께 확인하며, 타인 항목은 404로 돌려줍니다. 요청 본문의 `owner_id`는 신뢰하지 않고 수정 입력에도 허용하지 않습니다.
- `public.vault_notes`에는 RLS와 소유자 정책이 유지됩니다. Stage 5에서는 `PUBLIC`, `anon`, `authenticated`의 직접 테이블 권한을 회수하고 `service_role`의 기존 권한은 변경하지 않습니다. 서버 함수는 `SUPABASE_SECRET_KEY`로 테이블에 접근하고 API에서도 소유자를 다시 확인합니다.
- `aleph.config.json`은 `step: 5`와 원본 Supabase Data API 주소를 기록합니다. `data.json`과 `public/data.json`은 최신 저장소와 새 정적 배포물에서 제외하며, 배포 빌드는 `/aleph.json`을 생성합니다.

## Stage 5 데이터베이스 권한

초기화할 때 세 migration을 순서대로 실행한 뒤 Supabase SQL Editor에서 아래 세 문장을 실행합니다. 이 변경은 `public.vault_notes`만 대상으로 하며 다른 테이블이나 `service_role` 권한은 건드리지 않습니다.

```sql
REVOKE ALL PRIVILEGES ON TABLE public.vault_notes FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.vault_notes FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.vault_notes FROM authenticated;
```

사후 확인에서는 `role_table_grants`에서 `PUBLIC`, `anon`, `authenticated`의 행이 없어지고 `service_role`의 기존 권한이 유지되며, `has_table_privilege`의 CRUD 결과가 `anon`과 `authenticated`는 모두 `false`, `service_role`은 모두 `true`여야 합니다.

## Supabase와 Vercel 설정

1. Supabase SQL Editor에서 `supabase/migrations/20261010_create_vault_notes.sql`, `supabase/migrations/20261010_stage3_vault_notes_crud.sql`, `supabase/migrations/20261010_stage4_vault_notes_owner_policies.sql` 순서로 실행한 뒤 위 Stage 5 권한 SQL을 실행합니다. 데이터에는 가상 자료만 사용하고 메모 문장을 저장소에 넣지 않습니다.
2. Vercel Environment Variables에 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`를 서버 함수용으로 설정합니다. `SUPABASE_PUBLISHABLE_KEY`는 브라우저 인증 설정을 빌드할 때만 사용합니다. 키 값은 Git에 기록하지 않습니다.
3. Production 빌드는 Supabase URL과 publishable key가 없으면 실패합니다. `npm run build -- --local`은 생성된 `public/auth-config.json`을 제거해 로컬에 키를 남기지 않습니다.
4. 배포 뒤 A와 B가 각자 로그인해 자기 메모 CRUD를 확인하고, 서로의 항목 ID와 위조 `owner_id` 요청이 거부되는지 확인합니다.

## 제출 전 점검

- 로그아웃 상태에서 메모가 보이지 않고, `GET /api/notes`에 토큰이 없거나 잘못되면 JSON 401/403이 반환되어야 합니다.
- A/B가 각자 로그인해 자기 메모 CRUD를 확인합니다. API의 `owner_id`는 검증된 사용자 ID여야 하고, 다른 사용자의 항목 GET/PUT/DELETE는 404, 본문 `owner_id` 위조는 400이어야 합니다.
- Supabase Data API를 통한 `public.vault_notes` 직접 접근은 `anon`과 `authenticated` 모두 거부되어야 합니다. 합성 테스트 계정만 사용하고 비밀번호·토큰·키 값은 로그나 제출물에 남기지 않습니다.
- `https://<배포주소>/data.json`은 404여야 하고 `/aleph.json`은 단계 5를 보고해야 합니다. 첫 화면 응답에는 `X-Content-Type-Options: nosniff`가 있어야 합니다.
- 기존 공개 Git 커밋과 과거 Vercel 배포는 남아 있을 수 있습니다. 최신 파일에서 제거해도 과거 공개 이력이 지워지는 것은 아니며, 이전 노출이 해소됐다고 쓰지 마세요. 기존 자료는 가상 연습 자료뿐입니다.

## 로컬 확인

```sh
npm ci
npm run test:r5
npm run test:package
npm run test:stage3
npm run build -- --local
npm run bundle
```

로컬 테스트와 빌드는 실제 Vercel 배포나 심판 판정을 증명하지 않습니다. `npm run bundle`은 학생의 자기 점검과 제출 묶음을 만듭니다. `src/attack-check.mjs`는 정적 파일 상태, 비로그인·잘못된 토큰의 API 상태, `/aleph.json`, 보안 헤더만 기록하며 메모 본문이나 토큰을 저장하지 않습니다. `bundle-notes.json`과 `artifacts/submission.json`은 커밋하지 않습니다.

## 공통 안전 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽고 한 번에 한 제작 단위만 변경하세요. 비밀번호·토큰·서버 전용 키·기기 개인키·실제 개인정보는 코드, Git, 로그, 답변, 제출 묶음에 넣지 않습니다. `src/decider.mjs`와 `src/detect.mjs`의 로컬 시험 결과는 운영 심판 결과가 아닙니다. 제출 묶음 계약은 `scripts/bundle.mjs`를 따르며, `bundle-notes.json`과 생성된 `artifacts/submission.json`은 커밋하지 않습니다.


## 보너스 작전 XDR-01 · 무차별 로그인

- `xdr/brute-force/read-alerts.mjs`는 경보에서 시각·출발 주소·계정·규칙 수준·설명만 읽고, 설명 안의 bearer 값·토큰·비밀번호처럼 보이는 값을 가립니다. 원본 경보는 수정하지 않습니다.
- `xdr/brute-force/decide.mjs`는 MITRE ATT&CK T1110의 짧은 시간 고빈도 실패와 계정 분사 신호만 높은 확신으로 차단합니다. 근거가 약한 로그인 실패는 알림, 정상 경보는 기록으로 남깁니다. 이 파일은 import·파일 I/O·네트워크 없이 독립 실행됩니다.
- `xdr/brute-force/respond.mjs`는 차단 판정에만 15분 만료와 근거 경보 ID가 있는 추가 거부 규칙을 만듭니다. 기존 규칙을 유지하고 합성 문서용 IP 대역만 대상으로 합니다. 알림은 비밀값을 가린 한 줄 JSON으로 `xdr/alerts.log`에 덧붙입니다.

로컬 재실행:

```sh
npm run xdr:run -- brute-force
node xdr/brute-force/respond.mjs
```

첫 명령은 `xdr/brute-force/result.json`에 판정과 건수를 기록하고, 두 번째 명령은 `xdr/deny-rules.json`에 추가 규칙을 병합합니다. 입력은 `xdr/fixtures/brute-force.json`의 합성 경보뿐입니다.












## 보너스 작전 XDR-02 · 웹 입력 조작

- `xdr/web-injection/read-alerts.mjs`는 경보의 시각·출발 주소·계정·규칙 수준·설명만 읽고, 민감값처럼 보이는 설명은 가립니다. 원본 경보는 바꾸지 않습니다.
- `patterns.json`은 MITRE ATT&CK T1190 근거로 반복 SQL 입력, 스크립트 삽입, 경로 이탈 신호와 실습 경보에 명시된 입력 구분자 신호를 기록합니다. 단어 하나만 겹치거나 반복 근거가 약한 경우는 차단하지 않습니다.
- `decide.mjs`는 T1190, 출발 주소, 규칙 수준 10 이상, 8회 이상 반복, 명시된 신호가 함께 있을 때만 차단합니다. 애매한 T1190 경보는 알림, 충분한 근거가 없는 정상 이벤트는 기록으로 남깁니다. 이 파일은 import·파일 I/O·네트워크 없이 독립 실행됩니다.
- `respond.mjs`는 차단 판정에만 근거 경보 ID와 15분 만료가 있는 추가 거부 규칙을 만듭니다. 기존 규칙을 유지하며 합성 문서용 IP 대역만 대상으로 합니다. 비밀값을 가린 JSON 한 줄을 공유 `xdr/alerts.log`에 덧붙입니다.

로컬 재실행:

```sh
npm run xdr:run -- web-injection
node xdr/web-injection/respond.mjs
```

시험 경보에서는 `block=8`, `alert=9`, `record=9`이며 정상 이벤트 차단은 없습니다. 첫 명령은 `xdr/web-injection/result.json`을 만들고, 두 번째 명령은 `xdr/deny-rules.json`의 기존 규칙을 보존하면서 추가 규칙을 병합합니다. 입력은 합성 경보뿐입니다.











