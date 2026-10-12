const BLOCK_PATTERNS = Object.freeze([
  Object.freeze({ id: 'admin_group_add_from_remote_source', confidence: 0.94, signals: [/관리자 그룹에 추가됐|관리자 그룹에 들어가/iu, /원격 주소|처음 보는 주소|낯선 주소/iu] }),
  Object.freeze({ id: 'admin_command_after_new_privilege', confidence: 0.97, signals: [/방금 관리자가 된/iu, /관리자 명령/iu] }),
  Object.freeze({ id: 'admin_command_from_unfamiliar_context', confidence: 0.93, signals: [/수업 시간 밖/iu, /관리자 명령/iu] }),
  Object.freeze({ id: 'bulk_admin_group_addition', confidence: 0.95, signals: [/계정\s*\d+개가 관리자 그룹에 추가/iu] }),
  Object.freeze({ id: 'session_elevated_from_new_source', confidence: 0.94, signals: [/세션이 관리자 권한으로 바뀌/iu, /(?:처음 봅|처음 본|낯선)/iu] }),
  Object.freeze({ id: 'after_hours_group_and_command', confidence: 0.95, signals: [/업무.{0,20}(?:밖|보이지 않는 시각|시간 외)/iu, /관리자 그룹 추가/iu, /명령 실행/iu] }),
  Object.freeze({ id: 'other_identity_privileged_command', confidence: 0.95, signals: [/다른 계정의 권한으로 관리자 명령/iu] }),
  Object.freeze({ id: 'admin_readded_after_removal', confidence: 0.92, signals: [/관리자 그룹에서 빠진 계정/iu, /다시 관리자/iu] }),
  Object.freeze({ id: 'ordinary_account_admin_command', confidence: 0.95, signals: [/평범한 계정/iu, /관리자 그룹에 들어가고/iu, /권한 명령/iu] }),
]);
const REVIEW_CONFIDENCE = 0.58;
const WEAK_PRIVILEGE_SIGNAL = /권한|관리자|그룹|상승|명령|계정 종류/iu;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function hasRelevantTechnique(alert) {
  return Array.isArray(alert?.rule?.mitre)
    && alert.rule.mitre.some((item) => item === 'T1068' || item === 'T1078');
}

function result(action, confidence, reason) {
  return { action, confidence, reason };
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return result('record', 0.05, 'insufficient_evidence');
  }

  const description = textOf(alert?.rule?.description);
  const data = alert?.data && typeof alert.data === 'object' ? alert.data : {};
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const account = textOf(data.srcuser);
  const sourceAddress = textOf(data.srcip);
  const relevant = hasRelevantTechnique(alert);

  if (!relevant || !account || !sourceAddress) {
    return result('record', 0.05, 'insufficient_evidence');
  }

  const strong = BLOCK_PATTERNS.find((pattern) => level >= 10
    && pattern.signals.every((signal) => signal.test(description)));
  if (strong) return result('block', strong.confidence, strong.id);

  if (level >= 5 && WEAK_PRIVILEGE_SIGNAL.test(description)) {
    return result('alert', REVIEW_CONFIDENCE, 'weak_privilege_signal_review');
  }

  return result('record', 0.05, 'insufficient_evidence');
}
