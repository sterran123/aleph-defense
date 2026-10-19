# 화면 캡처 목록

아래 파일 이름 그대로 `package/self-check/` 안에 넣습니다. 캡처에 비밀번호·키·다른 사람의 개인정보가 보이지 않게 합니다. 찍지 않은 항목은 찍은 척하지 않고 비워 둡니다.

| 파일 | 무엇을 찍는지 | 어느 화면/요청 |
|---|---|---|
| `P3-1.png` | 로그인 없이 `GET /api/ai` 호출이 `401`로 거부되는 화면 | 브라우저 개발자도구 Network 또는 curl 결과 |
| `P3-2.png` | 로그인 없이 `GET /api/threat-intel` 호출이 `401`로 거부되는 화면 | 위와 같은 방법 |
| `P4-1.png` | 로그인한 상태에서 `/api/ai`를 하루 상한 횟수까지 호출한 뒤 `429 AI_DAILY_LIMIT`가 오는 화면 | 콘솔 또는 Network 탭 |
| `P4-2.png` | `GET /api/ai`가 `limit`·`used`·`remaining`을 보여주는 화면 | 위와 같은 방법 |
| `P5-1.png` | `/api/threat-intel` 응답에 `fetchedAt`(실제 받아 온 시각)과 `sources`가 보이는 화면 | Network 탭 또는 curl 결과 |
| `P5-2.png` | 같은 요청을 다시 보냈을 때 `cached: true`와 같은 `fetchedAt`이 유지되는 화면 | 위와 같은 방법 |
| `P7-1.png` | README 안내대로 새 Vercel 프로젝트를 만든 배포 목록 화면 | Vercel 대시보드 Deployments |
| `P7-2.png` | 새 배포 주소의 첫 화면 | 브라우저 주소창 포함 |
| `P7-3.png` | 새 배포에서 `/api/ai`가 `401`로 거절되는 화면 | 브라우저 또는 curl 결과 |
