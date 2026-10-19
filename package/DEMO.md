# 시연 안내

- 시연 주소: `https://aleph-defense-three.vercel.app` (Vercel Deployments에서 최신 커밋 배포 확인 뒤 사용)
- 시연 계정 만드는 방법: Supabase 대시보드 → Authentication → Users → **Add user** 에서 이메일·비밀번호로 직접 생성. 계정 ID와 비밀번호는 이 문서에 적지 않습니다.
- 시연 순서:
  1. **로그인**: 첫 화면에서 계정으로 로그인 → 서버 세션 쿠키 발급
  2. **자료실**: 메모 작성·조회 — 본인 것만 보이고, 로그아웃하면 `GET /api/notes`가 401
  3. **작전실**: 작업·사건 화면에서 탐지·판정 결과 확인
  4. **침해 정보**: `/api/threat-intel` — 로그인 상태에서 조회하면 공식 원천의 `fetchedAt`과 내 의존성 대조표가 나옴
  5. **AI 도우미**: `/api/ai` — 로그인 상태에서만 호출되고 하루 상한을 넘으면 `429`; 서버에 `AI_PROXY_URL`이 없으면 `503 AI_NOT_CONFIGURED`로 정직하게 답함
- 캡처: 화면 세 장 이상을 `package/self-check/`에 파일 이름 목록(`CAPTURES.md`)대로 넣고 상대 경로로 연결합니다.

배포본이 최신 커밋인지 먼저 확인하는 법: `https://aleph-defense-three.vercel.app/aleph.json`의 `commit`이 push한 커밋과 같아야 합니다. 다르면 Vercel에서 Redeploy 후 시연합니다.
