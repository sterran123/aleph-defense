# 13~16단계 해설 — 다른 학생을 위한 정리

`student/extension.mjs`에 실제로 구현해 통과한 13~16단계를 단계별로 풀이합니다.
각 단계의 목표, 받는 값, 구현 접근, 심판이 보는 지점, 헷갈리기 쉬운 부분을 적습니다.
제공 파일(`public/`, `src/`)은 고치지 않고 학생 파일 하나만 바꿨습니다.

## 모든 단계에 공통인 패턴

네 단계가 같은 뼈대를 씁니다. 먼저 이 네 가지를 이해하면 각 함수가 쉽게 읽힙니다.

- **`el(tag, text)`**: `document.createElement`와 `textContent`만 씁니다. `innerHTML`·`outerHTML`·`insertAdjacentHTML`·`document.write`는 과제 규칙상 금지입니다. 기록 글에 `<b>` 같은 문자가 섞여 있어도 글자 그대로 보이게 하는 게 목적입니다.
- **매 호출 새 DOM 반환**: render 함수는 호출 때마다 새 요소를 만들어 돌려줍니다. 기존 요소를 수정하지 않으므로 "다시 불러오기"나 새 값이 오면 이전 사용자 값·옛 상세가 화면에 남을 수 없습니다. `*-after-reload`, `*-refresh-replaces` 검사가 여기에 걸립니다.
- **`labeled(map, value)` — 원래 값 + 한국어 뜻**: `compliant` → `정상(compliant)`처럼 둘 다 보여 줍니다. 목록에 없는 값이 오면 `확인 불가(unknown) · 받은 값: <값>`으로 내려서, 모르는 값을 정상·허용처럼 읽히게 하지 않습니다.
- **`modeNotice` + `statusBlock`**: `mode`가 demo·disconnected·unknown이면 "예제 자료 / 연결 없음 / 확인 불가" 배너를 loading·error·ok 가리지 않고 항상 붙입니다. loading·error·알 수 없는 status는 화면에서 서로 다른 문장으로 나옵니다.

## 13단계 · 세 메뉴와 로그인·기기 상태 (`renderIdentity`)

- **목표**: 지금 로그인한 사용자·기기·세션을 상태에 맞게 보여 주고, 다시 불러오면 새 값으로 교체합니다.
- **입력**: `{ me, devices, sessions }` — 셋 다 `{ status, mode, data?, error? }` 꼴입니다.
- **구현 접근**: 세 자료를 각각 `statusBlock`으로 감싸 loading·error·비 ok 상태를 한 곳에서 처리합니다. ok일 때만 본문을 그립니다.
  - `me.data` → `dl`(사용자 이름·id, 현재 기기 label·status, 현재 세션 id·status)
  - `devices.data` 배열 → `li`마다 `data-student-device-id` 속성 + `정상(compliant)`·`점검 필요(noncompliant)`·`확인 불가(unknown)`
  - `sessions.data` 배열 → `li`마다 `data-student-session-id` + `사용 중(active)`·`만료(expired)`·`취소(revoked)`·`확인 불가(unknown)`
- **헷갈리기 쉬운 부분**: `noncompliant`·`expired`·`revoked`가 정상처럼 보이면 안 됩니다 — 글자 뜻으로 구분해야 합니다. error 시 이전 사용자 이름이 남으면 안 되는데, 매번 새 DOM을 반환하므로 구조적으로 해결됩니다.
- **심판이 보는 것**: `student-source-changed`, `three-menus`, `student-identity-updates`, `student-failure-visible`, `identity-after-reload`. 제공 UI와 학생 함수 원문을 대조해 메뉴 연결·표시 교체·실패 안내·이전 값 제거를 봅니다.

## 14단계 · 업무 앱과 접속 판정 (`renderDecision`)

- **목표**: 접속 판정(허용·거부·추가 확인·확인 불가)과 요청 실패를 서로 다르게 보여 줍니다.
- **입력**: `{ status, mode, data?, error?, appId }`, `data`는 `{ appId, decision, reason, checkedAt }`, `decision`은 `allow`·`deny`·`challenge`·`unknown`.
- **구현 접근**: status 순서대로 자릅니다.
  - `idle` → "앱을 골라 접속을 요청하세요", `loading` → "판정 확인 중…"
  - `error` → `요청 실패: <message>` + **"요청이 실패한 것이며 접근 거부 판정이 아닙니다"** — 요청 실패와 deny 판정을 문장으로 분리하는 게 핵심입니다.
  - ok → `DECISION_LABEL`로 한국어 뜻과 원래 값을 함께 표시(`허용(allow)` 등)하고 `data-student-decision` 속성을 붙입니다. `reason`·`checkedAt`도 함께 적습니다.
