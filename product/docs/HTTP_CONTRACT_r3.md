# 방어전 4~6차 제품 HTTP 계약 r3

- 작성: Claude, 2026-10-07 03:0x KST. 상태: **r3 초안, Codex CHECK 대기**. r2에서 §1 집행 이용권 머리글, §9 제공자 집행 서비스와 집행 기록, §10 제공 파일 무결성을 추가했습니다(#239 P1 "동시 승인 중복 집행을 판정이 못 잡음" 해소용). §3은 현재 구현과 공식 신원 등록 설계를 구분해 안내합니다.
- 학생 시작 틀 `student-kit/defense-product-v6`의 제공 코드(`src/platform/`)는 로그인·역할 확인·HTTP 경로·저장소 연결을 담당합니다. 정책·사건·대응·복구 업무 함수는 학생이 `src/product/index.mjs`에 구현해야 합니다.
- 공개 계약 패키지: `packages/defense-product-contracts` 0.1.4. 정책·백업·작업 키 형식은 그 패키지를 따릅니다.
- 원칙: 학생이 3차까지 만든 인증·DB를 다시 만들게 하지 않습니다. 아래 경로는 기존 앱 위에 얹는 **얇은 감싸기(wrapper) 경로**이며, 안쪽 구현은 학생 앱의 기존 Supabase(또는 막힌 학생만 로컬 대체)를 씁니다. 학생 결제 0원.

현재 r6 일정은 2026년 한국 시간 기준 3차 10/13~16(기존 6~12단계 + 필수 XDR 6개), 4차 10/19~23(D1~D4 실구현 60점), 5차 10/26~27(통합·변경 합산 15점 + v0.9 릴리스 10점), 6차 10/28~29(수복 15점 + v1.0 완성)입니다. 제품 100점은 기존 19개 항목의 평가와 별개입니다. 유료 가입·카드 등록·API 충전·유료 호스팅·도메인·장비 구매·추가 점수 결제를 요구하지 않습니다. 자료 미리 보기와 선행 개발은 가능하며, 실제 차수 개시·제출은 서버가 확인한 기간·개방 상태·권한을 따릅니다. 자세한 내용은 [학생 안내서](./STUDENT_GUIDE.md)를 보세요.

아래 계약과 제공 코드는 운영 심판·집행 제공자·공식 시험 신원 등록·중앙 DB 연결의 준비 완료를 보증하지 않습니다. 제공자 환경이 준비되지 않아 확인할 수 없는 결과는 미검증(UNV)으로 구분하며 학생 실패로 세지 않습니다.

## 1. 공통

- 접두어: `/api/product/v1`. 모든 응답은 `application/json; charset=utf-8`.
- 인증: `Authorization: Bearer <accessToken>`. 토큰은 §2 의 로그인 경로로 받습니다. 시험 전용 헤더로 인증·권한 검사를 건너뛰는 경로를 만들면 안 됩니다.
- 오류 본문: `{ "error": { "code": "<소문자 코드>", "detail": "<사람이 읽을 설명>" } }`.
  - 400 형식 오류, 401 인증 없음·만료, 403 권한 없음, 404 없음, 409 충돌(정책 판 경합·작업 키 내용 불일치), 422 계약 위반(예: 손상 백업), 429·503 잠시 뒤 다시.
- 시험 실행 ID: 심판은 플랫폼에 등록한 실행 UUID 를 `X-Aleph-Run-Id` 로 붙입니다. 이 머리글이 있으면 제공 핸들러가 **실행 공간**(모음 이름 앞에 `run:<실행ID>/`)을 따로 써서 정책·사건·자원·대응·차단 기록이 학생의 실제 자료와 섞이지 않습니다. 로그인 계정과 역할 표만 실제 공간을 함께 씁니다. 실행 ID 는 권한 판단에 쓰지 않으며, 인증·역할 검사는 실행 공간에서도 그대로 합니다.
- 집행 이용권(r3): 심판은 실행마다 발급한 이용권을 `X-Aleph-Executor-Grant` 로 붙입니다. `X-Aleph-Run-Id` 없이 오면 400 `executor_grant_invalid`. 제공 핸들러는 이 값을 학생 업무 코드(ctx)에 넘기지 않고, 그 실행 공간의 집행기를 제공자 집행 서비스(§9)로 바꾸는 데만 씁니다.
- 조회 쿼리: `GET /events` 는 `from`·`to`·`kind`·`subject`·`limit`(1~1000)·`cursor` 만 받습니다. `GET /policy/history` 는 `limit` 만 받습니다.
- 응답 머리글(보호 자원 응답 필수): `X-Aleph-Policy-Revision`, `X-Aleph-Policy-Digest`(공개 패키지 `policyDigest` 값), `X-Aleph-Decision`(`allow`·`deny`·`step_up`), `X-Aleph-Rule-Ids`(쉼표 구분).

## 2. 상태와 로그인

| 메서드·경로 | 누가 | 요청 | 응답 |
|---|---|---|---|
| `GET /health` | 누구나 | — | `{ schema:"aleph.product.health.v1", contracts:"0.1.4", projectId, commit, startedAt }` |
| `POST /auth/login` | 누구나 | `{ email, password }` | `{ accessToken, expiresIn }` · 실패 401 |
| `GET /me` | 로그인 사용자 | — | `{ userId, role }` 본인 것만(제공 핸들러). 심판이 D3 대상 `subject:<userId>` 를 만들 때 씁니다 |

`/auth/login` 은 학생 앱의 기존 로그인(Supabase Auth 등)을 서버에서 대신 부르는 감싸기입니다. 심판은 401·403 로그인 응답을 다시 시도하지 않으며, 로그인 실패(신원 문제)와 정책의 추가 확인(§5 의 401 `step_up_required`)을 구별합니다. 브라우저 로그인 화면은 그대로 둡니다. 심판은 이 경로 하나로 로그인하므로 인증 백엔드가 무엇이든 같은 방식으로 시험할 수 있습니다.

## 3. 역할과 시험 신원

- 역할은 두 가지입니다. `member`(일반 사용자 A·B), `operator`(관리 작업 신원). 역할은 학생 서버 DB 의 역할 표에서 읽고, 브라우저가 보낸 role 값은 믿지 않습니다.
- 시험 신원 세 개: `A`(member), `B`(member), `OP`(operator). 모두 학생 앱의 **일반 계정**이고 이 시험 프로젝트 범위만 가집니다.
- 개인 프로젝트의 관리 작업자 초기화는 자기 Supabase의 서버 SQL 실행 환경에서 키트의 `supabase/product_kv.sql` → `supabase/product_operator.sql` 순서로 진행합니다. operator 템플릿에는 이메일 확인이 끝난 **본인 계정 UUID**와 서버 환경변수 `PRODUCT_PROJECT_ID`와 정확히 같은 프로젝트 ID를 넣습니다. 중앙 ALEPH DB에서 실행하지 마세요. 일반 로그인만으로 제품 operator 역할이 자동으로 생기지 않으며, 이 초기화는 공식 시험 신원 등록을 대신하지 않습니다.
- **현재 사용할 수 있는 로컬 연습:** 키트 폴더에서 `node scripts/test-identities.mjs --local`로 계정을 먼저 만든 뒤 `npm run start:local`로 서버를 시작합니다. 로컬 계정의 이메일·비밀번호는 내 PC 터미널에 출력됩니다. 외부에 복사하거나 올리지 마세요. 서버는 시작할 때 계정 파일을 읽으므로 재생성·삭제는 서버를 중지한 뒤 진행하고 다시 시작해야 합니다. 재생성은 같은 생성 명령, 삭제는 `node scripts/test-identities.mjs --local --remove`입니다. 재생성하면 계정 UUID·비밀번호가 바뀝니다.
- **현재 구현 미완료인 공식 시험 신원 등록:** `node scripts/test-identities.mjs --supabase --register`는 `ALEPH_IDENTITY_REGISTER_URL`을 설정해도 계정을 생성하지 않고 종료 코드 2로 끝납니다. 먼저 로컬 연습을 사용하세요. 공식 계정 생성·보호 저장 전송·만료 후 삭제 기능이 이미 제공되는 것으로 해석하면 안 됩니다.
- 공식 발급 절차는 다음 설계의 구현과 운영 검수가 필요합니다(자격 보호 저장은 Codex X3 담당).
  1. 계정 생성 **전** 보호 저장 경로를 사전 점검하고, 준비되지 않았으면 계정 생성 없이 `UNV_TEST_IDENTITY_UNAVAILABLE`로 중단합니다. 성공으로 표시하거나 자격을 평문 파일로 대신 남기지 않습니다.
  2. 준비된 경로에서 학생의 승인을 받은 뒤 합성 시험 계정 세 개의 자격을 한 번만 전송합니다. 공식 시험 비밀번호는 화면·파일·저장소에 남기지 않습니다. 응답을 받지 못하면 같은 발급 ID로 상태를 확인한 뒤 재시도하여 중복 계정·기록을 막습니다.
  3. 알려진 실패는 해당 실행에서 새로 만든 합성 계정만 정리하고 기존 계정·역할은 보존합니다. 수명 종료(예: 6차 종료 + 3일) 후 자격 폐기와 공식 계정 삭제 경로도 구현·검수가 필요합니다.
- 학생 서비스 키는 서버 환경변수에만 두고 플랫폼·브라우저·저장소·문서·채팅으로 보내지 않습니다.

## 4. D1 정책

| 메서드·경로 | 누가 | 요청 | 응답 |
|---|---|---|---|
| `GET /policy` | 로그인 사용자 | — | `{ active: <정책 스냅샷>, digest }` |
| `GET /policy/history` | operator | `?limit=` | `{ items: [{ revision, digest, activatedAt, activatedBy, source:"edit"|"rollback"|"restore" }] }` |
| `POST /policy/drafts` | operator | `{ snapshot }` | `{ draftId, digest }` · 형식 오류 422(`policy_*` 코드) |
| `POST /policy/activate` | operator | `{ draftId, expectedRevision }` | `{ revision, digest }` · 현재 판이 `expectedRevision` 와 다르면 409 |
| `POST /policy/rollback` | operator | `{ toRevision, expectedRevision }` | 예전 내용을 **새 판 번호**로 활성화 `{ revision, digest }` |

- member 가 위 쓰기 경로를 부르면 403.
- 규칙 어휘(공통 최소 약속, 학생은 필드를 늘릴 수 있지만 이 뜻은 바꾸지 않습니다):
  `{ id, effect: 'allow'|'deny'|'step_up', priority?: 정수(기본 0), match?: { method?: 'GET'|'POST', zone?: 문자열 또는 '*', owner?: 'self'|'other'|'any', role?: 'member'|'operator' } }`
  - match 의 항목은 적혀 있을 때만 비교합니다. 요청의 owner 는 자원 소유자가 요청한 사람이면 'self', 아니면 'other' 이고, 쓰기(POST)는 늘 'self' 입니다.
  - 맞는 규칙 가운데 priority 가 가장 큰 것을 고르고, 같으면 deny > step_up > allow 순으로 더 엄한 것을 고릅니다.
  - 맞는 규칙이 없거나 정책이 없으면 deny 입니다.
- 판정은 서버가 활성 정책으로 합니다. 정책 교체 중 들어온 요청은 요청을 받은 순간의 판으로 판정하고, 그 판을 응답 머리글에 적습니다.

## 5. 보호 자원과 D2 사건

| 메서드·경로 | 누가 | 설명 |
|---|---|---|
| `GET /resources/:zone/:id` | 로그인 사용자 | 정책으로 판정되는 보호 자원. 허용 200, 거부 403(`error.code:"policy_denied"`), 추가 확인 401(`error.code:"step_up_required"`). 머리글 §1 필수 |
| `POST /resources/:zone` | 로그인 사용자 | 시험용 합성 자료 쓰기. 소유자는 서버가 토큰으로 정합니다 |
| `POST /events` | operator | 사건 묶음 `{ events:[{ id, at, kind, subject, … }] }` → `{ accepted: 정수, duplicates: 정수, conflicts: [id 문자열…] }`. 같은 내용 비교는 실행 공간 안에서 공개 직렬화 문자열(지문)로 합니다. 같은 id·같은 내용은 duplicates 로 세고 저장하지 않음, 같은 id·다른 내용은 conflicts 에 넣고 저장하지 않음. 형식이 틀린 사건이 하나라도 있으면 400 `event_invalid`, 아무것도 저장하지 않음 |
| `GET /events` | operator | `?from=&to=&kind=&subject=&cursor=&limit=` → `{ items, nextCursor }`. 사건 시각(`at`) 오름차순, 같은 시각이면 id 오름차순. 받은 순서와 무관 |
| `GET /incidents` · `GET /incidents/:id` | operator | 탐지 규칙이 만든 사건 묶음 `{ id, rule, subject, eventIds, firstAt, lastAt, policyRevision }`. 공통 규칙 burst_read: 같은 subject 의 kind 'read' 사건 중 시각 차이 600,000ms 미만인 것이 121건 이상이면 하나(같은 subject 에 열린 묶음은 하나) |

## 6. D3 대응

| 메서드·경로 | 누가 | 요청 | 응답 |
|---|---|---|---|
| `POST /responses` | operator | `{ operationKey, incidentId, target, action, payload }` | 새 작업 201 `{ operationKey, state:"pending", approval:"waiting" }` · 같은 키·같은 내용 200(처음 결과) · 같은 키·다른 내용 409 |
| `POST /responses/:key/approve` · `/reject` | operator | — | 승인 뒤 집행. `{ state:"succeeded"|"failed"|"pending" }` |
| `POST /responses/:key/release` | operator | — | 차단 해제. 해제도 이력으로 남김 |
| `GET /responses/:key` | operator | — | `{ state, approval, executedAt, releasedAt, attempts }` |

- 지문은 공개 패키지 `operationFingerprint({ projectId, target, action, payload })` 로 계산합니다. 집행은 키 하나당 한 번뿐이며, 승인 전에는 집행하지 않습니다.
- 집행 대상은 학생 자기 서버의 보호 자원(§5)입니다. 승인 뒤 대상 신원의 요청만 거부되고 다른 사용자는 계속 허용돼야 합니다.

## 7. D4 백업·복구와 시험 정리

| 메서드·경로 | 누가 | 요청 | 응답 |
|---|---|---|---|
| `POST /backups` | operator | `{ items:["policy.json","selected-events.json"] }` | `aleph.product.backup.v1` 문서 |
| `POST /restore` | operator | `{ backup }` | 성공 200 `{ revision, restored:[…] }` · 검증 실패 422 `error.code` = 공개 패키지 `verifyBackup` 코드, 상태 변화 없음 |
| `POST /test/reset` | operator | — (`X-Aleph-Run-Id` 필수) | 그 실행 공간의 시험 자료만 지움(감사 기록은 남김). 실제 공간의 자료·계정·역할·감사 기록은 건드리지 않음 |

## 8. r1 에서 넘어온 확인 사항의 결과(Codex #228)

1. 시험 신원 발급과 X3: 설계 ACK. 보호 저장의 실제 경로는 X3 구현 대기이며, 그 전에는 계정을 만들지 않습니다.
2. `/auth/login` 하나로 로그인: ACK.
3. step_up 을 401 + `step_up_required` 로 표시: ACK.
4. `/events`·`/test/reset`: 위 §5·§7 로 형식과 범위를 확정했습니다.

## 9. 제공자 집행 서비스와 집행 기록 (r3 신규)

- 왜: D3 "동시 승인 5건에도 실제 집행은 정확히 1번"을 학생 서버의 응답만으로는 증명할 수 없습니다. 학생 프로세스 안의 기록은 학생 코드가 지우거나 고칠 수 있기 때문입니다. 그래서 시험 중 집행은 **제공자가 띄운 집행 서비스**에서 일어나고, 기록도 거기에만 남습니다.
- 학생 쪽 설정: 서버 환경변수 `ALEPH_EXECUTOR_URL`(제공자가 알려 주는 주소) 하나. 주소는 머리글로 바꿀 수 없습니다. 주소나 이용권이 없으면 로컬 집행기를 그대로 씁니다(내 PC 개발·공개 시험 영향 없음).
- 집행 서비스 경로(`<ALEPH_EXECUTOR_URL>` 기준, 머리글 `Authorization: Bearer <이용권>`, `X-Aleph-Run-Id` 필수·이용권의 실행과 같아야 함):

| 메서드·경로 | 본문·쿼리 | 응답 |
|---|---|---|
| `POST apply` | `{ operationKey, target, action }` | 200 · 429(`Retry-After`) · 503 · 403 · 응답 없음(고장 주입) |
| `POST release` | `{ operationKey, target }` | 200 |
| `GET status?operationKey=` | — | `{ state: "applied"\|"released"\|"unknown" }` |
| `GET blocked?target=` | — | `{ blocked: true\|false }` |
| `GET clock` | — | `{ offsetMs }` 실행 공간 한정 시험 시계 차이. 심판만 `advanceClock` 으로 앞당기며, 학생 쪽에는 바꾸는 경로가 없습니다 |

- 집행 기록: 실제로 집행·해제한 경우에만 한 줄씩, 순번과 해시 사슬(`aleph.product.executor-log.v1`, 공개 패키지 `nextExecutorEntry`·`verifyExecutorLog`). 고장 주입 가운데 `lost` 는 집행·기록한 뒤 응답만 끊고, 나머지(`busy`·`limited`·`timeout`·`denied`)는 집행하지 않으므로 기록도 없습니다.
- 판정에서 쓰는 법: 동시 승인 뒤 `verifyExecutorLog(entries, { expectedHead })` 가 통과하고 `applies[operationKey] === 1` 이어야 D3 의 "한 번만 집행"을 인정합니다. 학생이 이용권을 엿보더라도 기록은 제공자 쪽에서 덧붙이기만 되므로 중복 집행을 감출 수 없습니다.
- 집행 서비스가 응답하지 않거나 기록 검사가 실패하면 제공자 장애로 보고 "미검증"으로 둡니다. 학생 실패로 세지 않습니다.
- 6차 시나리오 3(차단 기록과 실제 상태 불일치)의 시딩은 집행 서비스의 제공자 전용 `seedState` 로 합니다(기록은 남기지 않음). 판정기에는 `seedFault` 신뢰 콜백으로 넘깁니다(#244).
- 시험 시계(#244): 이용권이 붙은 요청이면 제공 핸들러가 요청마다 `GET clock` 을 한 번 읽어 `ctx.clock()` 에 더합니다. 5차 승인 만료(10~20분)는 심판이 `advanceClock` 으로 앞당겨 실제 대기 없이 확인합니다. 업무 코드가 `Date.now()` 를 쓰면 이 확인에서 실패합니다(학생 안내서에 이미 적힌 약속). 시계 콜백이 없는 실행은 그 확인만 미검증입니다.

## 10. 제공 파일 무결성 (r3 신규)

- 키트 루트의 `PLATFORM_SHA256SUMS` 가 제공 파일(`src/platform/`·`api/`·`vendor/`·`scripts/serve-local.mjs`·`scripts/test-identities.mjs`·`scripts/platform-sums.mjs`)의 해시를 담습니다. 학생은 `npm run check:platform` 으로 확인합니다.
- 심판은 제출 커밋에서 같은 파일을 공개 패키지 `verifyPlatformFiles` 로 대조합니다. 어긋나면 학생 실패가 아니라 "제공 파일 변경"으로 따로 표시하고 그 실행의 집행·격리 판정은 미검증으로 둡니다. 제공 폴더 안의 새 파일도 같은 표시 대상입니다.
- `.gitattributes` 로 줄바꿈을 LF 로 고정해, 윈도우에서 받아도 커밋 내용의 해시가 같게 둡니다.
