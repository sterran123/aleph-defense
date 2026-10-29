# 내 보안 Agent 시작 틀 0.2.11

이 보안 Agent는 회사 직원이 자기 로그인 상태, 업무 앱 접속 결과, 최근 접속 기록과 보안 경보를 보는 보안 앱입니다. 13단계부터 22단계까지 이 프로젝트 하나로 화면을 채워 가며 완성합니다. 처음이라면 docs/GETTING_STARTED_STUDENT.md부터 읽습니다. 무엇을 왜 만드는지와 단계별 순서가 그 문서에 있습니다.

이 시작 틀을 받은 것만으로 단계를 통과하지 않습니다. 단계마다 docs/STUDENT_PROMPTS.md의 안내를 수업용 AI에 붙여 넣어 student/extension.mjs를 고치고, 화면에서 확인하고, 커밋한 뒤 ALEPH에 제출합니다. 제출하면 서버가 그 커밋의 코드를 받아 AI가 단계 과제 기준으로 읽고 판정합니다. 코드를 실행해서 판정하지 않습니다.

## 켜기

검수 환경은 Node.js 24.19.0이며 외부 npm 의존성이 없습니다. 이 폴더의 PowerShell에서 아래를 실행하고 PC 브라우저로 http://127.0.0.1:5189 를 엽니다. 자세한 켜기·끄기·다시 켜기는 docs/STUDENT_LAUNCH_GUIDE.md에 있습니다.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1

npm start도 같은 서버를 켭니다. 기본 실행은 실제 회사 시스템(기존 엔진)에 연결되지 않은 상태입니다. npm run demo는 예제 자료로 화면을 보여 줄 뿐이며 실제 연결이나 성취가 아닙니다. npm run check는 student/extension.mjs의 문법만 확인합니다.

## 알레프 수호령 — 이 앱이 하는 일

핵심 기능 세 가지: **보호 현황**(로그인·기기·세션), **업무 앱**(접속 판정 요청), **보안 기록**(접속·XDR 기록과 AI 설명). 여기에 수호령 마무리로 네 번째 메뉴 **내 PC**를 붙였습니다.

「내 PC」는 이 컴퓨터의 상태를 읽기만 합니다: CPU·메모리·디스크 실측, 연결 상태, 방화벽 프로필, 최근 시스템 이벤트. 설정을 바꾸는 기능은 없습니다. 방화벽·이벤트는 Windows에서만 읽고, 읽기가 실패한 부분은 확인 불가로 표시합니다.

## 남이 따라하는 실행 안내

1. Node.js 24.19.0을 설치합니다(다른 버전은 검수 환경과 다릅니다).
2. 이 폴더에서 PowerShell을 열고 `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1` 를 실행합니다. `npm start`도 같은 서버입니다.
3. 브라우저로 `http://127.0.0.1:5189` 를 엽니다. 상황에 맞지 않는 포트면 `ON_PORT` 환경 변수로 바꿀 수 있습니다.
4. 왼쪽 메뉴 「내 PC」를 열고 「다시 조회」를 누르면 이 PC의 실측값이 보입니다.

외부 npm 설치는 필요 없습니다(의존성 0). `npm run demo`는 예제 자료 화면이며, 서버 연결 없이도 「내 PC」 실측은 동작합니다. 시연·한계·읽기 근거는 docs/GUARDIAN.md에 있습니다.

## 지킬 것

- 기존 1~3차 프로젝트와 학생 파일은 지우거나 덮어쓰지 않습니다. 새 폴더에서 시작하거나, 이미 하던 프로젝트를 이어 씁니다.
- AI 열쇠·비밀번호·토큰을 코드, 커밋, 캡처, 도움정보에 넣지 않습니다. 주소나 열쇠를 직접 입력하는 칸도 만들지 않습니다.
- .env.example에는 비밀 없는 설정만 있습니다.

## 더 읽을 곳

- 단계별 안내와 AI에 붙여 넣을 문장: docs/STUDENT_PROMPTS.md
- 단계별 확인 항목: docs/CURRICULUM.json, docs/IMPLEMENTATION_CONTRACT.md
- 오류 코드별 해결: docs/CONNECTION_TROUBLESHOOT.md
- 시작 틀 업데이트(내 파일 보존): docs/STARTER_UPDATE.md
- 실제 회사 시스템(SDP)·앱 안 AI 연결은 담당자가 따로 안내할 때만 씁니다: docs/SDP_HOST_CONNECTION.md, docs/AI_SETUP_GUIDE.md. 이 연결은 앱을 처음 켜고 13~16단계 화면을 만들거나 공식 AI 코드 판정을 받기 위한 전제 조건은 아닙니다. 다만 17단계 이후의 실제 연결과 새 환경 재현은 해당 단계의 기준에 따라 따로 확인합니다.