- **중간에 고친 점(정규화)**: 목록에 없는 decision 값(예: 서버가 `permit` 같은 값을 주는 경우)이 오면, 그 값을 그대로 쓰지 않고 `shown = 'unknown'`으로 정규화한 뒤 `판정 확인 불가(unknown)`와 "목록에 없는 판정값을 받았습니다(받은 값: …)"를 함께 보여 줍니다. 모르는 판정값이 허용처럼 읽히지 않게 하는 안전장치입니다.
- **헷갈리기 쉬운 부분**: `challenge`는 허용이 아니라 "추가 확인이 필요한 판정"이며, 이 앱이 확인 절차를 대신하지 않는다고 안내해야 합니다. 색이 아니라 글자로 구분해야 합니다.
- **심판이 보는 것**: `server-decisions-distinct`, `decision-reason-visible`, `unknown-not-allow`, `failure-not-allow`.

## 15단계 · 내 접속 기록과 XDR 경보 (`renderEvents`)

- **목표**: 접속 기록(`kind: access`)과 XDR 경보(`kind: xdr`)를 시각·근거·규칙·상태와 함께 목록으로 보여 주고, 걸러 보기와 상세 보기를 만듭니다.
- **입력**: `{ status, mode, data?, error? }`, `data`는 기록 배열. 기록 하나는 `{ id, kind, at, appId, summary, evidence:[{id,text}], rules:[{id,text}], state:{access,session,device}, supportedActions }`.
- **구현 접근**:
  - **목록**: `at` 기준 최신순(`Date.parse` 내림차순). 행마다 `data-student-event-id` 속성과 시각·종류(접속 기록/XDR 경보)·앱·요약을 글자로 표시합니다.
  - **걸러 보기**: `<select>` 세 개(접근 가능한 이름: "기록 종류", "업무 앱", "접속 상태"). 전체 값은 `all`, 나머지는 받은 배열에 실제 있는 kind·appId·state.access 값만 모아 만듭니다. 서버에 다시 묻지 않고 받은 배열 안에서만 걸러냅니다. 선택지가 새 자료에서 사라지면 해당 필터는 `all`로 되돌립니다.
  - **상세**: 행마다 "`<id>` 상세" 버튼(`aria-label`도 같은 이름). 누르면 `data-student-event-detail` 속성이 붙은 상세 영역이 열리고 사건 ID·앱·근거(id+text)·규칙(id+text)·state 세 값(원래 값+한국어 뜻)을 모두 보여 줍니다.
  - **빈 배열과 실패를 다르게**: `[]` → "표시할 기록이 없습니다", `error` → "기록을 불러오지 못했습니다: <message>", `CONTRACT_MISMATCH` → "기록 확인 불가". 빈 화면이 실패처럼, 실패가 빈 화면처럼 읽히면 검사에 걸립니다.
- **중간에 고친 점(경계에서 선택 지우기)**: 자료가 바뀌는데 옛 상세가 열려 있으면 엉뚱한 기록의 상세가 새 목록에 붙을 수 있습니다. 그래서 `ui.eventsFp`에 목록의 지문(`JSON.stringify`)을 저장하고, 내용이 바뀌었거나 loading·error·비 ok 상태가 오면 `ui.openDetail`을 지웁니다. 같은 입력으로 다시 그릴 때(필터 변경·상세 클릭)는 지문이 그대로라 영향이 없습니다.
- **헷갈리기 쉬운 부분(관측 범위)**: 이 목록은 내 SDP 감사 기록과 맞춰 본 "내 기록"이고 최근 40건까지입니다. 전체 로그도 다른 학생 기록도 아닙니다. 옛 세션·기기의 상태는 `unknown`으로 오는데 정상으로 바꾸지 않아야 합니다. `appId`가 없는 기록은 "앱 확인 불가(없음)"로 표시합니다.
- **심판이 보는 것**: `event_scope`, `event_time`, `event_filter`, `event_detail`, `events-refresh-replaces`, `events-empty-error-distinct`.

