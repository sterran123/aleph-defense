# BYTE BACK 방어전 · 12단계 저장점

## 12단계 저장점 · 탈환 작전실을 완성합니다

- `aleph.config.json`은 `step: 12`를 기록합니다. 작전실은 막는 도구가 아니라 보는 도구입니다.
- **작전실 화면**: 승인된 기기에서만 열리는 `탈환 작전실` 패널(`public/index.html`, `public/app.js`)이 `GET /api/operations`의 응답만 표시합니다. 판정기 규칙(`policy.ruleIds`), 탐지 사건, 회수 상태, 복구 버전 요약 카드와 1~11단계 점검 표를 그대로 그립니다. 가상 메모 본문은 화면과 응답 어디에도 없습니다.
- **41종 점검 표**: `src/operations-api.mjs`의 표는 단계·종류(정상/금지)·요청·기대 결과를 고정해 두고, 서버가 실제로 보낸 요청만 `measured`·실제 결과·요청 ID·확인 시각으로 채웁니다. 보내지 않은 시험은 `not_run`으로 남고 `actual`·`requestId`·`checkedAt`이 `null`입니다. `checkCounts`(total·measured·matched·notRun)는 항상 표 내용과 일치합니다.
- **출처 구분**: 응답의 `sources`가 학생 작업과 제공 엔진을 나눕니다.
  - **학생 작업**: `src/decider.mjs`의 판정 규칙, `src/detect.mjs`의 탐지 규칙, `src/policy-restore.mjs`의 복구 검증, 자료실 API, PWA·작전실 화면은 학생이 만든 코드입니다.
  - **제공 엔진**: 신원·기기·경로 검증과 실제 사건 전달·회수는 제공된 **ALEPH SDP 엔진**이 담당하며 학생 코드가 아닙니다.
  - 엔진이 보낸 검증 사건이 없으면 `detection`·`revocation`·`engineRuntimeEvidence`는 `not_run`이며 임의로 채우지 않습니다.
- **자기 점검 구분**: `npm run bundle`의 `attackAttempts`는 격리 심판이 요청 기록을 제공하지 않으므로 모든 항목을 `not_run`으로만 남깁니다. 작전실 서버의 실측 7건과 제출 격리 환경의 미실행 기록을 합치거나 성공으로 승격하지 않습니다.
- **복구 버전**: `recovery` 요약은 `backups/step10/safe-policy.json`의 내용 해시를 응답 시점에 다시 검증한 결과와 버전·커밋 앞자리만 보고합니다.
- **실행·중지·복구 안내**:
  1. 설치: 저장소 루트에서 `npm ci` (Node ≥22). 브라우저에는 설치 프로그램이 따로 없고, 앱 설치는 manifest의 설치 버튼으로만 진행됩니다.
  2. 실행: Vercel 배포는 `npm run build`가 `public/`을 만들며, 환경 변수 `SUPABASE_URL`·`SUPABASE_SECRET_KEY`·`SUPABASE_PUBLISHABLE_KEY`와 10단계 `RESTORE_NOTE_BACKUP_JSON`·`RESTORE_NOTE_BACKUP_SHA256`은 배포 플랫폼의 비밀 입력란에만 둡니다.
  3. 학생 판정기·탐지 규칙 확인: `npm run decider:test`, `npm run detect:test` (가상 입력 연습이며 엔진 판정이 아닙니다).
  4. 중지: 배포 주소의 정적 파일·서버 함수를 내리면 됩니다. 브라우저 쪽 세션은 `HttpOnly` 쿠키 만료 또는 로그아웃으로 끝나고, 기기 승인은 서버 `device_approvals` 행의 `status`를 `revoked`로 바꾸면 다음 요청부터 403으로 닫힙니다.
  5. 복구: `npm run restore:plan`으로 사본과 현재 정책 차이를 보고 `npm run restore:apply -- --confirm=<버전>`으로 되돌립니다. 비공개 메모는 `POST /api/restore/notes/:id`가 환경 변수 사본만으로 복원합니다.
- 로컬 확인: `npm run operations:test`(41종 표와 요약 수치 일치), `npm run device:test` 9개, `npm run test:stage10` 15개, `npm run test:stage3` 6개, `npm run test:stage8` 10개, `npm run test:package` 4개, `npm run test:r5` 2개 통과. 모두 가상·단위 시험이며 실제 엔진 연동, Production 배포 또는 심판 판정의 증거는 아닙니다.

