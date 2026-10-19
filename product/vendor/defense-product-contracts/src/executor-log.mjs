// 집행 기록 계약(aleph.product.executor-log.v1).
//
// 제공 플랫폼의 집행기는 차단을 실제로 집행(apply)하거나 해제(release)할 때마다 기록 한 줄을 남깁니다.
// 기록은 실행 공간마다 순번(seq)이 1부터 이어지고, 각 줄은 바로 앞 줄의 해시(prev)를 품습니다.
// 그래서 줄을 지우거나 바꾸거나 끼워 넣으면 verifyExecutorLog 가 어긋남을 찾습니다.
// 학생 업무 코드(src/product/)는 이 기록에 쓸 수 없습니다. 심판은 동시 승인 뒤
// "같은 작업 키의 실제 집행이 정확히 한 번인지"를 이 기록으로 확인합니다.
import { canonicalJson, sha256Text } from './canonical-json.mjs';

export const EXECUTOR_LOG_SCHEMA = 'aleph.product.executor-log.v1';
export const EXECUTOR_LOG_GENESIS = '0'.repeat(64);
export const EXECUTOR_LOG_KINDS = Object.freeze(['apply', 'release']);

const HEX64 = /^[0-9a-f]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const FIELDS = ['action', 'at', 'hash', 'kind', 'operationKey', 'prev', 'seq', 'target'];

/** 한 줄의 해시. hash 필드 자신은 빼고 schema 를 더해 정규 직렬화한 값의 SHA-256 입니다. */
export function executorEntryHash({ seq, kind, operationKey, target, action, at, prev }) {
  return sha256Text(canonicalJson({ schema: EXECUTOR_LOG_SCHEMA, seq, kind, operationKey, target, action, at, prev })).slice('sha256:'.length);
}

/** 다음 줄을 만듭니다(플랫폼 집행기 전용). head 는 직전 줄 { seq, hash } 또는 null. */
export function nextExecutorEntry(head, { kind, operationKey, target, action = null, at }) {
  const seq = (head?.seq ?? 0) + 1;
  const prev = head?.hash ?? EXECUTOR_LOG_GENESIS;
  const entry = { seq, kind, operationKey, target, action, at, prev };
  return { ...entry, hash: executorEntryHash(entry) };
}

/**
 * 기록 전체를 검사합니다. 실패하면 { ok:false, code, at } 를 돌려줍니다(at = 문제가 된 줄의 위치).
 * 성공하면 { ok:true, head, applies } — applies 는 작업 키별 실제 집행(apply) 횟수입니다.
 * expectedHead 를 주면 마지막 줄이 그 값과 같아야 합니다(뒤쪽 줄을 잘라 낸 경우를 잡습니다).
 */
export function verifyExecutorLog(entries, { expectedHead = null } = {}) {
  if (!Array.isArray(entries)) return { ok: false, code: 'log_shape', at: -1 };
  let prev = EXECUTOR_LOG_GENESIS;
  const applies = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!e || typeof e !== 'object' || Array.isArray(e)
      || Object.keys(e).sort().join(',') !== FIELDS.join(',')) return { ok: false, code: 'entry_shape', at: i };
    if (e.seq !== i + 1) return { ok: false, code: 'seq_gap', at: i };
    if (!EXECUTOR_LOG_KINDS.includes(e.kind) || typeof e.operationKey !== 'string' || !e.operationKey
      || typeof e.target !== 'string' || !e.target || !ISO.test(e.at ?? '')
      || !(e.action === null || typeof e.action === 'string')
      || (e.kind === 'apply' && e.action === null)) return { ok: false, code: 'entry_shape', at: i };
    if (e.prev !== prev) return { ok: false, code: 'chain_broken', at: i };
    if (!HEX64.test(e.hash ?? '') || executorEntryHash(e) !== e.hash) return { ok: false, code: 'hash_mismatch', at: i };
    if (e.kind === 'apply') applies.set(e.operationKey, (applies.get(e.operationKey) ?? 0) + 1);
    prev = e.hash;
  }
  const head = entries.length ? { seq: entries.length, hash: prev } : null;
  if (expectedHead !== null && (head?.seq !== expectedHead.seq || head?.hash !== expectedHead.hash)) {
    return { ok: false, code: 'head_mismatch', at: entries.length };
  }
  return { ok: true, head, applies: Object.fromEntries(applies) };
}
