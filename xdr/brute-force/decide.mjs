const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'rapid_same_source_failures',
    technique: 'T1110',
    confidence: 0.96,
    minCount: 30,
    minLevel: 10,
  }),
  Object.freeze({
    id: 'high_volume_same_account_failures',
    technique: 'T1110',
    confidence: 0.93,
    minCount: 30,
    minLevel: 10,
  }),
  Object.freeze({
    id: 'password_spray_multiple_accounts',
    technique: 'T1110',
    confidence: 0.95,
    minAccounts: 8,
    minLevel: 10,
  }),
]);

const AMBIGUOUS_CONFIDENCE = 0.65;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function numberFrom(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function describedCount(description) {
  const match = description.match(/(?:실패|계정)[^0-9]{0,24}(\d{1,4})\s*건/u)
    ?? description.match(/(?:계정\s*)(\d{1,4})\s*개/u);
  return match ? numberFrom(match[1]) : 0;
}

function accountCount(alert, description) {
  const listedAccounts = textOf(alert?.data?.accounts)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .length;
  const describedAccounts = Number(description.match(/계정\s*(\d{1,4})\s*개/u)?.[1] ?? 0);
  return Math.max(listedAccounts, describedAccounts);
}

function hasTechnique(alert, technique) {
  return Array.isArray(alert?.rule?.mitre)
    && alert.rule.mitre.some((item) => item === technique);
}

function hasSuccessfulLogin(description) {
  return /실패.{0,20}(?:뒤|후).{0,20}성공(?:했습니다|함|했다)?|성공(?:했습니다|함|했다).{0,15}로그인/u.test(description);
}

function result(action, confidence, reason) {
  return { action, confidence, reason };
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return result('record', 0, 'insufficient_evidence');
  }

  const description = textOf(alert?.rule?.description);
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const sourceAddress = textOf(alert?.data?.srcip);
  const account = textOf(alert?.data?.srcuser);
  const count = Math.max(numberFrom(alert?.data?.count), describedCount(description));
  const accounts = accountCount(alert, description);
  const failureEvidence = /로그인|실패|비밀번호|대입/u.test(description);
  const successfulLogin = hasSuccessfulLogin(description);
  const technique = hasTechnique(alert, 'T1110');
  const sourcePresent = sourceAddress.length > 0;

  if (technique && failureEvidence && sourcePresent && !successfulLogin) {
    const rapid = PATTERNS[0];
    if (level >= rapid.minLevel && count >= rapid.minCount) {
      return result('block', rapid.confidence, rapid.id);
    }

    const sameAccount = PATTERNS[1];
    if (level >= sameAccount.minLevel && count >= sameAccount.minCount && account.length > 0) {
      return result('block', sameAccount.confidence, sameAccount.id);
    }

    const spray = PATTERNS[2];
    const sprayEvidence = accounts >= spray.minAccounts
      && /여러 계정|서로 다른 계정|계정 이름을 바꿔|같은 비밀번호|계정\s*\d{1,4}\s*개/u.test(description);
    if (level >= spray.minLevel && sprayEvidence) {
      return result('block', spray.confidence, spray.id);
    }
  }

  if (technique && failureEvidence && sourcePresent) {
    return result('alert', AMBIGUOUS_CONFIDENCE, 'T1110_ambiguous_attempt');
  }

  return result('record', 0.05, 'insufficient_evidence');
}
