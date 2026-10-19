// 공개 계약 오류. 학생 키트와 심판이 같은 오류 코드를 씁니다.
export class ContractError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ContractError';
    this.code = code;
    this.detail = detail;
  }
}

export const ERROR_CODES = Object.freeze({
  // 직렬화
  JSON_UNSUPPORTED_TYPE: 'json_unsupported_type',
  JSON_NON_FINITE_NUMBER: 'json_non_finite_number',
  JSON_CYCLE: 'json_cycle',
  JSON_TOO_DEEP: 'json_too_deep',
  JSON_INVALID_STRING: 'json_invalid_string',
  // 정책
  POLICY_SHAPE: 'policy_shape',
  POLICY_SCHEMA: 'policy_schema',
  POLICY_EXTRA_FIELD: 'policy_extra_field',
  POLICY_PROJECT: 'policy_project',
  POLICY_REVISION: 'policy_revision',
  POLICY_RULES: 'policy_rules',
  POLICY_RULE_DUPLICATE: 'policy_rule_duplicate',
  // 백업
  BACKUP_PARSE: 'backup_parse',
  BACKUP_SHAPE: 'backup_shape',
  BACKUP_FORMAT: 'backup_format',
  BACKUP_TOO_LARGE: 'backup_too_large',
  BACKUP_PROJECT: 'backup_project',
  BACKUP_ITEM_UNKNOWN: 'backup_item_unknown',
  BACKUP_ITEM_DUPLICATE: 'backup_item_duplicate',
  BACKUP_ITEM_MISSING: 'backup_item_missing',
  BACKUP_LENGTH_MISMATCH: 'backup_length_mismatch',
  BACKUP_HASH_MISMATCH: 'backup_hash_mismatch',
  BACKUP_FORBIDDEN_CONTENT: 'backup_forbidden_content',
  BACKUP_ITEM_INVALID: 'backup_item_invalid',
  // 작업 키
  OPERATION_SHAPE: 'operation_shape',
  OPERATION_KEY: 'operation_key',
});
