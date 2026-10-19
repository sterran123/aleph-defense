# 방어전 4~6차 제품 공개 계약 (0.1.4)

학생 시작 틀과 심판이 **같은 파일**을 씁니다. 학생도 심판도 이 규칙을 따로 다시 만들지 않습니다. 외부 패키지가 필요 없고 Node 20 이상에서 돌아갑니다.

아래 명령은 정본 저장소의 `packages/defense-product-contracts` 폴더에서 실행합니다. 학생 키트의 `vendor` 사본에는 시험 파일과 `vectors/`를 넣지 않았습니다. 학생은 키트 최상위 폴더에서 `npm test`로 공개 시험을 실행하고, `node scripts/platform-sums.mjs`로 제공 파일을 확인하세요.

```sh
node --test test/contracts.test.mjs
```

## 1. 공개 직렬화 규칙 (`aleph.canonical-json.v1`)

- 문자열, 불리언, null, 유한한 수, 배열, 평범한 객체만 씁니다.
- undefined, 함수, NaN, Infinity, 순환 참조, Date 같은 객체, 짝이 맞지 않는 서로게이트 문자는 오류로 거부합니다. 조용히 빼지 않습니다.
- 객체 키는 UTF-16 코드 단위 순서(JavaScript 기본 정렬, RFC 8785 와 같음)로 정렬하고, 배열 순서는 그대로 둡니다. 그래서 이모지 같은 비BMP 문자는 U+E000~U+FFFF 문자보다 앞에 옵니다. 수 표기도 RFC 8785 와 같이 ECMAScript 규칙을 따릅니다.
- 공백, BOM, 끝 줄바꿈을 넣지 않습니다. 해시는 이 문자열의 UTF-8 바이트에 대한 SHA-256 이며 `sha256:<64자리 소문자 16진수>` 로 적습니다.

## 2. 정책 스냅샷 (`aleph.product.policy.v1`)

```json
{ "schema": "aleph.product.policy.v1", "projectId": "…", "revision": 4,
  "rules": [ { "id": "allow-own", "effect": "allow", "…": "학생이 정한 필드" } ] }
```

- 최상위 필드는 이 네 가지뿐입니다. 다른 필드가 있으면 거부합니다.
- `revision` 은 1 이상의 정수입니다. 정책을 바꿀 때마다 올립니다. 예전 정책으로 되돌려도 새 판 번호를 씁니다.
- 규칙마다 `id`(고유)와 `effect`(`allow`·`deny`·`step_up`)는 반드시 있어야 합니다. 나머지 필드는 학생이 설계합니다.
- `policyDigest(snapshot)` 은 내용이 같은지 비교하는 값입니다. 누가 만들었는지나 적용 권한을 증명하지 않습니다. 학생이 돌려준 해시 문자열만으로 정책이 적용됐다고 인정하지 않으며, 심판은 실제 요청의 결과와 함께 봅니다.

## 3. 학습 백업 (`aleph.product.backup.v1`)

```json
{ "format": "aleph.product.backup.v1",
  "manifest": { "projectId": "…", "createdAt": "ISO 시각(선택)",
                "items": [ { "name": "policy.json", "sha256": "sha256:…", "bytes": 123 } ] },
  "payload": { "policy.json": "<공개 직렬화 문자열>" } }
```

- 항목은 `policy.json`, `selected-events.json` 두 가지만 허용하고 하나 이상 있어야 합니다.
- 사건은 `id`(고유)와 `at`(ISO 시각)이 있어야 합니다.
- 감사 이력, 비밀번호, 토큰, 서비스 키, RLS·권한 설정을 뜻하는 **키 이름**(`BACKUP_FORBIDDEN_KEYS`, 대소문자·`_`·`-` 무시)이 어디에든 있으면 거부합니다. 값 속 낱말이나 `role`·`tokenType` 같은 다른 키는 막지 않습니다. 규칙 필드 이름으로 `grant`, `token`, `secret` 자체는 쓰지 마세요.
- `verifyBackup(input, { projectId })` 이 `ok: true` 를 돌려준 뒤에만 반영을 시작합니다. 중간에 실패하면 원래 상태를 유지해야 합니다.
- 크기 상한: 전체 1 MiB, 항목 하나 512 KiB, 사건 5,000건.

## 4. 대응 작업 키 (`aleph.product.operation.v1`)

- 작업 키는 실행마다 새로 만든 소문자 UUID 입니다.
- 서버는 키와 `operationFingerprint({ projectId, target, action, payload })` 를 함께 저장합니다.
- 같은 키·같은 지문이 다시 오면 새로 집행하지 않고 처음 결과를 돌려줍니다. 같은 키에 다른 내용이 오면 409 로 거부합니다.
- 상태는 `pending`·`succeeded`·`failed` 입니다.
- `retryDecision()` 규칙: 400·401·403·404·409·422 는 다시 시도하지 않습니다. 429·503·응답을 받지 못한 시간 초과만 같은 키로 1초, 2초 간격 최대 2회 다시 시도합니다. 시간 예산을 넘거나 횟수를 다 쓰면 `hold` 이며 완료로 표시하지 않고 상태를 다시 조회합니다.

## 5. 대표 벡터

`vectors/` 의 기대값은 구현 코드가 아니라 Python `hashlib` 로 따로 계산했습니다. 구현이 바뀌어도 이 값과 맞아야 합니다.

| 파일 | 내용 |
|---|---|
| `policy-digest.json` | 정상 7건(키 순서·규칙 순서·한국어·이스케이프 포함), 거부 10건, JS 전용 거부 7건, 직렬화 전용 4건(숫자 모양 키·한글 키·비BMP 키·수 표기) |
| `backup.json` | 정상 백업 1건, 손상·범위 밖·금지 내용 16건 |
| `operation-key.json` | 지문 3건, 처음·재전송·충돌 3건, 잘못된 키 4건, 재시도 판단 11건 |
