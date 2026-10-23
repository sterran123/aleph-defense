# 17~22단계 · 통과 구현 해설

통과한 실제 구현(`student/extension.mjs`)을 단계별로 풀이한 문서입니다.
제공 파일(`public/`, `src/`, `tools/`)은 고치지 않고, 학생 파일 `student/extension.mjs` 하나만 바꿉니다. 이 문서가 나오는 시점에 17단계는 공식 판정으로 통과가 확인됐고, 18~22단계는 원문 기준 충족을 검증한 상태입니다.

공통 규칙은 13~16단계 해설(`STAGE_13_16_EXPLAINED.md`)과 같습니다 — `el`로 `textContent`만, 매 호출 새 DOM 반환, 모르는 값은 확인 불가로 내리기, 성공처럼 읽히는 표현 금지, 표식 속성은 실제 렌더 위에만.

---

## 17단계 · AI 연결 점검과 사건 설명 요청 (`renderAiConnection` + `renderExplanation` 기본 형태)

### 목표
제공 버튼의 요청을 기다려 AI 연결 점검 상태를 보고, 사건 설명 요청의 기본 결과 형태를 보여 주는 단계입니다. 연결 점검 성공은 "사건 설명이 성공했다"는 뜻이 아니라는 구분이 핵심입니다.

### 입력
- `renderAiConnection({ status, modelCount?, error? })` — 점검 상태와 모델 수·오류.
- `renderExplanation({ event, explanation, checkedAt })` — 이 단계에서는 성공 표식이 있는 성공 형태와, 오류/로딩/기록 없음 구분만 하면 됩니다.

### 구현
- `renderAiConnection`: `idle`이면 점검 전이라고 보이고, `loading`은 점검 중 + 사건 설명 미실행 문구, `error`는 `error.code` + `error.message`를 그대로 보인 뒤 오류 안내표(`AI_GUIDE`)를 덧붙여 **준비·권한·인증·사용량·시간·취소·점검 방법**을 코드별로 구분해 보여 줍니다. `ok`면 모델 수를 "사용 가능 모델 수"로 표기하고 "연결만 점검했습니다. 사건 설명은 아직 실행하지 않았습니다."를 붙입니다.
- `renderExplanation` 기본: `event` 없음 → 기록 고르라고 안내, `loading` → 요청 중, `error` → 실패 문구 + "기록은 그대로 유지됩니다", 성공 → 사건 ID + 요약과 함께 `data-student-explanation-event` 표식을 붙입니다.
- 새 DOM 매 호출 → 새로고침 후 이전 성공(모델 수)이나 오류가 남지 않습니다.

### 중간에 고친 문제
- **판정 보류(`ai_model_called` 확인 불가)**: 이전 제출에서 `src/server.mjs`와 `vendor/clco-http.mjs` 원문이 수집되지 않아 통과가 지연됐습니다. 이 커밋들에는 두 원문이 이미 들어 있었고, 문제는 제출 시 수집 범위였습니다.
- 이후 제공 파일을 덜어내려던 커밋(`5457040`)이 오히려 **제공 파일 누락·저장소 규칙 위반**으로 거절돼, `b8de046`에서 삭제 목록 그대로(26개 파일, manifest 해시 일치) 복원했습니다. 저장소를 줄이는 대신 제공 파일을 지우는 방식은 통과 기준 자체를 어기는 방향이었습니다.
- 판정 프롬프트가 개정되고 운영 측 계정 권한 준비가 끝난 뒤 재판정에서 17단계 통과가 확인됐습니다. `ON_AI_PROVISIONING_PENDING`이 떨어지는 건 학생 코드가 아니라 운영 측 권한 준비가 푸는 문제였습니다.

### 판정 기준별 확인
- `ai_transport_checked`: 모델 수 라벨 + "사건 설명은 실행하지 않음" 문구 분리 ✓
- `ai_model_called`: `POST /api/ai/explain` 경로가 AI 서비스·외부 전송 모듈과 연결돼 있고(`server.mjs`), 권한 준비 후 실제 호출 수용이 확인돼 공식 통과 ✓
- `ai_auth_error` / `ai_limits` / `ai_timeout_cancel`: 코드별 오류 안내표로 원인(인증·권한·사용량·시간·취소) 구분, 성공처럼 보이는 잔여 문구 없음 ✓
- `ai_manual_recovery` / `ai_generation_reset`: 새 DOM이라 재점검 성공·새로고침 뒤 이전 오류·성공 잔여 없음 ✓
- `secret_absence`: 학생 코드에 키·토큰·비밀값 없음(오류 안내도 메타 정보만) ✓

