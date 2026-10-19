// 대응 작업 키 계약(aleph.product.operation.v1).
//
// - 작업 키(operationKey)는 실행마다 새로 만든 UUID(소문자, 하이픈 포함 36자)입니다.
// - 서버는 키와 함께 projectId·target·action·payload 의 지문(fingerprint)을 저장합니다.
// - 같은 키·같은 지문이 다시 오면 새로 집행하지 않고 처음 작업의 상태와 결과를 돌려줍니다(same).
// - 같은 키인데 지문이 다르면 409 로 거부합니다(conflict).
// - 상태는 pending · succeeded · failed 세 가지입니다.
// - 401·403·400·422 같은 인증·검증 오류는 자동으로 다시 시도하지 않습니다.
//   429(대기 안내)·503·응답을 받지 못한 시간 초과만 같은 키로 다시 시도합니다.
//   기본은 처음 요청 뒤 1초, 2초 간격으로 최대 2회입니다. 대기 시간이 예산을 넘으면 보류하고 완료로 표시하지 않습니다.
import { ContractError, ERROR_CODES as E } from './errors.mjs';
import { canonicalDigest } from './canonical-json.mjs';

export const OPERATION_SCHEMA = 'aleph.product.operation.v1';
export const OPERATION_STATES = Object.freeze(['pending', 'succeeded', 'failed']);
export const RETRY_POLICY = Object.freeze({
  delaysMs: Object.freeze([1000, 2000]),
  maxRetries: 2,
  retryableStatuses: Object.freeze([429, 503]),
  neverRetryStatuses: Object.freeze([400, 401, 403, 404, 409, 422]),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isOperationKey(key) {
  return typeof key === 'string' && UUID.test(key);
}

/** projectId·target·action·payload 로 지문('sha256:<hex>')을 만듭니다. 작업 키 자체는 지문에 넣지 않습니다. */
export function operationFingerprint({ projectId, target, action, payload = null } = {}) {
  if (typeof projectId !== 'string' || projectId.length === 0) throw new ContractError(E.OPERATION_SHAPE, 'projectId');
  if (typeof target !== 'string' || target.length === 0 || target.length > 256) throw new ContractError(E.OPERATION_SHAPE, 'target');
  if (typeof action !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/u.test(action)) throw new ContractError(E.OPERATION_SHAPE, 'action');
  return canonicalDigest({ schema: OPERATION_SCHEMA, projectId, target, action, payload });
}

/**
 * 저장된 작업과 새로 들어온 요청을 비교합니다.
 * stored: { key, fingerprint } 또는 null(처음 보는 키)
 * incoming: { key, fingerprint }
 * 반환: 'new' | 'same' | 'conflict'
 */
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;
export function isFingerprint(fp) { return typeof fp === 'string' && FINGERPRINT.test(fp); }

export function compareOperation(stored, incoming) {
  if (!incoming || !isOperationKey(incoming.key)) throw new ContractError(E.OPERATION_KEY, 'incoming.key');
  if (!isFingerprint(incoming.fingerprint)) throw new ContractError(E.OPERATION_SHAPE, 'incoming.fingerprint');
  if (stored === null || stored === undefined) return 'new';
  if (!isOperationKey(stored.key)) throw new ContractError(E.OPERATION_KEY, 'stored.key');
  if (!isFingerprint(stored.fingerprint)) throw new ContractError(E.OPERATION_SHAPE, 'stored.fingerprint');
  if (stored.key !== incoming.key) throw new ContractError(E.OPERATION_KEY, 'key mismatch');
  return stored.fingerprint === incoming.fingerprint ? 'same' : 'conflict';
}

/**
 * 다시 시도할지 정합니다.
 * status: HTTP 상태 코드(응답을 못 받았으면 null)
 * uncertain: 응답을 받지 못해 집행 여부를 모르는 경우 true
 * attempt: 지금까지 보낸 횟수(처음 요청 = 1)
 * elapsedMs·budgetMs: 지금까지 쓴 시간과 허용 예산
 * retryAfterMs: 429 의 대기 안내(없으면 null)
 * 반환: { retry: true, delayMs } | { retry: false, outcome: 'done' | 'give_up' | 'hold' }
 */
export const RETRY_LIMITS = Object.freeze({ maxBudgetMs: 60_000, maxRetryAfterMs: 60_000 });

function checkRetryInput({ status, uncertain, attempt, elapsedMs, budgetMs, retryAfterMs }) {
  const bad = detail => { throw new ContractError(E.OPERATION_SHAPE, detail); };
  if (status !== null && !(Number.isInteger(status) && status >= 100 && status <= 599)) bad('status');
  if (typeof uncertain !== 'boolean') bad('uncertain');
  if (status === null && !uncertain) bad('status null requires uncertain');
  if (!Number.isSafeInteger(attempt) || attempt < 1) bad('attempt');
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) bad('elapsedMs');
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > RETRY_LIMITS.maxBudgetMs) bad('budgetMs');
  if (retryAfterMs !== null && (!Number.isFinite(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > RETRY_LIMITS.maxRetryAfterMs)) bad('retryAfterMs');
}

export function retryDecision({ status = null, uncertain = false, attempt = 1, elapsedMs = 0, budgetMs = 10_000, retryAfterMs = null } = {}) {
  checkRetryInput({ status, uncertain, attempt, elapsedMs, budgetMs, retryAfterMs });
  if (status !== null && status >= 200 && status < 300) return { retry: false, outcome: 'done' };
  if (status !== null && RETRY_POLICY.neverRetryStatuses.includes(status)) return { retry: false, outcome: 'give_up' };
  const retryable = uncertain || (status !== null && RETRY_POLICY.retryableStatuses.includes(status));
  if (!retryable) return { retry: false, outcome: 'give_up' };
  const retriesUsed = attempt - 1;
  if (retriesUsed >= RETRY_POLICY.maxRetries) return { retry: false, outcome: 'hold' };
  let delayMs = RETRY_POLICY.delaysMs[retriesUsed];
  if (status === 429 && retryAfterMs !== null && retryAfterMs > delayMs) delayMs = retryAfterMs;
  if (elapsedMs + delayMs > budgetMs) return { retry: false, outcome: 'hold' };
  return { retry: true, delayMs };
}
