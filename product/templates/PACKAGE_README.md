# ALEPH 방어 제품 (D1–D4)

## 무엇을 하는 제품인가

보안 운영 웹앱: 정책 판정(D1)·사건 수집과 burst 탐지(D2)·승인 기반 대응 집행(D3)·백업과 복원(D4). 기존 방어 앱의 Vercel·Supabase 프로젝트에 `/api/product/v1/*` 경로로 얹혀 동작합니다.

## 준비물

- Node 20 이상
- (기본 경로) 무료 Vercel·Supabase 프로젝트 / (대체 경로) 내 PC

## 설치와 첫 실행

환경변수 이름만 적고 값은 적지 않습니다.

1. Supabase SQL Editor에서 `supabase/product_kv.sql` 실행 → `supabase/product_operator.sql` 실행(파일 안의 `YOUR_PRODUCT_PROJECT_ID`·`YOUR_CONFIRMED_USER_UUID`를 내 값으로 채움)
2. Vercel → Settings → Environment Variables에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PRODUCT_PROJECT_ID` 입력 (선택: `ALEPH_EXECUTOR_URL`, `PRODUCT_BURST_WINDOW_MS`, `PRODUCT_BURST_THRESHOLD`, `PRODUCT_APPROVAL_TTL_MS`)
3. 배포 후 `https://(배포 주소)/api/product/v1/health`가 JSON을 반환하면 준비 완료

대체 경로(내 PC): `node scripts/test-identities.mjs --local` → `npm run start:local` → `http://127.0.0.1:8787/api/product/v1/health`

## 시험 돌리기

```sh
cd product
npm test              # 공개 시험 22개
npm run test:d1       # 기능별로 하나씩
npm run check:platform # 제공 파일 무결성
```

## 되돌리는 방법

- 정책을 되돌리려면 `POST /api/product/v1/policies/rollback` — 새 판 번호로 기록되고 감사 이력은 남습니다.
- 백업으로 되돌리려면 `POST /api/product/v1/backups/:id/restore` — 검증을 통과한 백업만 반영되고, 충돌이 있으면 아무것도 바뀌지 않습니다.
- 배포 자체를 되돌리려면 Vercel Deployments → 이전 배포 → Promote.

## 구성

브라우저(`public/console.html`) → Vercel 서버 함수(`api/product/[...path].mjs`) → 경로 연결(`src/platform/handler.mjs`) → 업무 코드(`src/product/index.mjs`) → 저장소/집행기 어댑터(`src/platform/adapters/` → Supabase `product_kv` 또는 로컬 파일). 브라우저가 보낸 역할·실행 헤더는 믿지 않고 서버 저장소의 역할만 봅니다. `X-Aleph-Run-Id`는 시험 실행 공간을 나누는 표시일 뿐 권한이 아닙니다.

## 정책과 탐지 규칙

- `allow` / `deny` / `step_up`: 요청의 method·zone·owner·role과 규칙 필드를 맞춰 판정합니다. 일치가 없으면 기본 deny, `step_up`은 HTTP 401 `step_up_required`.
- `burst_read`: 같은 주체가 `PRODUCT_BURST_WINDOW_MS`(기본 600000ms) 안에 `PRODUCT_BURST_THRESHOLD`(기본 121건) 이상 읽으면 사건 묶음을 만듭니다. 주체당 진행 중인 묶음은 하나.
- 대응은 사람 승인 뒤에만 집행하고, `PRODUCT_APPROVAL_TTL_MS`를 정하면 기한이 지난 제안은 `expired`로 승인되지 않습니다.
