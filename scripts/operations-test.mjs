import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOperationsHandler } from '../src/operations-api.mjs';
import { RULE_IDS } from '../src/decider.mjs';

const response = () => ({ statusCode: 0, body: null, headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; } });

const requests = [];
const handler = createOperationsHandler({ config: { publicAppUrl: 'https://student.example' },
  now: () => new Date('2026-10-13T00:00:00.000Z'),
  verifierFactory: () => async () => ({ userId: 'student-fixture' }),
  fetchImpl: async (url, options) => {
    requests.push({ url, method: options.method, requestId: options.headers['X-Request-Id'] });
    if (url.endsWith('/data.json')) return { status: 200, json: async () => ({ notes: [] }) };
    return { status: 401, json: async () => ({ error: 'redacted' }) };
  } });
const res = response();
await handler({ method: 'GET', query: {}, headers: { 'x-request-id': '11111111-1111-4111-8111-111111111111' } }, res);
assert.equal(res.statusCode, 200);
assert.equal(res.body.checks.length, 41);
assert.deepEqual(res.body.policy.ruleIds, [...RULE_IDS]);
assert.deepEqual(res.body.checkCounts, { total: 41, measured: 7, matched: 4, notRun: 34 });
assert.equal(res.body.checks.filter(item => item.status === 'not_run').length, 34);
assert.equal(requests.length, 7);
assert.equal(requests.filter(item => item.method !== 'GET').length, 1);
assert.equal(requests.every(item => /^https:\/\/student\.example\//u.test(item.url)), true);
assert.equal(new Set(requests.map(item => item.requestId)).size, 7);
const serialized = JSON.stringify(res.body);
assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._~+/-]{16,}|sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
const mismatch = response();
const unsafeHandler = createOperationsHandler({ config: { publicAppUrl: 'https://student.example' },
  verifierFactory: () => async () => ({ userId: 'student-fixture' }),
  fetchImpl: async (url) => url.endsWith('/data.json')
    ? ({ status: 200, json: async () => ({ notes: [{ id: 'unexpected' }] }) })
    : ({ status: 200, json: async () => ({}) }) });
await unsafeHandler({ method: 'GET', query: {}, headers: {} }, mismatch);
assert.equal(mismatch.body.checkCounts.matched, 2);
assert.equal(mismatch.body.checks.find(item => item.checkId === 's02_anonymous_notes').actual.startsWith('HTTP 200'), true);
assert.equal(mismatch.body.checks.find(item => item.checkId === 's01_no_static_notes').status, 'measured');
const [html, app, worker] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8'),
]);
assert.match(html, /id="operations"[^>]*hidden/u);
assert.match(html, /id="operations-status"/u);
assert.match(app, /fetch\('\/api\/operations'/u);
assert.match(app, /\$\('operations'\)\.hidden = !session/u);
assert.match(app, /\$\('refresh-operations'\)\.disabled = !deviceApproved/u);
assert.match(app, /counts\.measured \+ counts\.notRun !== counts\.total/u);
assert.match(worker, /pathname\.startsWith\('\/api\/'\)/u);
console.log('통과 · 작전실 서버 요약과 41종 실행·미실행 수치 일치');
console.log('통과 · 정상 허용과 익명 거부의 요청 ID·확인 시각 기록');
console.log('통과 · 메모 본문·토큰·비밀번호를 응답에 포함하지 않음');

