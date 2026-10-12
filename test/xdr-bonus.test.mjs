import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = [
  { key: 'known-cve', blockEnd: 8, alertEnd: 16, total: 24, targetType: 'source_address', targetField: 'sourceAddress' },
  { key: 'persistence', blockEnd: 8, alertEnd: 16, total: 24, targetType: 'agent_access', targetField: 'agentName' },
  { key: 'privilege', blockEnd: 9, alertEnd: 17, total: 26, targetType: 'account_session', targetField: 'account' },
  { key: 'exfiltration', blockEnd: 10, alertEnd: 20, total: 30, targetType: 'destination_address', targetField: 'destinationAddress' },
];
const FIXED_NOW = Date.parse('2026-10-13T00:00:00.000Z');

for (const spec of MODULES) {
  test(`${spec.key}: fixtures, isolated decisions, and expiring evidence-backed responses`, async () => {
    const fixture = JSON.parse(await readFile(join(ROOT, 'xdr', 'fixtures', `${spec.key}.json`), 'utf8'));
    assert.equal(fixture.schema, 'aleph.xdr.fixture.v1');
    assert.equal(fixture.moduleKey, spec.key);
    assert.equal(fixture.alerts.length, spec.total);
    const patternDocument = JSON.parse(await readFile(join(ROOT, 'xdr', spec.key, 'patterns.json'), 'utf8'));
    assert.equal(patternDocument.schema, 'aleph.xdr.patterns.v1');
    assert.equal(patternDocument.moduleKey, spec.key);
    assert.ok(patternDocument.patterns.length > 0);
    for (const pattern of patternDocument.patterns) {
      assert.equal(typeof pattern.id, 'string');
      assert.equal(typeof pattern.name, 'string');
      assert.equal(typeof pattern.condition, 'string');
      assert.equal(typeof pattern.rationale, 'string');
    }

    const moduleUrl = pathToFileURL(join(ROOT, 'xdr', spec.key, 'decide.mjs')).href;
    const source = await readFile(join(ROOT, 'xdr', spec.key, 'decide.mjs'), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m, 'judge decision module must not import files or packages');
    assert.doesNotMatch(source, /\bfetch\s*\(|node:(?:fs|http|https|net|dns)/u);
    const { decide } = await import(moduleUrl);
    const decisions = fixture.alerts.map((alert) => decide(alert));
    const counts = { block: 0, alert: 0, record: 0 };

    decisions.forEach((decision, index) => {
      assert.ok(['block', 'alert', 'record'].includes(decision.action));
      assert.ok(Number.isFinite(decision.confidence) && decision.confidence >= 0 && decision.confidence <= 1);
      assert.equal(typeof decision.reason, 'string');
      if (decision.action === 'block') assert.ok(decision.confidence >= 0.85);
      if (decision.action === 'alert') assert.ok(decision.confidence >= 0.5 && decision.confidence < 0.85);
      if (decision.action === 'record') assert.ok(decision.confidence < 0.5);
      counts[decision.action] += 1;

      const number = Number(fixture.alerts[index].id.split('-').at(-1));
      const expected = number <= spec.blockEnd ? 'block' : number <= spec.alertEnd ? 'alert' : 'record';
      assert.equal(decision.action, expected, fixture.alerts[index].id);
    });
    assert.deepEqual(counts, {
      block: spec.blockEnd,
      alert: spec.alertEnd - spec.blockEnd,
      record: spec.total - spec.alertEnd,
    });

    const readAlertsModule = await import(pathToFileURL(join(ROOT, 'xdr', spec.key, 'read-alerts.mjs')).href);
    const summary = readAlertsModule.readAlerts(fixture.alerts);
    assert.equal(summary.length, fixture.alerts.length);
    assert.deepEqual(Object.keys(summary[0]), ['timestamp', 'sourceAddress', 'account', 'ruleLevel', 'description']);

    const secretSample = readAlertsModule.readAlerts([{
      timestamp: '2026-10-13T00:00:00.000Z',
      rule: { level: 3, description: 'token=synthetic-token-001' },
      data: { srcip: '192.0.2.1', srcuser: 'user01' },
    }]);
    assert.equal(secretSample.length, 1);
    assert.equal(secretSample[0].description.includes('synthetic-token-001'), false);
    assert.equal(secretSample[0].description.includes('[REDACTED]'), true);

    const respondModule = await import(pathToFileURL(join(ROOT, 'xdr', spec.key, 'respond.mjs')).href);
    const response = respondModule.buildResponse({
      alerts: fixture.alerts,
      decisions: fixture.alerts.map((alert, index) => ({ alertId: alert.id, ...decisions[index] })),
      existingRules: [{ id: 'preserve-existing-rule', effect: 'deny' }],
      now: FIXED_NOW,
    });
    assert.deepEqual(response.counts, counts);
    assert.equal(response.logLines.length, fixture.alerts.length);
    assert.equal(response.denyRules[0].id, 'preserve-existing-rule');
    assert.equal(response.additions.length, counts.block);
    for (const rule of response.additions) {
      assert.equal(rule.effect, 'deny');
      assert.equal(rule.targetType, spec.targetType);
      assert.equal(typeof rule[spec.targetField], 'string');
      assert.ok(rule[spec.targetField].length > 0);
      assert.ok(Date.parse(rule.expiresAt) > Date.parse(rule.createdAt));
      assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.createdAt), 15 * 60 * 1000);
      assert.ok(fixture.alerts.some((alert) => alert.id === rule.evidenceAlertId));
      assert.ok(Date.parse(rule.createdAt) >= FIXED_NOW);
    }
  });
}
