const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'repeated_sql_input_signal',
    confidence: 0.94,
    pattern: /(?:doc-sql-(?:chain|or|select-chain)|doc-mixed-marker|SQL\s*(?:구문|표기)|데이터베이스\s*조회.{0,12}이어\s*붙)/iu,
  }),
  Object.freeze({
    id: 'repeated_script_insertion_signal',
    confidence: 0.94,
    pattern: /(?:doc-script-marker|doc-mixed-marker|스크립트\s*(?:삽입\s*)?표(?:기|식))/iu,
  }),
  Object.freeze({
    id: 'repeated_path_traversal_signal',
    confidence: 0.94,
    pattern: /(?:doc-up-repeat|경로.{0,24}(?:거슬러\s*올라가|이탈)\s*표기)/iu,
  }),
  Object.freeze({
    id: 'repeated_control_separator_signal',
    confidence: 0.92,
    pattern: /(?:doc-cmd-separator|명령\s*구분자\s*표기)/iu,
  }),
]);

const MIN_BLOCK_LEVEL = 10;
const MIN_BLOCK_COUNT = 8;
const AMBIGUOUS_CONFIDENCE = 0.65;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function nonnegativeCount(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function describedCount(description) {
  const matches = [...description.matchAll(/(\d{1,4})\s*(?:번|회)/gu)];
  return matches.reduce((highest, match) => Math.max(highest, nonnegativeCount(match[1])), 0);
}

function hasTechnique(alert) {
  return Array.isArray(alert?.rule?.mitre)
    && alert.rule.mitre.some((item) => item === 'T1190');
}

function result(action, confidence, reason) {
  return { action, confidence, reason };
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return result('record', 0, 'insufficient_evidence');
  }

  const description = textOf(alert?.rule?.description);
  const url = textOf(alert?.data?.url);
  const sourceAddress = textOf(alert?.data?.srcip);
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const count = Math.max(nonnegativeCount(alert?.data?.count), describedCount(description));
  const technique = hasTechnique(alert);
  const signalText = `${url}\n${description}`;
  const matchedPattern = PATTERNS.find(({ pattern }) => pattern.test(signalText));

  if (technique && sourceAddress.length > 0 && level >= MIN_BLOCK_LEVEL
      && count >= MIN_BLOCK_COUNT && matchedPattern) {
    return result('block', matchedPattern.confidence, matchedPattern.id);
  }

  if ((technique || matchedPattern) && sourceAddress.length > 0) {
    return result('alert', AMBIGUOUS_CONFIDENCE, 'T1190_ambiguous_web_input');
  }

  return result('record', 0.05, 'insufficient_evidence');
}
