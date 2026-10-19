# 방어전 4~6차 제품 HTTP 계약 초안 r1

- 작성: Claude, 2026-10-07 01:2x KST. 상태: **초안, Codex ACK 전**. Codex #225 요청(C1·C3 시작 전 업무 경로·요청/응답·시험 신원 발급과 정리 인터페이스)에 대한 답입니다.
- 공개 계약 패키지: `packages/defense-product-contracts` 0.1.1. 정책·백업·작업 키 형식은 그 패키지를 따릅니다.
- 원칙: 학생이 3차까지 만든 인증·DB를 다시 만들게 하지 않습니다. 아래 경로는 기존 앱 위에 얹는 **얇은 감싸기(wrapper) 경로**이며, 안쪽 구현은 학생 앱의 기존 Supabase(또는 막힌 학생만 로컬 대체)를 씁니다. 학생 결제 0원.

## 1. 공통

- 접두어: `/api/product/v1`. 모든 응답은 `application/json; charset=utf-8`.
- 인증: `Authorization: Bearer <accessToken>`. 토큰은 §2 의 로그인 경로로 받습니다. 시험 전용 헤더로 인증·권한 검사를 건너뛰는 경로를 만들면 안 됩니다.
- 오류 본문: `{ "error": { "code": "<소문자 코드>", "detail": "<사람이 읽을 설명>" } }`.
  - 400 형식 오류, 401 인증 없음·만료, 403 권한 없음, 404 없음, 409 충돌(정책 판 경합·작업 키 내용 불일치), 422 계약 위반(예: 손상 백업), 429·503 잠시 뒤 다시.
- 시험 실행 ID: 심판은 모든 요청에 `X-Aleph-Run-Id: <UUID>` 를 붙입니다. 학생 서버는 이 값으로 **시험이 만든 자료에 표시만** 하고(§7 정리용), 권한 판단에는 쓰지 않습니다.
- 응답 머리글(보호 자원 응답 필수): `X-Aleph-Policy-Revision`, `X-Aleph-Policy-Digest`(공개 패키지 `policyDigest` 값), `X-Aleph-Decision`(`allow`·`deny`·`step_up`), `X-Aleph-Rule-Ids`(쉼표 구분).

## 2. 상태와 로그인

| 메서드·경로 | 누가 | 요청 | 응답 |
|---|---|---|---|
| `GET /health` | 누구나 | — | `{ schema:"aleph.product.health.v1", contracts:"0.1.1", projectId, commit, startedAt }` |
| `POST /auth/login` | 누구나 | `{ email, password }` | `{ accessToken, expiresIn }` · 실패 401 |

`/auth/login` 은 학생 앱의 기존 로그인(Supabase Auth 등)을 서버에서 대신 부르는 감싸기입니다. 브라우저 로그인 화면은 그대로 둡니다. 심판은 이 경로 하나로 로그인하므로 인증 백엔드가 무엇이든 같은 방식으로 시험할 수 있습니다.

## 3. 역할과 시험 신원

- 역할은 두 가지입니다. `member`(일반 사용자 A·B), `operator`(관리 작업 신원). 역할은 학생 서버 DB 의 역할 표에서 읽고, 브라우저가 보낸 role 값은 믿지 않습니다.
- 시험 신원 세 개: `A`(member), `B`(member), `OP`(operator). 모두 학생 앱의 **일반 계정**이고 이 시험 프로젝트 범위만 가집니다.
- 발급 절차(제안, 자격 보관은 Codex X3):
  1. 학생이 자기 PC 에서 시작 틀의 `npm run test-identities` 를 실행합니다. 스크립트가 무작위 비밀번호로 세 계정을 학생 프로젝트에 만들고 역할 표에 기록합니다. 비밀번호는 화면·파일·저장소에 남기지 않습니다.
  2. 같은 스크립트가 세 자격을 플랫폼의 보호 저장 경로(X3 가 정함)로 한 번만 보냅니다. 학생은 ALEPH 로그인 상태에서 이 전송을 승인합니다.
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
- 판정은 서버가 활성 정책으로 합니다. 정책 교체 중 들어온 요청은 요청을 받은 순간의 판으로 판정하고, 그 판을 응답 머리글에 적습니다.

## 5. 보호 자원과 D2 사건

| 메서드·경로 | 누가 | 설명 |
|---|---|---|
| `GET /resources/:zone/:id` | 로그인 사용자 | 정책으로 판정되는 보호 자원. 허용 200, 거부 403(`error.code:"policy_denied"`), 추가 확인 401(`error.code:"step_up_required"`). 머리글 §1 필수 |
| `POST /resources/:zone` | 로그인 사용자 | 시험용 합성 자료 쓰기. 소유자는 서버가 토큰으로 정합니다 |
| `POST /events` | operator | 제공 사건 생성 도구가 만든 사건 묶음 입력 `{ events:[{ id, at, kind, subject, … }] }` → `{ accepted, duplicates, conflicts }`. 같은 id·같은 내용은 중복으로 세고 무시, 같은 id·다른 내용은 conflicts 로 돌려주고 저장하지 않음 |
| `GET /events` | operator | `?from=&to=&kind=&subject=&cursor=&limit=` → 사건 시각(`at`) 순, 받은 순서와 무관 |
| `GET /incidents` · `GET /incidents/:id` | operator | XDR 규칙이 만든 사건 묶음. 근거 사건 id·규칙 id·정책 판 번호 포함 |

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
| `POST /test/reset` | operator | — (`X-Aleph-Run-Id` 필수) | 그 실행 ID 로 만든 시험 자료만 지움. 학생의 다른 자료·감사 기록은 지우지 않음 |

## 8. 이 초안에서 Codex 에게 확인받을 것

1. 시험 신원 발급을 학생 PC 스크립트로 하고 자격만 플랫폼 보호 저장으로 보내는 방식이 X3 와 맞는지.
2. 심판이 `/auth/login` 하나로 로그인하는 방식이 X2 전송기와 맞는지(학생 Supabase URL·anon 키를 심판이 알 필요가 없음).
3. 추가 확인(step_up)을 401 + `step_up_required` 로 표시하는 것.
4. `/events` 의 중복·충돌 응답 형식과 `/test/reset` 범위.

ACK 를 받으면 C1(시작 틀)에 이 경로의 뼈대·인증 감싸기 예시·역할 표 예시를 넣고, C3(공개 시험)를 이 경로 기준으로 씁니다. D1~D4 판단 로직의 완성 답안은 넣지 않습니다.
