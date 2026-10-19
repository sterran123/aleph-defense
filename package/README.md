# 내 ZTNA 배포 안내

이 저장소를 처음 받는 사람이 자기 Supabase·Vercel 계정으로 같은 앱을 배포하는 방법입니다. 명령과 환경변수 이름만 적고, 실제 값(키·비밀번호·계정 정보)은 적지 않습니다.

## 준비물

- Node 20 이상, npm
- 무료 Supabase 프로젝트 하나 (`supabase.com` → New project)
- 무료 Vercel 계정 (`vercel.com`)
- 이 저장소의 GitHub 포크 또는 복사본

## 1. Supabase 준비

Supabase 대시보드 → 내 프로젝트 → **SQL Editor**에서 아래 SQL 파일을 저장소에서 열어 순서대로 붙여넣고 실행합니다.

1. `supabase/migrations/` 아래의 SQL 파일들 — 파일 이름 순서대로 실행
2. `product/supabase/product_kv.sql`
3. `product/supabase/product_operator.sql` — 파일 안의 `YOUR_PRODUCT_PROJECT_ID`와 `YOUR_CONFIRMED_USER_UUID` 두 자리에 내 값을 채웁니다.
   - `YOUR_CONFIRMED_USER_UUID`: Supabase 대시보드 → **Authentication → Users**에서 내 계정의 UUID
   - `YOUR_PRODUCT_PROJECT_ID`: 아래 2번 절에서 Vercel `PRODUCT_PROJECT_ID`에 넣을 것과 같은 문자열

## 2. Vercel 배포

1. `vercel.com` → **Add New → Project** → 이 저장소의 GitHub를 연결합니다.
   - 저장소를 새로 옮겼다면 GitHub에 push한 뒤 **새 Vercel 프로젝트**로 가져옵니다.
   - Root Directory는 저장소 루트입니다. `vercel.json`이 `npm run build` → `public/` 출력을 자동으로 잡습니다.
2. 프로젝트 **Settings → Environment Variables**에 아래 이름으로 값을 입력합니다.

| 이름 | 어디서 얻나 | 용도 |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL | 서버가 자료실을 부르는 주소 |
| `SUPABASE_SECRET_KEY` | 같은 화면 → service_role/secret 키 | 서버 전용 자료실·로그인 검증 키 |
| `SUPABASE_PUBLISHABLE_KEY` | 같은 화면 → anon/publishable 키 | 로그인·세션 처리용 |
| `SUPABASE_ANON_KEY` | 같은 anon 키와 같은 값 | 제품 API(`api/product/`) 호환 이름 |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 secret 키와 같은 값 | 제품 API 호환 이름(없으면 `SUPABASE_SECRET_KEY`로 읽음) |
| `PRODUCT_PROJECT_ID` | 위 SQL의 `YOUR_PRODUCT_PROJECT_ID`와 같은 문자열 | 제품 자료의 프로젝트 구분 |
| `AI_DAILY_LIMIT` (선택) | 내가 정한 숫자, 기본값 20 | `/api/ai` 사용자별 하루 상한 |
| `AI_PROXY_URL`·`AI_API_KEY` (선택) | 외부 AI를 쓸 때만 | 없으면 `/api/ai`가 503으로 정직하게 답함 |
| `ALEPH_EXECUTOR_URL` (선택) | 방어전 제공자가 주는 실행기 주소 | 제품 3단계 외부 실행기 연결 |
| `PRODUCT_BURST_WINDOW_MS` (선택) | 기본값 600000 | `burst_read` 탐지 시간창 |
| `PRODUCT_BURST_THRESHOLD` (선택) | 기본값 121 | `burst_read` 탐지 건수 |
| `PRODUCT_APPROVAL_TTL_MS` (선택) | 기본값 0(만료 없음) | 대응 승인 유효기간 |

3. 배포가 끝나면 **Vercel이 제공하는 저장소·커밋·배포 URL 정보**를 확인합니다: 대시보드의 Deployments에서 최신 배포의 커밋이 내가 올린 커밋과 같은지 비교하고, 배포 주소(Domains의 `*.vercel.app` 주소)를 메모합니다.
4. `aleph.config.json`의 `publicAppUrl`이 그 배포 주소와 같은지 확인하고, 다르면 고쳐서 다시 push합니다.

## 3. 첫 확인

- `https://(내 배포 주소)/` → 첫 화면이 열리는지
- `https://(내 배포 주소)/api/ai` → 로그인 없이 `401`이 오는지 (정상)
- `https://(내 배포 주소)/api/product/v1/health` → JSON이 오는지

## 4. 되돌리는 법

- Vercel Deployments에서 이전 배포의 ⋯ → **Promote**로 되돌립니다.
- Supabase 변경은 `docs/`의 백업 절차로 만든 백업으로 복원합니다.

## 이 안내만으로 안 되는 것(정직한 한계)

- Supabase Auth에서 로그인용 사용자 계정을 만드는 절차는 본인 이메일 인증이 필요해 대시보드 화면에서 직접 해야 합니다.
- 심판·실행기처럼 외부에서 오는 주소는 제공자가 주는 값이 있어야 완전히 동작합니다.
