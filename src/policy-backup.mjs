// 10단계: 침해 전 검증된 안전 정책 사본 및 복원 절차
export const VERIFIED_POLICY_REVISION = 1;
export const VERIFIED_POLICY_RULES = Object.freeze([
  'device_registered',
  'step_up_required',
  'resource_zone',
]);

export function diffPolicy(currentRules, backupRules = VERIFIED_POLICY_RULES) {
  if (!Array.isArray(currentRules) || !Array.isArray(backupRules)) {
    throw new TypeError('invalid_policy_rules_array');
  }
  const currentSet = new Set(currentRules);
  const backupSet = new Set(backupRules);

  const missing = backupRules.filter(r => !currentSet.has(r));
  const added = currentRules.filter(r => !backupSet.has(r));

  return {
    verifiedRevision: VERIFIED_POLICY_REVISION,
    inSync: missing.length === 0 && added.length === 0,
    missing,
    added,
    scope: { current: [...currentRules], target: [...backupRules] },
  };
}

export function restorePolicy(currentRules, backupRules = VERIFIED_POLICY_RULES) {
  const diff = diffPolicy(currentRules, backupRules);
  const restoredRules = [...backupRules];
  return {
    restored: true,
    revision: VERIFIED_POLICY_REVISION,
    diff,
    rules: restoredRules,
  };
}
