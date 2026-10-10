# BYTE BACK 방어전 · 2단계

이 저장소는 1단계에서 만든 같은 자료실을 이어서 개발합니다. 데이터는 모두 실습용 가상 자료입니다. 실제 개인정보, 비밀번호, 토큰, 비밀 키를 넣지 마세요.

## 2단계 데이터 흐름

- 가상 메모는 Supabase의 `public.vault_notes` 테이블에 저장됩니다. `owner_id`는 `uuid` 칸으로 미리 두되, `auth.users` 외래키는 만들지 않습니다.
- 테이블에는 RLS가 켜져 있고 `anon`·`authenticated` 역할에는 읽기 권한이 없습니다. 서버 함수만 `SUPABASE_SECRET_KEY`로 읽습니다.
- 화면은 `/api/notes` 서버 함수에서 자료를 받습니다. 이 API는 3단계 인증이 추가되기 전까지 공개 주소이며, 비로그인 방문자도 가상 메모를 요청할 수 있습니다. 따라서 이 단계에서는 가상 자료만 사용합니다.
- `data.json`과 `public/data.json`은 최신 저장소와 새 정적 배포물에서 제거했습니다. 빌드는 이를 다시 만들지 않고, Vercel 배포의 `/aleph.json`은 계속 생성합니다.

## Supabase와 Vercel 설정

1. Supabase SQL Editor에서 `supabase/migrations/20261010_create_vault_notes.sql`을 실행합니다. 그다음 Supabase 프로젝트에 가상 자료 네 건을 입력합니다. 자료 문장은 공개 저장소에 넣지 않습니다.
2. Vercel 프로젝트의 Environment Variables에 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`를 **서버 환경변수로만** 설정하고 Production 배포를 다시 만듭니다. `SUPABASE_SECRET_KEY`를 브라우저 코드, 응답, 로그, Git에 넣지 마세요. 설정 값 자체도 저장소에 기록하지 않습니다.
3. 화면에 네 카드가 보이는지 확인합니다. `/api/notes`는 아직 공개되어 있다는 점을 기억하세요. 로그인과 사용자별 권한은 다음 단계에서 추가합니다.

## 제출 전 점검

- `https://<배포주소>/data.json`은 404여야 합니다.
- `https://<배포주소>/api/notes`는 이 단계에서는 공개 API로 가상 자료를 반환합니다. 응답 본문이나 자료 문장을 제출 기록·로그에 복사하지 마세요.
- `https://<배포주소>/aleph.json`이 열리고 배포 단계가 2인지 확인합니다.
- 첫 화면 응답에 `X-Content-Type-Options: nosniff` 헤더가 있는지 확인합니다.
- 최신 GitHub 파일과 새 정적 배포물에서 이전 공개 자료의 문장들이 나오지 않는지 로컬에서 점검합니다. 검색용 문장 목록은 로컬에만 두고 커밋하지 않습니다.
- 기존 공개 Git 커밋과 과거 Vercel 배포는 남아 있을 수 있습니다. 최신 파일에서 제거해도 과거 공개 이력이 지워지는 것은 아니며, 이전 노출이 해소됐다고 쓰지 마세요. 기존 자료는 가상 연습 자료뿐입니다.

## 로컬 확인

```sh
npm ci
npm run test:r5
npm run test:package
npm run build -- --local
```

로컬 빌드와 테스트는 실제 Vercel 배포나 심판 판정을 증명하지 않습니다. 배포 후 `src/attack-check.mjs`는 정적 파일 상태, 공개 API의 상태와 개수, `/aleph.json`, 보안 헤더를 확인하되 메모 본문이나 비밀값은 기록하지 않습니다.

## 공통 안전 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽고 한 번에 한 제작 단위만 변경하세요. 비밀번호·토큰·서버 전용 키·기기 개인키·실제 개인정보는 코드, Git, 로그, 답변, 제출 묶음에 넣지 않습니다. `src/decider.mjs`와 `src/detect.mjs`의 로컬 시험 결과는 운영 심판 결과가 아닙니다. 제출 묶음 계약은 `scripts/bundle.mjs`를 따르며, `bundle-notes.json`과 생성된 `artifacts/submission.json`은 커밋하지 않습니다.
