# BYTE BACK 방어전 · 3단계

이 저장소는 1~2단계에서 만든 같은 자료실을 이어서 개발합니다. 데이터와 테스트 계정은 실습용 가상 자료입니다. 실제 개인정보, 비밀번호, 토큰, 비밀 키를 넣지 마세요.

## 3단계 인증과 메모 API

- 브라우저는 Supabase 공식 JavaScript SDK의 이메일·비밀번호 로그인과 로그아웃 흐름을 사용합니다. Supabase URL과 공개용 publishable key는 배포 빌드가 `public/auth-config.json`을 생성할 때 주입합니다. 이 파일은 Git에서 무시하며, 서비스 전용 키는 포함하지 않습니다.
- `/api/notes`와 `/api/notes/:id`는 기존 `src/verify-login.mjs`로 bearer 토큰을 검증합니다. `aleph.config.json`의 `identityProvider`는 Supabase Auth issuer, `authenticated` audience, JWKS 주소를 기록합니다. 브라우저가 보낸 `userId`나 `role`은 신뢰하지 않습니다.
- 목록 GET은 검증된 사용자 ID의 `owner_id` 행만 반환합니다. POST는 검증된 사용자 ID를 `owner_id`로 저장합니다. 항목 GET/PUT/DELETE는 현재 3단계 의도에 따라 소유자 검사를 하지 않으며, 다른 사용자의 항목 접근은 4단계에서 제한합니다.
- `public.vault_notes`에는 RLS가 켜져 있고 `anon`·`authenticated`에는 테이블 권한이 없습니다. 서버 함수만 `SUPABASE_SECRET_KEY`를 이용합니다. `20261010_stage3_vault_notes_crud.sql`은 서버의 CRUD 권한과 안전한 `sort_order` 기본값을 설정합니다.
- `data.json`과 `public/data.json`은 최신 저장소와 새 정적 배포물에서 제외합니다. 배포 빌드는 `/aleph.json`을 계속 생성합니다.

## Supabase와 Vercel 설정

1. Supabase SQL Editor에서 순서대로 `supabase/migrations/20261010_create_vault_notes.sql`과 `supabase/migrations/20261010_stage3_vault_notes_crud.sql`을 실행합니다. 데이터에는 가상 자료만 사용하고 메모 문장을 저장소에 넣지 않습니다.
2. Vercel Environment Variables에 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`를 서버 함수용으로 설정합니다. `SUPABASE_PUBLISHABLE_KEY`는 공개 브라우저 설정을 빌드할 때만 사용합니다. 이 publishable key는 공개용이지만 Git에 기록하지 않습니다.
3. Production 빌드는 Supabase URL과 publishable key가 없으면 실패합니다. `npm run build -- --local`은 생성된 `public/auth-config.json`을 제거해 로컬에 키를 남기지 않습니다.
4. 배포 뒤 정상 계정으로 로그인해 가상 메모를 추가·수정·삭제할 수 있는지 확인합니다. 사용자별 항목 소유권 검사는 아직 추가하지 않았습니다.

## 제출 전 점검

- 시크릿 창이나 로그아웃 상태에서 메모가 보이지 않고, `GET /api/notes`에 토큰이 없거나 잘못되면 JSON 401/403이 반환되어야 합니다.
- 정상 로그인으로 목록을 불러오고 가상 메모 추가·수정·삭제를 확인합니다. API의 `owner_id`는 검증된 사용자 ID여야 합니다.
- `/api/notes/:id`의 타인 소유 검사 미비는 3단계 범위에 남아 있습니다. 실제 개인정보나 비밀값을 넣지 말고, 이 제한은 4단계에서 고칩니다.
- `https://<배포주소>/data.json`은 404여야 하고 `/aleph.json`은 단계 3을 보고해야 합니다. 첫 화면 응답에는 `X-Content-Type-Options: nosniff`가 있어야 합니다.
- 기존 공개 Git 커밋과 과거 Vercel 배포는 남아 있을 수 있습니다. 최신 파일에서 제거해도 과거 공개 이력이 지워지는 것은 아니며, 이전 노출이 해소됐다고 쓰지 마세요. 기존 자료는 가상 연습 자료뿐입니다.

## 로컬 확인

```sh
npm ci
npm run test:r5
npm run test:package
npm run test:stage3
npm run build -- --local
```

로컬 테스트와 빌드는 실제 Vercel 배포나 심판 판정을 증명하지 않습니다. `src/attack-check.mjs`는 정적 파일 상태, 비로그인·잘못된 토큰의 API 상태, `/aleph.json`, 보안 헤더만 기록하며 메모 본문이나 토큰을 저장하지 않습니다.

## 공통 안전 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽고 한 번에 한 제작 단위만 변경하세요. 비밀번호·토큰·서버 전용 키·기기 개인키·실제 개인정보는 코드, Git, 로그, 답변, 제출 묶음에 넣지 않습니다. `src/decider.mjs`와 `src/detect.mjs`의 로컬 시험 결과는 운영 심판 결과가 아닙니다. 제출 묶음 계약은 `scripts/bundle.mjs`를 따르며, `bundle-notes.json`과 생성된 `artifacts/submission.json`은 커밋하지 않습니다.
