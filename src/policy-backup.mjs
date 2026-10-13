// Stage 10 keeps a code-reviewed, versioned policy snapshot as the trust anchor.
import { createHash } from 'node:crypto';

export const VERIFIED_POLICY_REVISION = 1;
export const VERIFIED_POLICY_RULES = Object.freeze([
  'device_registered',
  'step_up_required',
  'resource_zone',
]);

function snapshotHash(revision, rules) {
  return createHash('sha256')
    .update(JSON.stringify({ revision, rules }), 'utf8')
    .digest('hex');
}

export const VERIFIED_POLICY_BACKUP = Object.freeze({
  revision: VERIFIED_POLICY_REVISION,
  rules: VERIFIED_POLICY_RULES,
  sha256: snapshotHash(VERIFIED_POLICY_REVISION, VERIFIED_POLICY_RULES),
});

export function verifyPolicyBackup(backup = VERIFIED_POLICY_BACKUP) {
  return Boolean(backup && backup.revision === VERIFIED_POLICY_REVISION
    && Array.isArray(backup.rules)
    && backup.rules.length === VERIFIED_POLICY_RULES.length
    && backup.rules.every((rule, index) => rule === VERIFIED_POLICY_RULES[index])
    && backup.sha256 === VERIFIED_POLICY_BACKUP.sha256
    && snapshotHash(backup.revision, backup.rules) === backup.sha256);
}

function policyRules(currentPolicy) {
  if (Array.isArray(currentPolicy)) return currentPolicy;
  if (currentPolicy && typeof currentPolicy === 'object' && Array.isArray(currentPolicy.rules)) {
    return currentPolicy.rules;
  }
  throw new TypeError('invalid_policy_rules_array');
}

export function diffPolicy(currentPolicy, backup = VERIFIED_POLICY_BACKUP) {
  const currentRules = policyRules(currentPolicy);
  if (currentRules.some(rule => typeof rule !== 'string') || !verifyPolicyBackup(backup)) {
    throw new TypeError('unverified_policy_backup');
  }
  const currentSet = new Set(currentRules);
  const backupSet = new Set(backup.rules);
  const missing = backup.rules.filter(rule => !currentSet.has(rule));
  const added = currentRules.filter(rule => !backupSet.has(rule));

  return {
    verifiedRevision: backup.revision,
    verifiedSha256: backup.sha256,
    inSync: missing.length === 0 && added.length === 0,
    missing,
    added,
    scope: { current: [...currentRules], target: [...backup.rules] },
  };
}

export function restorePolicy(currentPolicy, backup = VERIFIED_POLICY_BACKUP) {
  const currentRules = policyRules(currentPolicy);
  const diff = diffPolicy(currentPolicy, backup);
  const restoredRules = [...backup.rules];
  const state = Array.isArray(currentPolicy)
    ? { revision: backup.revision, rules: restoredRules }
    : {
      ...currentPolicy,
      revision: backup.revision,
      rules: restoredRules,
      ...(Array.isArray(currentPolicy.serviceRules) ? { serviceRules: [...currentPolicy.serviceRules] } : {}),
      ...(Array.isArray(currentPolicy.auditRecords)
        ? { auditRecords: structuredClone(currentPolicy.auditRecords) } : {}),
    };
  return {
    restored: true,
    revision: backup.revision,
    diff,
    rules: restoredRules,
    state,
    currentRules: [...currentRules],
  };
}
