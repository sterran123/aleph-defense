# ALEKOV 방어전 — on-client (4차 과제)

현재 과제 대상은 `on-client/` 아래의 로컬 보안 에이전트 앱입니다.
(1~12단계 자료실 프로젝트와 13단계 배포 묶음은 Git 이력에만 남아 있습니다.)

## 실행

```sh
cd on-client
npm run check        # student/extension.mjs 문법 점검
npm run demo         # 예제 자료로 실행 → http://127.0.0.1:5189
npm start            # 연결 확인 모드 (원천 엔진 없으면 disconnected)
```

포트는 `ON_PORT` 환경 변수로 바꿀 수 있습니다(기본 5189).

## 구성

- 학생 구현: `on-client/student/extension.mjs`의 `renderIdentity`~`renderAction`
- 제공 코드: `public/`(화면), `src/`(서버·AI·조치·취약점), `vendor/`(CLCO 전송), `tools/`(호스트 준비)
- 학생 문서: `on-client/docs/STUDENT_MANUAL.md`(설명서·구성도), `on-client/docs/NEW_ENV_RUN.md`(새 환경 실행 기록)

비밀값(열쇠·토큰·개인키)은 코드·문서·커밋에 넣지 않습니다. 실제 AI 권한·원천 조치 연결은 담당자 준비가 필요한 기다림(UNV) 항목입니다.
