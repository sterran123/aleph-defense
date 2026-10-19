# 방어전 4~6차 제품 HTTP 계약 r2

- 작성: Claude, 2026-10-07 02:0x KST. 상태: **r2, Codex #228 조건부 ACK 반영**. r1 과 달라진 곳은 §1 실행 공간, §3 등록 실패 처리, §4 규칙 어휘, §5 사건 응답 형식, §7 정리 범위입니다.
- 학생 시작 틀 `student-kit/defense-product-v6` 의 제공 코드(`src/platform/`)가 이 계약을 그대로 구현합니다.
- 공개 계약 패키지: `packages/defense-product-contracts` 0.1.3. 정책·백업·작업 키 형식은 그 패키지를 따릅니다.
- 원칙: 학생이 3차까지 만든 인증·DB를 다시 만들게 하지 않습니다. 아래 경로는 기존 앱 위에 얹는 **얇은 감싸기(wrapper) 경로**이며, 안쪽 구현은 학생 앱의 기존 Supabase(또는 막힌 학생만 로컬 대체)를 씁니다. 학생 결제 0원.

## 1. 공통

- 접두어: `/api/product/v1`. 모든 응답은 `application/json; charset=utf-8`.
- 인증: `Authorization: Bearer <accessToken>`. 토큰은 §2 의 로그인 경로로 받습니다. 시험 전용 헤더로 인증·권한 검사를 건너뛰는 경로를 만들면 안 됩니다.
- 오류 본문: `{ "error": { "code": "<소문자 코드>", "detail": "<사람이 읽을 설명>" } }`.
  - 400 형식 오류, 401 인증 없음·만료, 403 권한 없음, 404 없음, 409 충돌(정책 판 경합·작업 키 내용 불일치), 422 계약 위반(예: 손상 백업), 429·503 잠시 뒤 다시.
- 시험 실행 ID: 심판은 플랫폼에 등록한 실행 UUID 를 `X-Aleph-Run-Id` 로 붙입니다. 이 머리글이 있으면 제공 핸들러가 **실행 공간**(모음 이름 앞에 `run:<실행ID>/`)을 따로 써서 정책·사건·자원·대응·차단 기록이 학생의 실제 자료와 섞이지 않습니다. 로그인 계정과 역할 표만 실제 공간을 함께 씁니다. 실행 ID 는 권한 판단에 쓰지 않으며, 인증·역할 검사는 실행 공간에서도 그대로 합니다.
- 조회 쿼리: `GET /events` 는 `from`·`to`·`kind`·`subject`·`limit`(1~1000)·`cursor` 만 받습니다. `GET /policy/history` 는 `limit` 만 받습니다.
- 응답 머리글(보호 자원 응답 필수): `X-Aleph-Policy-Revision`, `X-Aleph-Policy-Digest`(공개 패키지 `policyDigest` 값), `X-Aleph-Decision`(`allow`·`deny`·`step_up`), `X-Aleph-Rule-Ids`(쉼표 구분).

## 2. 상태와 로그인

| 메서드·경로 | 누가 | 요청 | 응답 |
|---|---|---|---|
| `GET /health` | 누구나 | — | `{ schema:"aleph.product.health.v1", contracts:"0.1.3", projectId, commit, startedAt }` |
| `POST /auth/login` | 누구나 | `{ email, password }` | `{ accessToken, expiresIn }` · 실패 401 |
| `GET /me` | 로그인 사용자 | — | `{ userId, role }` 본인 것만(제공 핸들러). 심판이 D3 대상 `subject:<userId>` 를 만들 때 씁니다 |

`/auth/login` 은 학생 앱의 기존 로그인(Supabase Auth 등)을 서버에서 대신 부르는 감싸기입니다. 심판은 401·403 로그인 응답을 다시 시도하지 않으며, 로그인 실패(신원 문제)와 정책의 추가 확인(§5 의 401 `step_up_required`)을 구별합니다. 브라우저 로그인 화면은 그대로 둡니다. 심판은 이 경로 하나로 로그인하므로 인증 백엔드가 무엇이든 같은 방식으로 시험할 수 있습니다.

## 3. 역할과 시험 신원

- 역할은 두 가지입니다. `member`(일반 사용자 A·B), `operator`(관리 작업 신원). 역할은 학생 서버 DB 의 역할 표에서 읽고, 브라우저가 보낸 role 값은 믿지 않습니다.
- 시험 신원 세 개: `A`(member), `B`(member), `OP`(operator). 모두 학생 앱의 **일반 계정**이고 이 시험 프로젝트 범위만 가집니다.
- 발급 절차(제안, 자격 보관은 Codex X3):
  1. 학생이 자기 PC 에서 시작 틀의 `npm run test-identities` 를 실행합니다. 스크립트가 무작위 비밀번호로 세 계정을 학생 프로젝트에 만들고 역할 표에 기록합니다. 비밀번호는 화면·파일·저장소에 남기지 않습니다.
  2. 같은 스크립트가 세 자격을 플랫폼의 보호 저장 경로(X3 가 정함)로 한 번만 보냅니다. 학생은 ALEPH 로그인 상태에서 이 전송을 승인합니다.
     - 계정을 만들기 **전에** 보호 저장 사전 점검을 합니다. 점검이 실패하거나 등록 경로가 없으면 계정을 만들지 않고 멈춥니다(UNV_TEST_IDENTITY_UNAVAILABLE). 성공 문구를 띄우거나 자격을 평문 파일로 대신 남기지 않습니다.
     - 업로드 응답을 못 받았으면 같은 발급 ID 로 상태를 조회한 뒤 다시 보냅니다. 중복 계정·중복 기록을 만들지 않습니다.
     - 알려진 실패로 끝나면 그 실행에서 방금 만든 합성 계정만 지웁니다. 기존 계정·역할은 건드리지 않습니다.
     - 현재 시작 틀의 `--supabase --register` 는 등록 경로(X3)가 준비되기 전까지 계정을 만들지 않고 종료합니다. `--local` 은 내 PC 연습용입니다.
  3. 플랫폼은 수명(예: 6차 종료 + 3일)이 지나면 자격을 폐기합니다. 학생은 `npm run test-identities -- --remove` 로 계정을 지울 수 있습니다.
- 학생 서비스 키는 플랫폼으로 보내지 않습니다. 계정 생성은 학생 PC 에서만 일어납니다.

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
