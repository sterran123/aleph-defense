# 스스로 시험한 결과

아래 네 항목은 심판의 자동 통과 판정이 아닙니다. 직접 시험한 뒤 답을 채우고, `package/self-check/`에 캡처를 넣으세요. 캡처에는 비밀번호·키·다른 사람의 개인정보가 보이지 않게 하세요.

## P3. 로그인 없이는 서버 두 개가 거절하는지
- 무엇을 했나요: `node --test test/package-starter.test.mjs`의 "AI·침해 정보 서버는 로그인 없는 요청을 거부한다" 시험으로 두 핸들러를 인증 없이 호출
- 무엇이 보였나요: 두 개 모두 HTTP 401 `{ error: 'UNAUTHORIZED' }`, `Cache-Control: no-store` — 성공을 꾸미거나 로그인을 통과시키지 않음
- 시험한 날짜: 2026-10-19 (로컬 단위 시험)
- 배포본 캡처: 미실행 — 배포가 최신 커밋으로 올라간 뒤 `self-check/P3-1.png`, `P3-2.png`로 찍어 채움

## P4. AI 호출 상한이 실제로 걸리는지
- 무엇을 했나요: `ai_usage` 표로 사용자·날짜별 호출 수를 서버에서 세도록 구현하고, 한도 초과 시 `429 AI_DAILY_LIMIT`를 반환하게 함
- 무엇이 보였나요: 미실행 — 배포본에서 로그인 세션으로 `AI_DAILY_LIMIT`까지 호출해 429가 뜨는지 확인한 뒤 캡처할 예정 (`GET /api/ai`는 현재 사용량 `used`/`remaining`을 보여줌)
- 시험한 날짜: 미실행
- 캡처: self-check/P4-1.png, self-check/P4-2.png (찍은 뒤 채움)

## P5. 침해 정보가 공식 목록에서 오고 받은 시각이 보이는지
- 무엇을 했나요: 로컬에서 CISA KEV 카탈로그·NVD CVE 2.0 API를 직접 조회해 내 의존성(`jose` 6.2.12, `@supabase/supabase-js` 2.117.2)과 대조 — 결과는 `THREAT-INTEL.md`에 기록
- 무엇이 보였나요: KEV 1748건 중 내 의존성 0건, NVD에서 npm `jose`·`supabase-js` 직접 해당 CVE 0건. 배포본에서 `/api/threat-intel` 호출 시 `fetchedAt`·`sources`·`cached`가 보이는지는 배포 후 확인 예정
- 시험한 날짜: 2026-10-19 (원천 조회), 배포본 캡처 미실행
- 캡처: self-check/P5-1.png, self-check/P5-2.png (찍은 뒤 채움)

## P7. 처음 받는 사람처럼 배포해서 첫 화면까지 가는지
- 무엇을 했나요: 미실행 — `package/README.md` 절차대로 새 Supabase·새 Vercel 프로젝트에 배포해 첫 화면과 `/api/ai` 401을 확인할 예정
- 무엇이 보였나요: 미실행
- 시험한 날짜: 미실행
- 캡처: self-check/P7-1.png, self-check/P7-2.png, self-check/P7-3.png (찍은 뒤 채움)