## 11단계 저장점 · 나만의 접속 앱을 완성합니다

- `aleph.config.json`은 `step: 11`을 기록하고 `allowedRoutes`에 `GET·POST /api/auth`, `GET·POST /api/device-approval`, `GET /api/notes`를 추가합니다.
- **설치형 웹앱**: `public/manifest.webmanifest`·`public/app-icon.svg`·`public/service-worker.js`·`public/offline.html`을 추가했습니다. 설치 버튼은 `beforeinstallprompt`가 있을 때만 나타나고, 설치 여부는 기기 승인의 근거가 아닙니다. 오프라인 안내 페이지는 보호 자료와 승인 상태가 서버 확인이 필요하다고만 적습니다. 서비스 워커는 `/api/` 요청을 캐시하지 않습니다.
- **서버 세션 로그인**: `src/auth-session.mjs`는 이메일·비밀번호 로그인을 서버의 공식 Supabase SDK(`@supabase/supabase-js`)로 처리하고 세션을 `__Host-notes-access`·`__Host-notes-refresh` 쿠키(`HttpOnly; Secure; SameSite=Strict`)에만 둡니다. 응답 JSON에는 토큰을 넣지 않고, 만료된 접근 토큰은 refresh 토큰으로 갱신한 뒤 새 토큰을 다시 검증합니다. 브라우저의 변경 요청은 같은 출처에서만 받습니다. 검증된 Bearer 요청(운영 엔진·심판)은 기존 계약 그대로 통과합니다.
- **기기 승인**: `src/device-approval.mjs`는 기기 식별자를 `__Host-device-id` 쿠키로만 관리하고 승인 상태를 서버 Supabase 테이블(`sql/step11-device-approval.sql`의 `device_approvals`)에서 읽습니다. `POST /api/device-approval`의 요청 버튼은 `pending` 행만 만들며 권한을 주지 않고, 서버 행이 `approved`일 때만 보호 API를 통과시킵니다. 응답에는 기기 ID 대신 앞 8글자 요청 코드만 보입니다. 승인 전에는 화면에서도 보호 자료와 작전 기록을 표시하지 않습니다. 브라우저 저장소(localStorage·sessionStorage·IndexedDB)에는 기기 키나 토큰을 넣지 않습니다.
- 로컬 확인: `npm run device:test` 9개, `npm run test:stage3` 6개, `npm run test:stage10` 15개, `npm run test:stage8` 10개, `npm run test:package` 4개, `npm run test:r5` 2개, `npm run operations:test` 통과. 모두 가상·단위 시험이며 실제 엔진 연동, Production 배포 또는 심판 판정의 증거는 아닙니다.

## 10단계 저장점 · 백업에서 자료실을 되살립니다

