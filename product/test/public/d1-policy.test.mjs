import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, product, rng, PROJECT_ID } from './harness.mjs';
import { policyDigest } from '../../vendor/defense-product-contracts/index.mjs';

const OWN_NOTES = { id: 'own-notes', effect: 'allow', match: { zone: 'notes', owner: 'self' } };

async function makeNote(env, who, zone = 'notes') {
  const r = await env.call(who, 'POST', `/resources/${zone}`, { data: { text: `${who} 메모` } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

test('D1-1 정책이 없으면 모든 보호 자원 요청을 거부한다', async () => {
  const env = await setup();
  const p = await env.call('A', 'GET', '/policy');
  assert.equal(p.status, 200);
  assert.equal(p.body.active, null);
  const w = await env.call('A', 'POST', '/resources/notes', { data: {} });
  assert.equal(w.status, 403);
});

test('D1-2 일반 사용자는 정책을 바꿀 수 없고, 잘못된 정책은 반영 전에 거부한다', async () => {
  const env = await setup();
  const snapshot = { schema: 'aleph.product.policy.v1', projectId: PROJECT_ID, revision: 1, rules: [OWN_NOTES] };
  assert.equal((await env.call('A', 'POST', '/policy/drafts', { snapshot })).status, 403);
  const bad = await env.call('OP', 'POST', '/policy/drafts', { snapshot: { ...snapshot, rules: [{ id: 'x', effect: 'permit' }] } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'policy_rules');
  const other = await env.call('OP', 'POST', '/policy/drafts', { snapshot: { ...snapshot, projectId: 'someone-else' } });
  assert.equal(other.status, 422);
  assert.equal(other.body.error.code, 'policy_project');
  assert.equal((await env.call('A', 'GET', '/policy/history')).status, 403);
});

test('D1-3 정책 변경이 실제 판정을 바꾸고, 되돌리기는 새 판 번호로 기록된다', async () => {
  const env = await setup();
  const r1 = await env.activate([OWN_NOTES], 0);
  assert.equal(r1.revision, 1);
  const noteA = await makeNote(env, 'A');
  const own = await env.call('A', 'GET', `/resources/notes/${noteA}`);
  assert.equal(own.status, 200);
  assert.equal(own.headers['x-aleph-decision'], 'allow');
  assert.equal(own.headers['x-aleph-policy-revision'], '1');
  const active = (await env.call('A', 'GET', '/policy')).body.active;
  assert.equal(own.headers['x-aleph-policy-digest'], policyDigest(active));
  assert.equal((await env.call('B', 'GET', `/resources/notes/${noteA}`)).status, 403);

  const r2 = await env.activate([OWN_NOTES, { id: 'shared-read', effect: 'allow', match: { zone: 'notes', method: 'GET', owner: 'any' } }], 1);
  assert.equal(r2.revision, 2);
  const shared = await env.call('B', 'GET', `/resources/notes/${noteA}`);
  assert.equal(shared.status, 200);
  assert.equal(shared.headers['x-aleph-policy-revision'], '2');

  const rb = await env.call('OP', 'POST', '/policy/rollback', { toRevision: 1, expectedRevision: 2 });
  assert.equal(rb.status, 200);
  assert.equal(rb.body.revision, 3);
  assert.equal((await env.call('B', 'GET', `/resources/notes/${noteA}`)).status, 403);
  const hist = (await env.call('OP', 'GET', '/policy/history')).body.items;
  assert.deepEqual(hist.map(h => h.revision), [3, 2, 1]);
  assert.equal(hist[0].source, 'rollback');
});

test('D1-4 판 번호 경합은 409 이고, 동시에 두 번 활성화하면 하나만 성공한다', async () => {
  const env = await setup();
  await env.activate([OWN_NOTES], 0);
  const snap = rev => ({ schema: 'aleph.product.policy.v1', projectId: PROJECT_ID, revision: rev, rules: [OWN_NOTES] });
  const d1 = (await env.call('OP', 'POST', '/policy/drafts', { snapshot: snap(2) })).body.draftId;
  const d2 = (await env.call('OP', 'POST', '/policy/drafts', { snapshot: snap(2) })).body.draftId;
  const stale = await env.call('OP', 'POST', '/policy/activate', { draftId: d1, expectedRevision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'revision_conflict');
  const [x, y] = await Promise.all([
    env.call('OP', 'POST', '/policy/activate', { draftId: d1, expectedRevision: 1 }),
    env.call('OP', 'POST', '/policy/activate', { draftId: d2, expectedRevision: 1 }),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal((await env.call('A', 'GET', '/policy')).body.active.revision, 2);
});

test('D1-5 추가 확인 규칙은 401 step_up_required 로 응답한다', async () => {
  const env = await setup();
  await env.activate([OWN_NOTES, { id: 'hr-stepup', effect: 'step_up', priority: 5, match: { zone: 'hr' } }, { id: 'hr-write', effect: 'allow', match: { zone: 'hr', method: 'POST' } }], 0);
  const w = await env.call('A', 'POST', '/resources/hr', { data: {} });
  assert.equal(w.status, 401);
  assert.equal(w.body.error.code, 'step_up_required');
  assert.equal(w.headers['x-aleph-decision'], 'step_up');
});

test('D1-6 decide: 우선순위와 같은 순위의 엄격함, 기본 거부를 새 값으로 확인', () => {
  const r = rng(20261019);
  const zones = ['notes', 'hr', 'fin', 'ops'];
  const effects = ['allow', 'deny', 'step_up'];
  const strict = { deny: 3, step_up: 2, allow: 1 };
  for (let n = 0; n < 300; n += 1) {
    const rules = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => {
      const match = {};
      if (r() < 0.6) match.zone = r() < 0.15 ? '*' : zones[Math.floor(r() * zones.length)];
      if (r() < 0.4) match.method = r() < 0.5 ? 'GET' : 'POST';
      if (r() < 0.4) match.owner = ['self', 'other', 'any'][Math.floor(r() * 3)];
      if (r() < 0.2) match.role = r() < 0.5 ? 'member' : 'operator';
      const rule = { id: `r${i}`, effect: effects[Math.floor(r() * 3)], match };
      if (r() < 0.5) rule.priority = Math.floor(r() * 3);
      return rule;
    });
    const request = { method: r() < 0.5 ? 'GET' : 'POST', zone: zones[Math.floor(r() * zones.length)], owner: r() < 0.5 ? 'self' : 'other', role: r() < 0.8 ? 'member' : 'operator' };
    const fits = rules.filter(x => {
      const m = x.match;
      return (m.zone === undefined || m.zone === '*' || m.zone === request.zone)
        && (m.method === undefined || m.method === request.method)
        && (m.owner === undefined || m.owner === 'any' || m.owner === request.owner)
        && (m.role === undefined || m.role === request.role);
    });
    const policy = { schema: 'aleph.product.policy.v1', projectId: PROJECT_ID, revision: 1, rules };
    const got = product.decide(request, policy);
    if (!fits.length) { assert.equal(got.decision, 'deny', `case ${n}`); continue; }
    const top = Math.max(...fits.map(x => x.priority ?? 0));
    const want = fits.filter(x => (x.priority ?? 0) === top).sort((a, b) => strict[b.effect] - strict[a.effect])[0].effect;
    assert.equal(got.decision, want, `case ${n} ${JSON.stringify({ request, rules })}`);
    assert.ok(Array.isArray(got.ruleIds) && got.ruleIds.length >= 1, `case ${n} ruleIds`);
  }
  assert.equal(product.decide({ method: 'GET', zone: 'notes', owner: 'self', role: 'member' }, null).decision, 'deny');
});