---

## 18단계 · 사건 설명의 근거·규칙·상태 구분 (`renderExplanation`)

### 목표
AI 사건 설명을 "증거와 규칙에 묶인 참고 자료"로 보여 주는 단계입니다. 근거가 없거나 틀린 설명, 이미 실행됐다는 답변은 쓸 수 없다고 표시하는 게 핵심입니다.

### 입력
`renderExplanation({ event, explanation, checkedAt })` — 기록 이벤트, 설명 응답(`status`, `summary`, `evidenceIds`, `proposals`, `executed`, `requiresHumanConfirmation`, `error`), 점검 시각.

### 구현
- 성공 응답이면: 사건 ID + "참고용 설명" 제목 + `summary` + **인용 근거 ID와 그에 대응하는 이 기록의 근거 문장** 목록 + 규칙 목록 + `unknown`인 접속·세션·기기 상태를 따로 뽑아 "확인 불가(unknown)"로 표기 + 제안(이유·실행 예정 조치·왜 제안이 비었는지) + "제안은 실행되지 않았고 사람 확인 후에만 실행" 고지.
- 쓸 수 없는 설명은 전부 `unusable(이유)`으로 내려 "이 AI 설명은 쓸 수 없습니다: 이유" + "기록은 그대로입니다" + `data-student-error="true"` 표식: 객체가 아님, 근거 인용 없음, 이 기록에 없는 근거 ID, 빠진 근거·중복 인용(기록의 근거 전체와 일치하지 않음), 지원하지 않는 조치 제안, 제안이 기록에 없는 근거를 인용, `executed === true`, `requiresHumanConfirmation !== true`.
- 표식 `data-student-explanation-event`는 **검증된 성공 렌더에만** 붙습니다. 오류·로딩·자료 없음·근거 불일치 화면에는 붙지 않습니다.
- 설명 실패·쓸 수 없는 설명 문구에는 `data-student-error="true"`를 붙이고, 새 DOM이라 다른 기록 선택·새로고침 시 이전 설명이 남지 않습니다.

### 중간에 고친 문제
- **`75f9efe` — 형태 검사 순서 오류**: 처음에는 `res.data`가 `null`·비객체일 때 `data.evidenceIds`/`data.proposals` 접근이 먼저 일어나 `TypeError`로 화면이 죽을 수 있었습니다. 형태 검사(`typeof !== 'object'`)를 앞으로 옮겨, 깨진 응답도 "쓸 수 없는 설명"으로 안전하게 떨어지게 고쳤습니다. 판정 측이 의도적으로 잘못된 응답을 넣는 `wrong_event_rejected` 검사와 직결되는 결함이었습니다.
- **검토 후 근거 묶음 강화**: 처음에는 설명 본문의 `evidenceIds`만 기록 근거와 대조했는데, 제공 `validExplanation`이 요구하는 조건(인용이 중복 없이 기록 근거 **전체**와 일치, 각 제안의 `evidenceIds`도 기록 안에 있음)까지 학생 쪽 재검증이 못 미쳤습니다. 제안이 외부 근거를 인용하거나 인용이 일부만 되면 성공 표식이 붙을 수 있어, 빠진 근거·중복 인용·제안의 잘못된 근거 인용을 전부 `unusable`로 거부하도록 맞췄습니다. 근거 글이 없는 행이 `undefined`로 보이던 것도 `(내용 없음)`으로 내렸습니다.

### 판정 기준별 확인
- `evidence_binding`: 설명 본문과 각 제안이 인용한 근거 ID 전부가 이 기록의 `event.evidence`에 실제 존재하고, 인용이 중복 없이 기록 근거 전체와 일치할 때만 성공 렌더(제공 `validExplanation`과 같은 조건) ✓
- `unknown_evidence`: `unknown` 상태를 접속·세션·기기로 나누어 "확인 불가"로 표기, 정상·안전으로 단정 안 함 ✓
- `insufficient_evidence` / `wrong_event_rejected`: 근거 없음·틀린 근거·빠진 근거·제안의 잘못된 근거 인용·비객체 응답 → "쓸 수 없는 설명" 처리 ✓
- `proposal_not_executed`: 제안 미실행·사람 확인 필요 고지, `executed:true`·확인 불필요 응답 거부 ✓
- `non_ai_regression` / `explanation_refresh`: 이전 단계 함수 무변경, 새 DOM으로 잔여 설명 없음 ✓

---

## 19단계 · AI 조치 제안과 서버 처리 결과 (`renderAction`)