## 16단계 · 알림·기기·세션·오류·빈 화면 (`renderStatus` + 15단계 상세 보강)

- **목표**: 실패·빈 화면·다시 시도·도움정보·미지원 조치를 사용자가 이해할 수 있게 안내합니다.
- **입력**: `{ devices, sessions, notifications, diagnostics, mode }`. `notifications`는 제공 코드가 모아 준 `[{ resource, code, message }]` 배열입니다.
- **구현 접근**:
  - **자료별 상태 블록**(`statusResourceBlock`): 기기·세션·점검 정보를 각각 감싸, loading(불러오는 중)·idle(아직 조회 전)·error(실패)·비 ok(확인 불가)·빈 목록을 서로 다른 문장으로 구분합니다. `error.code === 'TIMEOUT'`이면 "(시간 초과)"를 붙입니다.
  - **다시 시도 안내**: 실패마다 "다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요."를 붙입니다. 학생 코드가 자동으로 재요청하지 않습니다 — 재시도는 사용자가 버튼을 직접 누르는 행위입니다.
  - **알림**: 항목마다 `[resource] code — message`로 표시하고, 비어 있으면 "주의할 알림이 없습니다".
  - **연결 점검(diagnostics)**: `requestId`·`component`·`version`·`checkedAt`·`engine.mode`·`engine.code`만 보여 줍니다 — 비밀 없는 값만.
  - **도움정보 복사 버튼**: 이름이 정확히 "도움정보 복사"인 버튼을 학생 칸 안에 두고, 사용자가 누를 때만 위의 안전한 값을 clipboard에 복사합니다. 제공 화면의 복사 버튼으로 대신할 수 없고 학생 칸 안에 있어야 합니다.
  - **세션 안내**: "지금 검증된 연결 하나만 표시됩니다. 지난 세션 목록이 아닙니다."를 함께 적습니다.
  - **미지원 조치(15단계 상세 안)**: `supportedActions`가 비어 있으면 버튼 자체를 만들지 않습니다(현재 실제 목록은 빈 배열이라 이게 정상). 값이 있으면 이름이 정확히 "`<action>` 미지원"인 **비활성** 버튼을 만들고 "조치 실행 연결은 준비 중입니다. 요청을 보내지 않습니다."를 붙입니다. `disabled`라서 눌러도 요청이 나가지 않고, 실행에 성공한 것처럼 읽히는 문장도 쓰지 않습니다.
- **헷갈리기 쉬운 부분**: `renderStatus` 하나만 고쳐서는 통과하지 않습니다 — 미지원 조치 안내는 15단계 상세(`data-student-event-detail`) 안에 있어야 하고, 도움정보 복사 버튼은 학생 상태 칸 안에 있어야 합니다. 빈 목록과 실패가 같은 문장이면 안 됩니다.
- **심판이 보는 것**: `devices-sessions-refresh`, `notifications`, `loading_empty`, `retry`, `diagnostics_redaction`, `unsupported_action`.

## 네 단계를 통과하게 한 습관 정리

1. **상태(status)별로 먼저 자르기**: `idle → loading → error → 비 ok → ok` 순서로 자르면 누락되는 상태가 없고 각 화면이 자연히 다른 문장을 갖습니다.
2. **모르는 값은 확인 불가로 내리기**: 목록(`DECISION_LABEL`·`DEVICE_STATUS` 등)에 없는 값이 오면 그 값을 정상값에 매핑하지 말고 `확인 불가(unknown)` + 받은 원래 값으로 보여 줍니다.
3. **성공·정상으로 읽힐 수 있는 표현 금지**: `unknown`·error·빈 화면·미지원 조치가 허용·완료·정상처럼 읽히면 검사마다 걸립니다. "아닌 것은 아니다"라고 글자로 못 박습니다.
4. **사용자 행위와 코드 행위 구분**: 재시도·점검·복사는 사용자가 버튼을 직접 누를 때만 일어나야 합니다. 학생 코드가 자동으로 요청하거나 복사하지 않습니다.
5. **속성(`data-student-*`)은 실제 렌더와 함께**: 표식만 붙여서는 통과하지 않습니다. 실제 글자와 동작이 먼저고 표식은 그 위에 얹습니다.
