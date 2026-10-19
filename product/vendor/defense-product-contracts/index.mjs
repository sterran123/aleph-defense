// ALEPH 방어전 4~6차 제품 공개 계약. 학생 키트와 심판이 같은 파일을 씁니다.
export { ContractError, ERROR_CODES } from './src/errors.mjs';
export { CANONICAL_JSON_VERSION, canonicalJson, canonicalDigest, sha256Text, utf8Length } from './src/canonical-json.mjs';
export { POLICY_SCHEMA, POLICY_FIELDS, POLICY_EFFECTS, POLICY_LIMITS, validatePolicySnapshot, policyCanonical, policyDigest } from './src/policy.mjs';
export { BACKUP_FORMAT, BACKUP_ALLOWED_ITEMS, BACKUP_LIMITS, BACKUP_FORBIDDEN_KEYS, buildBackup, verifyBackup } from './src/backup.mjs';
export { OPERATION_SCHEMA, OPERATION_STATES, RETRY_POLICY, RETRY_LIMITS, isOperationKey, isFingerprint, operationFingerprint, compareOperation, retryDecision } from './src/operation.mjs';
export { EXECUTOR_LOG_SCHEMA, EXECUTOR_LOG_GENESIS, EXECUTOR_LOG_KINDS, executorEntryHash, nextExecutorEntry, verifyExecutorLog } from './src/executor-log.mjs';
export { PLATFORM_SUMS_FILE, parsePlatformSums, sha256Bytes, verifyPlatformFiles } from './src/platform-integrity.mjs';
export const CONTRACTS_VERSION = '0.1.4';
