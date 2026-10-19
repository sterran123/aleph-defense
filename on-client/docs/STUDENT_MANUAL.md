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

```
[브라우저 화면]                public/index.html · public/app.js        http://127.0.0.1:5189 (ON_PORT)
      |  /api/* GET·POST (같은 출처)
      v
[앱 서버]                    src/server.mjs                          node src/server.mjs
      |  엔진 메서드 호출(readIdentity·readEvents·decideAccess…)
      v
[기존 접속·XDR 서버(원천)]     student/engine-adapter.mjs (ON_ENGINE_ADAPTER)
                              또는 src/engine/sdp-host.mjs (--sdp-host-config, 개인 SDP 호스트)
      |  사건 설명·연결 점검 시
      v
[CLCO 수업용 AI]              src/ai/service.mjs → vendor/clco-http.mjs
                              → ON_AI_BASE_URL 의 /v1/models·/v1/chat/completions (Bearer 토큰)
```

- 취약점 조회는 앱 서버가 `src/vulnerabilities/` 로 `https://api.osv.dev/v1/querybatch` 에만 나갑니다(허용 공개 패키지 목록이 비어 있으면 조회하지 않습니다).

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

- **실제로 확인한 것**: 새 폴더에서 `npm run demo`·`npm start` 부팅, 화면 파일(`/`, `/app.js`, `/student/extension.mjs`) 응답, 데모 자료의 `/api/me`·`/api/apps`·`/api/devices`·`/api/sessions`·`/api/events`·`/api/vulnerabilities` 응답, 학생 표시 함수의 DOM 출력(가상 입력), 오류 구분 표시.
- **기다림(UNV)**: 실제 계정의 AI 연결 점검·사건 설명 호출(권한 준비 필요), 실제 원천 조치 집행과 효과 확인, 허용 패키지의 OSV 실조회, 네이티브 호스트 로그인·자격 증명 보관함, SDP 호스트 설정 연결.
- 데모(예제 자료) 결과와 연결 없음은 실제 연결 확인으로 적지 않습니다.