- `aleph.config.json`은 `step: 10`, `restoreRoute: "POST /api/restore/notes/:id"`, `auditRoute: "/api/notes/audit"`를 기록합니다. `allowedRoutes`에 `POST /api/restore/notes/:id`, `GET /api/notes/restore`, `GET /api/notes/audit`, `GET /api/operations`를 등록합니다.
- **검증된 안전 정책 사본**: `backups/step10/safe-policy.json`과 그 SHA-256을 `backups/step10/safe-policy.sha256`에 커밋해 둡니다. `src/policy-restore.mjs`의 `verifyPolicySnapshot`이 사본 본문 해시를 먼저 대조하고, `diffTestPolicy`가 사본과 현재 시험 정책(`test/fixtures/step10-current-policy.json`)의 차이만 실행 전에 보여 줍니다. 사본이 없거나 검증에 실패하면 아무것도 쓰지 않고 중단합니다.
- **시험 정책 되돌리기**: `npm run restore:plan`은 바뀔 규칙 목록만 출력하고, `npm run restore:apply -- --confirm=<사본 버전>`은 버전 문자열 확인 후 `artifacts/step10-restored-policy.json`에만 씁니다. `restoreTestPolicy`는 `student-notes`의 규칙만 교체하고 다른 서비스 규칙과 `auditHistory`는 그대로 보존하며 운영 정책은 건드리지 않습니다.
- **비공개 가상 메모 복원**: `POST /api/restore/notes/:id`는 비공개 사본을 서버 환경 변수(`RESTORE_NOTE_BACKUP_JSON`, `RESTORE_NOTE_BACKUP_SHA256`)에서만 읽습니다. 요청 본문으로 소유자·역할·내용을 받지 않고, 사본 전체 해시·메모 ID·소유자 UUID·본문 해시를 모두 대조한 뒤 지정된 한 건만 `vault_notes`에서 되돌립니다. 사본 없음·검증 실패는 `503`, 사본에 없는 대상은 `404`, 사본 소유자가 아닌 호출자는 `403`, 본문이 이미 같으면 쓰지 않고 `restored:false`를 돌려줍니다. 응답에는 메모 본문 대신 `id`·`ownerVerified`·`contentSha256`·`restored`만 남깁니다.
- **감사·재시험 표면**: `GET /api/operations`는 검증된 호출자에게 단계별 점검 표를 돌려주며 실제로 보낸 요청만 `measured`로, 나머지는 `not_run`으로 남겨 결과를 꾸미지 않습니다. `recovery` 요약은 사본 해시를 그때 다시 검증한 결과만 보고합니다. `GET /api/notes/audit`는 호출자 본인의 감사 이력(생성·수정·삭제·복원·검증 거부 포함)을 반환하고, `POST /api/notes/restore`는 저장된 사본을 다시 읽어 복원한 뒤 `restore.retests`에 복구 직후 실제로 재실행한 정상·금지 요청 결과를 담습니다.
- 복구 뒤 재실행 순서:
  1. `npm run restore:plan` (검증된 사본과 현재 시험 정책 차이 확인)
  2. `npm run test:r5` (배포 메타데이터 및 인증 검사)
  3. `npm run test:stage3` (소유자 격리 및 타인 접근 404 확인)
  4. `npm run test:stage8` (구역 분리 및 공지 쓰기 차단 확인)
  5. `npm run detect:test` (다량 조회 탐지 및 회수 제안 확인)
  6. `npm run decider:test` (등록 기기 허용 및 미등록 거부 확인)
  7. `npm run test:stage10` (사본 재읽기·해시 일치·감사 기록·대상 외 메모 보존·엄격 복원 경로 확인)
  8. `npm run bundle` (배포 대상 공격 점검: 로그인 없는 목록·복원·감사·작전 요청 거부 포함)
- 로컬 연습 도구: `npm run backup`은 `local-vault.json`의 사본을 `backups/`에 지문 파일과 함께 저장하고, `npm run restore`는 사본 지문을 다시 읽어 검증한 뒤 바뀔 항목을 먼저 보여 주고 `--yes`로만 실제로 되돌립니다. 손댄 사본은 거부됩니다. `backups/` 아래 `step10/`의 검증 사본만 Git에 커밋하고 연습 산출물은 무시합니다.
- 로컬 확인: `npm run detect:test` 6개, `npm run test:stage8` 10개, `npm run test:r5` 2개, `npm run test:stage3` 6개, `npm run test:package` 4개, `npm run test:stage10` 15개 통과. 모두 가상·단위 시험이며 실제 엔진 연동, Production 배포 또는 심판 판정의 증거는 아닙니다.

## 9단계 저장점 · 도플갱어를 찾고 권한을 거둡니다

- `aleph.config.json`은 `step: 9`, 기존 배포 주소와 로그인 발급자, 원본 API 주소를 보존합니다.
- `src/detect.mjs`의 `detect(events)`는 가상 사건에서 가명 사용자의 10분 구간 다량 조회(120건 초과) 또는 평소와 다른 네트워크와 급증 조회가 함께 나타날 때 `action: "propose_revocation"`과 `reasonCode: "burst_read"`를 반환합니다.
- 정상 조회 120건 이하 및 10분 밖으로 분산된 사건은 `action: "observe"`로 유지하며 임의로 권한을 변경하지 않습니다.
- 로컬 확인: `npm run detect:test` 6개, `npm run test:stage8` 10개, `npm run test:r5` 2개, `npm run test:stage3` 6개 통과. 모두 가상·단위 시험이며 실제 엔진 연동, Production 배포 또는 심판 판정의 증거는 아닙니다.

## 8단계 저장점 · 자료마다 접근 구역 분리

