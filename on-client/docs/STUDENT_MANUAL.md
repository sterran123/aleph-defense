# 학생 설명서 — ALEKOV on-client 보안 에이전트

이 문서는 학생이 직접 확인한 내용만 적습니다. 제공 문서(`README.md`·`docs/`의 기존 파일)는 고치지 않았습니다.

## 1. 설치·실행 순서 (실제로 확인한 명령)

```sh
cd on-client
npm run check        # student/extension.mjs 문법 점검 — 통과 확인
npm run demo         # 예제 자료 모드 → http://127.0.0.1:5189
npm start            # 연결 확인 모드 → 원천 엔진이 없으면 disconnected 로만 동작
```

- 포트 변경: `ON_PORT=5299 npm run demo` 처럼 `ON_PORT` 환경 변수로 바꿉니다(기본 5189).
- 새 폴더에 복사한 뒤 위 명령을 그대로 실행해 봤고, `npm run demo`는 예제 자료를, `npm start`는 `ENGINE_NOT_CONNECTED` 상태의 응답을 확인했습니다(기록: `docs/NEW_ENV_RUN.md`).
- 네이티브 호스트·자격 증명 보관함(`tools/*.ps1`)은 운영자 측 준비가 필요합니다. 이 환경에서는 확인하지 못했으므로 **확인 필요**로 남깁니다.
- 외부 AI(`ON_AI_BASE_URL`·`ON_AI_APP_KEY`)와 원천 조치(`--alekov-actions`·`--sdp-host-config`·`--native-host-config`)는 담당자가 권한을 준비해야 실제 연결됩니다. 열쇠 값은 코드·문서·설정 파일에 넣지 않습니다.

## 2. 구성도

네 개의 주 상자는 브라우저 · 앱 서버 · 기존 접속·XDR 서버 · CLCO 수업용 AI입니다. 앱 서버(`src/server.mjs`)가 각 외부 연결을 직접 부릅니다. AI·조치·취약점·네이티브 호스트 연결은 모두 앱 서버에서 갈라지는 별도 경로이며, 원천 엔진을 거치지 않습니다.