### 목표
준비·전달·접수(ACK)를 실제 원천 효과와 나누어 보여 주는 단계입니다. "서버가 받았다"와 "실제로 적용됐다"를 구분하고, 결과가 확인되지 않은 상태를 완료로 쓰지 않는 게 핵심입니다.

### 입력
`renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error })` — 상태(`idle/prepared/executing/pending/succeeded/denied/failed/unknown/expired/error/loading`), 사건, 조치·대상, 접수 영수증, 원천 관측, 사람 확인 기한.

### 구현
- 상태별 분기: `idle`은 "아직 미실행", `prepared`는 "준비됐습니다. 아직 실행되지 않았습니다." + `confirmationExpiresAt` 기한 + "제공 화면의 확인 버튼으로 사람이 직접 확인한 뒤에만", `executing`은 "전달 중 … 완료가 아닙니다", `pending`은 "서버가 받았다는 것(ACK)은 실제 효과가 아닙니다", `denied`·`failed`·`expired`는 있는 그대로, `unknown`은 "결과 불명 … 성공으로도 효과 없음으로도 판단하지 말고 「원천 결과만 재조회」로 다시 조회".
- **`succeeded`는 `observation.effectApplied === true`일 때만** "원천이 실제 효과를 확인했습니다"로 표기. 그 외에는 "결과 불명(unknown)"으로 내려 성공으로 쓰지 않습니다.
- 사건 ID·근거 ID·조치 ID·대상 ID·세대·`requestId/receiptId/version`·`superseded`는 있는 값만 글자로 보여 줍니다.
- 이 칸에는 버튼을 만들지 않고 "제공 화면의 버튼을 직접 눌러 진행"이라고 안내합니다. 표식(`data-student-action-event`, `data-student-action-request`)은 실제 상태 렌더에만 붙고 `idle`·`error`에는 붙지 않습니다.

### 중간에 고친 문제
- **`75f9efe` — `effectApplied` 누락 표기**: 관측은 있는데 `effectApplied`가 빠진 입력에서 `실제 효과 undefined`로 출력되던 것을 `?? '확인 불가'`로 고쳐, 모르는 값을 정해진 표기로 내리는 공통 규칙에 맞췄습니다.

### 판정 기준별 확인
- `proposal_execution_separation`: `idle`에서 제안은 아직 실행되지 않았다고 표기, 성공 주장 없음 ✓
- `human_confirmation` / `current_intent_binding`: `prepared`에서 "아직 실행하지 않음" + 사람 확인 기한 + 대상·영수증 함께 표기 ✓
- `observed_server_result`: `pending`에서 ACK≠효과, `succeeded`는 관측 `effectApplied===true`만 성공 표기 ✓
- `duplicate_prevention` / `unknown_not_success` / `action_refresh`: 영수증·`superseded` 표기, 결과 불명은 재조회 안내, 새 DOM으로 이전 결과 잔류 없음 ✓

---

## 20단계 · 설치 패키지와 취약점 정보 대조 (`renderVulnerabilities`)

### 목표
잠금 파일에 있는 설치 패키지를 프로젝트 저장소의 승인 목록으로 OSV와 대조한 결과를 보여 주는 단계입니다. "조회했다"와 "조회하지 못했다"를 구분하고, 실패·미조회를 "취약점 없음"으로 쓰지 않는 게 핵심입니다.

### 입력
`renderVulnerabilities({ status, mode, data?, error? })` — 전체 상태(`idle/loading/error/ok`), `data.status`는 `complete/partial/not_checked/not_configured/unverifiable`, 패키지별 `status`는 `known_vulnerabilities/none_found/unverifiable`(`STUDENT_PROMPTS.md`의 계약).

### 구현
- `idle` → "설치 패키지 조회 전", `loading` → "조회 중", `error` → "패키지 조회 실패: 메시지(코드)" + `data-student-error`.
- 성공이면 `data.status` 라벨 + 잠금 버전·잠금 해시·조회 시각 + 패키지 표: `이름@버전 · 상태 · 출처 · 조회 시각`, 취약점이 있으면 **취약점 ID + 수정일** 목록까지.
- 패키지 상태 라벨: `known_vulnerabilities` "알려진 항목 있음", `none_found` "알려진 항목 없음", `unverifiable` "조회 확인 불가". 계약에 없는 값은 `확인 불가(받은 값)`으로 내립니다. `unverifiable`인데 받은 취약점 ID가 있으면 지우지 않고 "일부 확인 · 전체 조회 확인 불가"로 남깁니다(`partial_preservation`).
- `not_configured`는 "조회 준비 미완료", `not_checked`는 "조회하지 않은 항목"으로 구분하고, 끝에 "조회 실패·미조회·확인 불가는 「취약점 없음」이 아닙니다"를 붙여 `unavailable_not_clean`을 막습니다.
- 각 패키지 행에 `data-student-package-name`·`data-student-package-version` 표식.