- `aleph.config.json`은 `step: 8`, 기존 Production 주소와 로그인 발급자, 원본 API 주소를 보존하고 `notes`와 `announcements`를 서로 다른 자원 ID로 선언합니다. 기존 메모 API 경로를 유지하며 공지 API 경로를 별도로 등록합니다.
- `src/resource-ids.mjs`는 정확한 API 경로와 엔진 확인 `service`·`method`·`path`·`route` 조합으로만 자원을 식별합니다. 쿼리로 동작을 선택하지 않으며 `export` 같은 미등록 경로는 거부합니다.
- `src/decider.mjs`는 엔진 확인 사용자·기기 문맥과 등록 기기 상태를 요구하고 메모의 허용 경로만 통과시킵니다. 기존 6·7단계 규칙은 유지합니다. 사람별 메모 소유권은 판정 요청에 없는 값으로 추정하지 않고 최종 API에서 검증합니다.
- `/api/notes`는 검증된 Supabase 사용자만 owner로 저장하고 다른 소유자의 읽기·수정·삭제를 404로 거부합니다. `/api/announcements/:id`는 현재 검증 가능한 강사 역할과 공지 저장소가 없으므로 인증된 사용자도 403으로 fail-closed 처리합니다. 화면 메뉴는 바꾸지 않았습니다.
- 로컬 확인: `npm run test:stage8` 10개, `npm run test:stage3` 6개, `npm run decider:test` 4개, `npm run fixture:7` 통과. 모두 가상·단위 시험이며 실제 엔진 연동, Production 배포 또는 심판 판정의 증거는 아닙니다.

## 7단계 저장점 · 복합 이상 접속은 추가 확인

- `aleph.config.json`은 `step: 7`과 Production 별칭 `https://aleph-defense-three.vercel.app`을 기록하고, 실제 배포 호스트와 커밋은 생성된 `/aleph.json`에서 확인합니다.
- `src/decider.mjs`는 검증된 가상 `judge_fixture` 입력에서만 복합 신호를 해석합니다. 00:00-05:59 또는 22:00-23:59의 시간, `network: "unusual"`, 최근 300초 안의 `risk_signal` 20회 이상이 함께 있어야 `step_up / step_up_required`를 반환합니다. 지역 차이만으로 차단하지 않습니다.
- 신호 출처가 누락되거나 불명확한 경우에는 정상값을 만들어 채우지 않고 재확인을 요구합니다. `source: "none"`은 실제 신호가 없다는 뜻이며, 가상 공격 신호나 실시간 탐지를 뜻하지 않습니다. 엔진이 확인한 `stepUp: { verified: true, authAgeSeconds: 0..900 }`만 재확인 완료로 인정합니다.
- 로컬 확인: `npm run decider:test`의 정상·미등록·복합 이상·재확인 후 허용 테스트 4개, `npm run fixture:7`의 정상 `allow` 및 복합 이상 `step_up`. 모두 가상 입력 테스트이며 실제 엔진 연동, Production 배포 또는 심판 통과의 증거는 아닙니다.




이 저장소는 1~5단계에서 만든 같은 자료실을 이어서 개발합니다. 데이터와 테스트 계정은 실습용 가상 자료입니다. 실제 개인정보, 비밀번호, 토큰, 비밀 키를 넣지 마세요.

## 6단계 저장점 · 등록 기기만 자료실에 접근

- `aleph.config.json`은 `step: 6`, `serviceId: "notes"`, `readPath: "/notes"`를 기록합니다. 서비스 ID와 경로는 `docs/DECIDER_REQUEST.md`의 `notes` 서비스 및 `GET /notes/:id` 계약 예시와 맞춥니다. 인증서·CA·서명 키를 새로 만들거나 저장하지 않습니다.
- `src/decider.mjs`는 엔진이 확인한 `deviceRegistered`만 신뢰합니다. 등록된 요청은 `allow / approved`, 미등록 또는 확인되지 않은 요청은 `deny / device_not_registered`로 판정하며 `device_registered` 규칙을 반환합니다. 브라우저가 보낸 사용자·역할·기기 키는 사용하지 않습니다.
- 로컬 확인: `npm run decider:test` 2개, `npm run test:r5` 2개, `npm run test:package` 4개, `npm run test:stage3` 6개 통과. `npm run build -- --local`도 통과했습니다. 이 결과는 엔진 연결, Production 배포 또는 심판 통과를 의미하지 않습니다.
- 6단계에는 별도로 설치할 프로그램이나 설치 명령이 없습니다. 저장소 루트에서 `npm run decider:test`를 실행해 등록 기기의 정상 요청은 허용되고, 미등록 기기의 가상 요청은 `deny / device_not_registered`로 거부되는지 확인합니다. 이 로컬 연습은 실제 엔진 연결, Production 배포 또는 심판 판정을 증명하지 않습니다. 비밀값은 Git이나 로그에 넣지 않습니다.