```
[브라우저 화면]                 public/index.html · public/app.js         http://127.0.0.1:5189 (ON_PORT)   [확인됨: demo 부팅·응답 확인]
      |  /api/* GET·POST (같은 출처, student/extension.mjs가 화면을 채움)
      v
[앱 서버]                      src/server.mjs                            node src/server.mjs              [확인됨: demo·연결 확인 모드 부팅 확인]
      |--(1) 엔진 메서드 호출(src/engine.mjs 의 engineMethod): readIdentity·readEvents·decideAccess…
      |        v
      |     [기존 접속·XDR 서버(원천)]   student/engine-adapter.mjs (ON_ENGINE_ADAPTER 로 지정)          [확인 안 됨: 실제 원천 연결은 UNV]
      |                                또는 src/engine/sdp-host.mjs (--sdp-host-config 개인 SDP 호스트)
      |                                demo 모드는 src/engine.mjs 의 demoEngine() 예제 자료
      |
      |--(2) AI 연결 점검·사건 설명(POST /api/ai/check·/api/ai/explain)
      |        |  두 경로로 나뉨:
      |        |  a) 직접 설정: src/ai/service.mjs → vendor/clco-http.mjs
      |        |  b) 네이티브 연결 시: native host 작업(src/connection/native-context.mjs)에서
      |        |     자격 증명 보관함(src/ai/credential-vault.mjs, tools/app-credentials.ps1 호출,
      |        |     열쇠는 작업 안에만 존재·env에 두지 않음)과 앱 권한·주소 검증(src/ai/app-authorization.mjs)을 거쳐
      |        |     src/ai/vault-service.mjs → vendor/clco-http.mjs
      |        v
      |     [CLCO 수업용 AI]            ON_AI_BASE_URL 의 /v1/models·/v1/chat/completions                    [확인 안 됨: ON_AI_PROVISIONING_PENDING 응답까지만 확인, 실제 호출 UNV]
      |                                (Bearer 토큰은 비밀 보관함·비밀 입력란에 보관)
      |
      |--(3) 조치 요청 상태·원천 결과(POST /api/actions/prepare·execute·result)
      |        v
      |     [조치 원천 연결]            src/actions/service.mjs → src/actions/sdp-action-engine.mjs        [확인 안 됨: 실제 집행 UNV]
      |                                --alekov-actions + --alekov-actions-config + --native-host-config + --sdp-host-config 모두 필요(하나라도 빠지면 시작 거절)
      |
      |--(4) 설치 패키지 취약점 조회(GET /api/vulnerabilities)
      |        v
      |     [OSV 공개 조회]             src/vulnerabilities/project-scan.mjs → src/vulnerabilities/osv.mjs [확인 안 됨: not_configured 응답까지 확인, 실제 조회 UNV]
      |                                → https://api.osv.dev/v1/querybatch (허용 공개 패키지 목록이 비어 있으면 조회하지 않음)
      |
      `--(5) 네이티브 호스트 로그인·자격 증명(--native-host-config)
               v
            [네이티브 호스트]          src/connection/native-context.mjs · src/connection/native-login.mjs [확인 안 됨: tools/*.ps1 준비 필요, UNV]
```

- 화면 안내 문구(도움정보)는 `src/learner-support/service.mjs`가 앱 서버 안에서 만듭니다. 외부로 나가지 않습니다.

## 3. 제공 코드와 학생 구현 구분

- **제공**: `public/`의 화면·요청 코드, `src/`의 서버·AI·연결·조치·취약점 모듈, `vendor/clco-http.mjs`(외부 전송), `tools/`(호스트 준비 스크립트), `docs/`의 제공 문서 — `.on-starter-manifest.json` 목록과 대조합니다.
- **학생 구현**: `student/extension.mjs`의 표시 함수와 이 학생 문서.
  - `renderIdentity`: 로그인 사용자·등록 기기·세션을 원래 값과 함께 표시
  - `renderDecision`: 업무 앱 접속 판정(allow·deny·challenge·unknown)을 원래 값과 안내로 표시
  - `renderEvents`: 접속·XDR 기록 목록, 종류·앱·상태 걸러 보기와 사건 상세
  - `renderStatus`: 기기·세션·알림·연결 점검 값과 도움정보 복사(비밀 없음)
  - `renderAiConnection`: AI 연결 점검 결과·원인별 안내(연결 점검과 사건 설명 실행을 구분)
  - `renderExplanation`: AI 설명의 요약·인용 근거·규칙·확인 불가 상태·제안을 기록과 대조해 표시
  - `renderAction`: 조치 준비·전달·접수·원천 효과·거절·결과 불명을 구분해 표시
  - `renderVulnerabilities`: 설치 버전·조회 상태·취약점 ID를 출처·시각과 함께 표시
- `student/engine-adapter.mjs`는 제공 뼈대로, 원천 호스트가 줄 때만 본인 범위 조회·판정을 전달합니다.

## 4. 실패별 해결 안내 (화면에 실제 나오는 문구 기준)

| 화면 문구·코드 | 뜻 | 확인할 것 |
|---|---|---|
| `ENGINE_NOT_CONNECTED` 기존 서버 연결을 확인할 수 없습니다 | 원천 엔진 어댑터가 연결되지 않음 | `student/engine-adapter.mjs` 연결과 실행 주소를 확인 |
| `ON_AI_PROVISIONING_PENDING` 권한·열쇠 발급 준비 중 | 계정·앱 AI 권한이 아직 준비 중 | 담당자에게 계정 연결과 앱 권한 확인 요청 |
| `WB_CLCO_AUTH_REQUIRED` / `WB_CLCO_ACCESS_BLOCKED` | 인증·접근 제한 | 계정 연결을 다시 확인하고 담당자에게 확인 |
| `WB_CLCO_COHORT_BUDGET_EXHAUSTED` / `WB_CLCO_LIMIT_REACHED` | 반 사용량·이용 한도 | 담당자에게 확인 |
| `WB_CLCO_SESSION_CLOSED` | 이용 시간 아님 | 이용 시간 확인 |
| `WB_CLCO_RATE_LIMITED`·`WB_CLCO_TIMEOUT`·`TIMEOUT`·`NETWORK_ERROR` | 요청 제한·시간 초과·네트워크 | 잠시 뒤 점검·조회 버튼을 직접 다시 누름(자동 재시도 없음) |
| `CANCELLED`·`REQUEST_CANCELLED` | 요청 취소 | 이전 결과가 현재 결과가 아님을 확인 |
| `ON_AI_INVALID_INPUT`·`ON_AI_INVALID_OUTPUT` | 설명 요청·응답이 기록과 맞지 않음 | 사건 근거·규칙과 기록 선택을 다시 확인 |
| `AI 설명 실패:` / `기록은 그대로입니다` | 설명 실패는 기록 변경이 아님 | 기록·판정 화면은 그대로이며 과제 실패가 아님 |
| `조치 요청이 처리되지 않았습니다` + `ACTION_*` 코드 | 조치 요청 거절·미지원 | 조치 권한·확인 기한·스냅샷 변경 여부 확인, 자동 집행 없음 |
| `결과 불명(unknown)` | 원천 효과를 확인하지 못함 | 성공·실패로 판단하지 말고 「원천 결과만 재조회」로 결과만 다시 확인 |
| `패키지 조회 실패:` / `not_configured` / `unverifiable` | 조회 실패·설정 없음·lock 확인 불가 | 「취약점 없음」이 아님. 허용 패키지 설정과 lock 파일을 확인 |
| `QUERY_REJECTED`·`ORIGIN_REJECTED`·`HOST_REJECTED` | 지원하지 않는 요청·출처 | 앱 화면의 버튼으로만 요청 |

## 5. 지원 범위

확인한 것과 기다림(UNV)을 나눠 적습니다. 구성도의 상자별 확인 상태(§2의 `[확인됨]`·`[확인 안 됨]` 표시)와 같은 범위입니다.

| 범위 | 확인한 것 | 확인 방법 | 상태 |
|---|---|---|---|
| 브라우저 화면·앱 서버 | 새 폴더에서 `npm run demo`·`npm start` 부팅, `/`·`/app.js`·`/student/extension.mjs` 200 응답 | NEW_ENV_RUN.md 절차 재실행 | 확인됨 |
| 데모 자료 API | `/api/me`·`/api/apps`·`/api/devices`·`/api/sessions`·`/api/events`·`/api/vulnerabilities` 예제 응답 | demo 모드 GET | 확인됨(예제 자료) |
| 학생 표시 함수 8개 | `renderIdentity`~`renderVulnerabilities` DOM 출력과 오류 구분 | 가상 입력으로 직접 호출 | 확인됨(가상 입력) |
| 요청 거절 | `QUERY_REJECTED`·`ORIGIN_REJECTED` 응답 | 쿼리 문자열·다른 출처 요청 | 확인됨 |
| AI 연결 점검·사건 설명 | 코드 경로·`ON_AI_PROVISIONING_PENDING` 응답만 확인. 실제 계정 권한·모델 응답은 못 봄 | `POST /api/ai/check`·`/api/ai/explain` | 기다림(UNV) |
| 기존 접속·XDR 서버 | `engine-adapter.mjs` 뼈대·`ENGINE_NOT_CONNECTED` 응답만 확인. 실제 원천 전달은 못 봄 | `npm start` 부팅 | 기다림(UNV) |
| 조치 원천 집행 | `--alekov-actions` 미구성 상태의 거절 응답만 확인. 실제 집행·효과는 못 봄 | demo·연결 확인 모드 | 기다림(UNV) |
| OSV 실조회 | `not_configured` 응답만 확인. 허용 패키지 실조회는 못 봄 | `GET /api/vulnerabilities` | 기다림(UNV) |
| 네이티브 호스트 | `tools/*.ps1` 운영자 준비 필요. 로그인·보관함 동작은 못 봄 | 미확인 | 기다림(UNV) |

- 데모(예제 자료) 결과와 연결 없음은 실제 연결 확인으로 적지 않습니다. 확인하지 않은 인증·조치 실행·OSV 결과를 지원하는 것처럼 쓰지 않습니다.
- 열쇠·토큰·비밀번호 같은 비밀값은 문서·코드·커밋에 넣지 않습니다. 필요하면 학생이 공식 설정 화면의 비밀 입력란에 직접 넣습니다.