### 판정 기준별 확인
- `exact_lock_version`: 잠금 버전·해시·조회 시각 + 설치된 정확 버전(`name@version`) 표기 ✓
- `osv_match`: `known_vulnerabilities`에 취약점 ID·수정일 목록 ✓
- `lookup_unavailable` / `no_results_distinction` / `partial_preservation`: 설정 안 됨·미조회·확인 불가·일부 결과를 각각 구분하고 "취약점 없음"으로 섞지 않음 ✓
- `refresh_replaces` / `request_recovery` / `stale_response_blocked`: 새 DOM, 요청 실패·취소는 실패 문구로 표기하고 깨끗한 것처럼 보이지 않음 ✓

---

## 21단계 · 학생 안내 문서 (`docs/STUDENT_MANUAL.md`)

### 목표
화면 코드가 아니라 **문서**가 검사 대상인 단계입니다. 다른 사람이 이 앱을 직접 켜서 이해할 수 있게 안내 문서를 씁니다.

### 만든 것
`on-client/docs/STUDENT_MANUAL.md` — 실행 방법(필수 조건, `npm start`·`npm run demo`, 포트), 화면 흐름(제공 화면 vs 학생 칸, 렌더 함수 → 호출 자리 표), 제공/학생 경계, 실패 안내표(각 오류 → 뜻 → 할 일), 21단계 문서 포함 범위. 비밀값 요구·수집하지 않음을 명시했습니다.

### 판정 기준별 확인(v0.5 자동 확인 계약)
- `run_instructions` / `architecture` / `provided_student_boundary` / `failure_guide`: 네 섹션 모두 채움, 문서에 나온 명령은 실제로 실행해 둠(`NEW_ENV_RUN.md`와 연계) ✓

---

## 22단계 · 새 환경 실행과 단계별 재현 기록 (`docs/NEW_ENV_RUN.md`)

### 목표
문서만 읽고 새 폴더에서 앱을 켜 13~21단계 행동이 재현되는지 표로 정리하고, 확인되지 않는 것은 UNV로 솔직하게 남기는 단계입니다. "완성"이라고 쓰지 않고 검증 중으로 표기하는 게 핵심입니다.

### 만든 것
`on-client/docs/NEW_ENV_RUN.md` — 새 폴더에서 `npm run check`·`npm run demo`·`npm start` 실행 기록, 단계별 재현 표(재현됨/연결 없음 미검증/확인 불가), 버전은 "검증 중(v1.0 아님)", UNV 목록.

### 판정 기준별 확인(v0.5 자동 확인 계약)
- `clean_environment` / `cumulative_behavior` / `data_preservation` / `release_reproduction`: 새 폴더 실행 기록 + 13~21단계 행동 표 + 기존 관측 보존 + 완성으로 단정하지 않음 ✓

---

## 남아 있는 UNV와 경계

- **검증 방법**: 위의 "판정 기준별 확인"은 `STUDENT_PROMPTS.md`의 R4 판정표(17~20단계)와 v0.5 자동 확인 계약(21·22단계)을 원문과 대조한 결과이고, 핵심 분기는 DOM 가상 환경에서 직접 돌린 가상 단위 시험(36건 통과)으로 확인했습니다. 가상 시험은 심판 판정이 아니라 개발자 검증 기록입니다.
- **운영 측 권한에 묶인 항목**: 실제 AI 설명 호출 수용(17단계의 `ai_model_called`), 실제 원천 조치 효과(19단계), 실제 OSV 조회(20단계)는 담당자 연결·승인 패키지 설정 없이는 학생 화면에서 확인할 수 없습니다. 17단계는 권한 준비 후 공식 통과가 확인됐고, 19·20단계의 실제 원천 연결은 계속 UNV입니다.
- **공식 판정**: 18~22단계의 공식 통과 확정은 서버 측 재검토와 제출·순서 권한에 달려 있습니다. 이 문서는 "공식 통과"가 아니라 "공개된 완료 기준을 원문이 충족한다"는 검증 기록입니다.
- **비밀값**: 어느 단계에서도 앱·로그·문서에 키·토큰·계정 비밀값을 넣지 않았습니다. 실제 연결은 운영 환경의 자격 증명 준비로만 됩니다.
