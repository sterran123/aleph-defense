const PATTERNS = Object.freeze([
  Object.freeze({ id: 'jndi_remote_lookup_in_request', confidence: 0.96 }),
  Object.freeze({ id: 'known_cve_probe_without_complete_lookup', confidence: 0.64 }),
  Object.freeze({ id: 'incomplete_remote_lookup_probe', confidence: 0.58 }),
]);
const TECHNIQUE = 'T1190';
const STRONG_REMOTE_LOOKUP = /\$\{\s*jndi\s*:\s*[a-z0-9+.-]+\s*:\/\//iu;
const WEAK_KNOWN_VULNERABILITY = /CVE-2021-44228|jndi|원격\s*조회|조회\s*구문|취약점|점검\s*(?:흔적|도구)|중괄호|조회\s*형태|로그\s*라이브러리|악용\s*구문|라이브러리\s*이름/iu;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function hasTechnique(alert) {
  return Array.isArray(alert?.rule?.mitre)
    && alert.rule.mitre.some((item) => item === TECHNIQUE);
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
  const requestText = [
    description,
    textOf(data.url),
    textOf(data.useragent),
    textOf(data.referer),
    textOf(data.headers),
    textOf(data.args),
    textOf(data.query),
  ].join('\n');
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const sourcePresent = textOf(data.srcip).length > 0;
  const technique = hasTechnique(alert);

  if (technique && sourcePresent && level >= 10 && STRONG_REMOTE_LOOKUP.test(requestText)) {
    return result('block', PATTERNS[0].confidence, PATTERNS[0].id);
  }

  if (technique && sourcePresent && WEAK_KNOWN_VULNERABILITY.test(requestText)) {
    const reason = /CVE-2021-44228|점검\s*(?:흔적|도구)|로그\s*라이브러리|라이브러리\s*이름/iu.test(requestText)
      ? PATTERNS[1].id
      : PATTERNS[2].id;
    const pattern = PATTERNS.find((item) => item.id === reason);
    return result('alert', pattern.confidence, pattern.id);
  }

  return result('record', 0.05, 'insufficient_evidence');
}
