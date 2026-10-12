const SECRET_ASSIGNMENT = /\b(password|passwd|token|secret|api[_-]?key|authorization)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/giu;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;

export function redactSensitive(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT, (_match, key) => `${key}=[REDACTED]`)
    .replace(JWT_VALUE, '[REDACTED]');
}

function safeString(value) {
  return typeof value === 'string' ? redactSensitive(value) : '';
}

export function readAlerts(alerts) {
  if (!Array.isArray(alerts)) throw new TypeError('alerts_must_be_array');
  return alerts.map((alert) => ({
    timestamp: safeString(alert?.timestamp),
    sourceAddress: safeString(alert?.data?.srcip),
    account: safeString(alert?.data?.srcuser),
    ruleLevel: Number.isFinite(alert?.rule?.level) ? alert.rule.level : null,
    description: safeString(alert?.rule?.description),
  }));
}