## 5단계 서버 전용 데이터 접근과 사용자별 메모 API



- 브라우저는 Supabase 공식 JavaScript SDK를 이메일·비밀번호 로그인과 로그아웃에만 사용합니다. `public.vault_notes`의 데이터 CRUD는 브라우저에서 직접 호출하지 않고 `/api/notes` 서버 함수로 처리합니다. 브라우저용 Supabase URL과 publishable key는 빌드 시 `public/auth-config.json`에 주입되며, 이 파일은 Git에서 무시합니다.

- `/api/notes`와 `/api/notes/:id`는 `src/verify-login.mjs`로 bearer 토큰을 검증합니다. `aleph.config.json`의 `identityProvider`는 Supabase Auth issuer, `authenticated` audience, JWKS 주소를 기록합니다. 브라우저가 보낸 `userId`나 `role`은 신뢰하지 않습니다. `SUPABASE_SECRET_KEY`는 서버 함수에만 사용합니다.

- `GET /api/notes`는 검증된 사용자 ID의 `owner_id` 행만 반환하고, POST는 확인된 ID를 `owner_id`로 저장합니다. 항목 GET/PUT/DELETE도 ID와 검증된 소유자를 함께 확인하며, 타인 항목은 404로 돌려줍니다. 요청 본문의 `owner_id`는 신뢰하지 않고 수정 입력에도 허용하지 않습니다.

- `public.vault_notes`에는 RLS와 소유자 정책이 유지됩니다. Stage 5에서는 `PUBLIC`, `anon`, `authenticated`의 직접 테이블 권한을 회수하고 `service_role`의 기존 권한은 변경하지 않습니다. 서버 함수는 `SUPABASE_SECRET_KEY`로 테이블에 접근하고 API에서도 소유자를 다시 확인합니다.

- 5단계 당시 `aleph.config.json`에는 원본 Supabase Data API 주소를 기록했습니다. 현재 `step: 7`과 Production 별칭은 위 7단계 저장점에, 실제 배포 호스트와 커밋은 생성된 `/aleph.json`에 기록됩니다. `data.json`과 `public/data.json`은 최신 저장소와 새 정적 배포물에서 제외합니다.



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

## 13단계 저장점 (배포 묶음 + 미구현 API 실구현)

- `npm run package` — `package/`의 배포 묶음을 검증(설치 안내·구성도·규칙 목록·캡처 목록·비밀값 검사)하고 `artifacts/ztna-package/`로 조립합니다.
- `api/ai.js` — 로그인 필수 + 사용자별 하루 상한(Supabase `ai_usage` 표, `AI_DAILY_LIMIT` 기본 20) + 서버 환경변수 키로만 외부 AI 중계(없으면 503 `AI_NOT_CONFIGURED`). `supabase/migrations/20261019_stage13_ai_usage.sql` 실행 필요.
- `api/threat-intel.js` — 로그인 필수 + CISA KEV·NVD 실조회 + 6시간 캐시 + `fetchedAt` 응답.
- `api/product/[...path].mjs` — 4차 제품 API(D1~D4)를 `/api/product/v1/*`로 서빙. 제품 탐지·승인 파라미터는 `PRODUCT_BURST_WINDOW_MS`·`PRODUCT_BURST_THRESHOLD`·`PRODUCT_APPROVAL_TTL_MS`로 조정(기본값=계약 동일).
- `aleph.config.json`: step 12 유지(묶음 도구 상한). `allowedRoutes`에 `/api/ai`·`/api/threat-intel`·`/api/product/v1/*` 등록.
- 확인한 시험: `npm run test:package` 4/4, `test:stage10` 15/15, `cd product && npm test` 22/22 통과.
- 남은 수동 작업: Supabase SQL(ai_usage·product_kv·product_operator), Vercel 환경변수, 배포 확인 후 방어전 페이지 제출.

