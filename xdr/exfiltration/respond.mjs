import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { readAlerts } from './read-alerts.mjs';

const MODULE_KEY = 'exfiltration';
const BLOCK_CONFIDENCE = 0.85;
const RULE_TTL_MS = 15 * 60 * 1000;
const SAFE_ALERT_ID = /^[A-Za-z0-9._:-]{1,64}$/u;

function isDocumentationAddress(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.(\d{1,3})$/u.exec(value);
  return Boolean(match) && Number(match[1]) >= 1 && Number(match[1]) <= 254;
}

function validDecision(value) {
  return value && ['block', 'alert', 'record'].includes(value.action)
    && typeof value.confidence === 'number'
    && Number.isFinite(value.confidence)
    && value.confidence >= 0 && value.confidence <= 1
    && typeof value.reason === 'string';
}

function timestampFrom(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError('invalid_clock');
  return milliseconds;
}

export function mergeDenyRules(existingRules, additions) {
  if (!Array.isArray(existingRules) || !Array.isArray(additions)) {
    throw new TypeError('deny_rules_must_be_arrays');
  }
  const result = [...existingRules];
  const seen = new Set(existingRules.map((rule) => rule?.id).filter((id) => typeof id === 'string'));
  for (const rule of additions) {
    if (rule && typeof rule.id === 'string' && !seen.has(rule.id)) {
      result.push(rule);
      seen.add(rule.id);
    }
  }
  return result;
}

export function buildResponse({ alerts, decisions, existingRules = [], now = Date.now() }) {
  if (!Array.isArray(alerts) || !Array.isArray(decisions)) {
    throw new TypeError('alerts_and_decisions_must_be_arrays');
  }
  const nowMs = timestampFrom(now);
  const decisionById = new Map(decisions
    .filter((item) => item && typeof item.alertId === 'string' && validDecision(item))
    .map((item) => [item.alertId, item]));
  const safeAlerts = readAlerts(alerts);
  const additions = [];
  const logLines = [];
  const counts = { block: 0, alert: 0, record: 0 };

  alerts.forEach((alert, index) => {
    const alertId = typeof alert?.id === 'string' && SAFE_ALERT_ID.test(alert.id) ? alert.id : '';
    const decision = decisionById.get(alertId) ?? {
      action: 'record', confidence: 0, reason: 'invalid_or_missing_decision',
    };
    counts[decision.action] += 1;
    const safe = safeAlerts[index];
    const sourceAddress = isDocumentationAddress(safe.sourceAddress) ? safe.sourceAddress : '[REDACTED]';
    const destinationAddress = alert?.data?.dstip;

    if (decision.action === 'block' && decision.confidence >= BLOCK_CONFIDENCE
        && alertId && isDocumentationAddress(destinationAddress)) {
      additions.push({
        id: `xdr.${MODULE_KEY}.${alertId}`,
        effect: 'deny',
        targetType: 'destination_address',
        targetValue: destinationAddress,
        destinationAddress,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + RULE_TTL_MS).toISOString(),
        evidenceAlertId: alertId,
        reason: decision.reason,
        source: `xdr.${MODULE_KEY}`,
      });
    }

    logLines.push(JSON.stringify({
      timestamp: safe.timestamp,
      source: `xdr.${MODULE_KEY}`,
      alertId: alertId || '[REDACTED]',
      sourceAddress,
      ruleLevel: safe.ruleLevel,
      action: decision.action,
      confidence: decision.confidence,
      reason: decision.reason,
    }));
  });

  return {
    counts,
    logLines,
    additions,
    denyRules: mergeDenyRules(existingRules, additions),
  };
}

async function readExistingRules(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed?.schema !== 'aleph.xdr.deny-rules.v1' || !Array.isArray(parsed.rules)) {
      throw new Error('deny_rules_format_invalid');
    }
    return parsed.rules;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function respond({ root, now = Date.now() }) {
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('root_required');
  const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', `${MODULE_KEY}.json`), 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== MODULE_KEY
      || !Array.isArray(fixture.alerts)) {
    throw new Error('fixture_format_invalid');
  }
  const decisions = [];
  for (const alert of fixture.alerts) decisions.push({ alertId: alert?.id, ...(await decide(alert)) });
  const rulesPath = join(root, 'xdr', 'deny-rules.json');
  const response = buildResponse({ alerts: fixture.alerts, decisions, existingRules: await readExistingRules(rulesPath), now });
  const logPath = join(root, 'xdr', 'alerts.log');
  await mkdir(dirname(logPath), { recursive: true });
  if (response.logLines.length > 0) await appendFile(logPath, `${response.logLines.join('\n')}\n`, 'utf8');
  await writeFile(rulesPath, `${JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', rules: response.denyRules }, null, 2)}\n`, 'utf8');
  return { counts: response.counts, denyRulesAdded: response.additions.length };
}

const isMain = process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    const outcome = await respond({ root });
    process.stdout.write(`block=${outcome.counts.block} alert=${outcome.counts.alert} record=${outcome.counts.record} denyRulesAdded=${outcome.denyRulesAdded}\n`);
  } catch (error) {
    process.stderr.write(`응답 모듈 오류: ${error instanceof Error ? error.message : 'unknown_error'}\n`);
    process.exitCode = 1;
  }
}
