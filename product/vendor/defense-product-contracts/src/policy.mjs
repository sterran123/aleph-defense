// 정책 스냅샷 계약(aleph.product.policy.v1)과 정책 해시.
// 해시 대상은 schema·projectId·revision·rules 네 필드뿐입니다. 다른 최상위 필드가 있으면 거부합니다.
// 해시는 내용 무결성 비교용입니다. 누가 만들었는지나 적용 권한을 증명하지 않습니다.
import { ContractError, ERROR_CODES as E } from './errors.mjs';
import { canonicalJson, sha256Text } from './canonical-json.mjs';

export const POLICY_SCHEMA = 'aleph.product.policy.v1';
export const POLICY_FIELDS = Object.freeze(['schema', 'projectId', 'revision', 'rules']);
export const POLICY_EFFECTS = Object.freeze(['allow', 'deny', 'step_up']);
export const POLICY_LIMITS = Object.freeze({ maxRules: 500, maxRevision: 2_147_483_647, maxProjectIdLength: 128 });

const RULE_ID = /^[A-Za-z0-9_.:-]{1,64}$/u;
const CONTROL = /[\u0000-\u001F\u007F]/u;

function fail(code, detail) { throw new ContractError(code, detail); }

/**
 * 정책 스냅샷을 검사합니다. 통과하면 같은 객체를 돌려주고, 아니면 ContractError 를 던집니다.
 * 규칙마다 id(고유)와 effect(allow|deny|step_up)는 필수입니다. 그 밖의 규칙 필드는 학생이 정하되
 * 공개 직렬화 규칙(canonical-json)에 맞는 값이어야 합니다.
 */
export function validatePolicySnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail(E.POLICY_SHAPE, 'object required');
  for (const key of Object.keys(snapshot)) if (!POLICY_FIELDS.includes(key)) fail(E.POLICY_EXTRA_FIELD, key);
  if (snapshot.schema !== POLICY_SCHEMA) fail(E.POLICY_SCHEMA, String(snapshot.schema));
  const { projectId, revision, rules } = snapshot;
  if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > POLICY_LIMITS.maxProjectIdLength
      || CONTROL.test(projectId) || projectId.trim() !== projectId) fail(E.POLICY_PROJECT, 'projectId');
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > POLICY_LIMITS.maxRevision) fail(E.POLICY_REVISION, String(revision));
  if (!Array.isArray(rules) || rules.length > POLICY_LIMITS.maxRules) fail(E.POLICY_RULES, 'rules array');
  const ids = new Set();
  rules.forEach((rule, i) => {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) fail(E.POLICY_RULES, `rules[${i}] object`);
    if (typeof rule.id !== 'string' || !RULE_ID.test(rule.id)) fail(E.POLICY_RULES, `rules[${i}].id`);
    if (!POLICY_EFFECTS.includes(rule.effect)) fail(E.POLICY_RULES, `rules[${i}].effect`);
    if (ids.has(rule.id)) fail(E.POLICY_RULE_DUPLICATE, rule.id);
    ids.add(rule.id);
  });
  canonicalJson(snapshot); // 값 형식 검사(함수·undefined·비유한 수 등 거부)
  return snapshot;
}

/** 검사를 통과한 스냅샷의 공개 직렬화 문자열 */
export function policyCanonical(snapshot) {
  validatePolicySnapshot(snapshot);
  return canonicalJson(snapshot);
}

/** 'sha256:<64자리 소문자 16진수>' */
export function policyDigest(snapshot) {
  return sha256Text(policyCanonical(snapshot));
}
