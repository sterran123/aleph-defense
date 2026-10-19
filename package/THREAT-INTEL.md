# 침해 정보 비교

이 제품이 실제로 쓰는 구성 요소(`package.json` 의존성)를 공식 침해 정보와 대조한 결과입니다.

## 조회한 공식 원천과 시각

| 원천 | 주소 | 실제로 받아 온 시각(fetchedAt) |
|---|---|---|
| CISA KEV | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | 2026-10-19 (조회 당시 전체 1748건) |
| NVD CVE 2.0 | `https://services.nvd.nist.gov/rest/json/cves/2.0` | 2026-10-19 |

배포된 서버에서 `/api/threat-intel`을 로그인한 뒤 호출하면 같은 원천을 6시간 캐시로 다시 조회하고 `fetchedAt`을 응답합니다.

## 대조표 — 내 제품 구성 요소 × 공식 침해 정보

| 구성 요소 | 내 버전 | KEV | NVD | 판단 |
|---|---|---|---|---|
| `jose` (npm) | 6.2.12 | 해당 없음 (0건) | npm `jose`의 알려진 CVE는 CVE-2024-28176(4.15.5/5.2.4 미만) — 내 버전보다 낮은 판에만 해당 | 대상 아님 |
| `@supabase/supabase-js` | 2.117.2 | 해당 없음 (0건) | `supabase-js` 키워드 0건. 서버 구성요소 CVE-2026-31813(Auth < 2.185.0)은 Supabase 측 호스팅 버전 문제 — 대시보드에서 프로젝트 Auth 버전 확인 필요 | 라이브러리 대상 아님, 호스팅 버전 점검 항목 |
| `@supabase/auth-js` (transitive) | 2.117.2 | 해당 없음 | CVE-2025-48370은 2.70.0 미만에만 해당 | 대상 아님 |

## 판단 근거

- NVD `jose` 키워드 검색(총 82건) 대부분은 PHP 라이브러리(namshi/jose, jose-php, Nimbus JOSE) 등 다른 제품 — npm `jose`와 무관한 동명 제품이어서 표에서 제외했습니다.
- KEV(실제로 악용이 확인된 목록)에는 두 의존성이 모두 없습니다 — 즉 "공식적으로 실제 침해가 확인된" 내 의존성 항목은 없습니다.
- 조치 항목: Supabase 프로젝트의 Auth(gotrue) 서버 버전이 2.185.0 미만이면 CVE-2026-31813 대상 — 대시보드 `Project Settings → Infrastructure`에서 버전을 확인하고, 오래됐으면 프로젝트 업그레이드를 실행합니다.

## 업데이트하는 법

라이브러리 버전이 바뀌거나 새 침해 정보가 나오면 `npm run package` 전에 `/api/threat-intel` 응답의 `checks` 항목을 이 표에 다시 옮깁니다. 캡처한 화면(발행 시각과 출처가 보이게)은 `self-check/P5-1.png`, `P5-2.png`에 둡니다.
