import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PROJECT_ID } from './harness.mjs';
import { verifyBackup } from '../../vendor/defense-product-contracts/index.mjs';

const RULES_A = [{ id: 'own-notes', effect: 'allow', match: { zone: 'notes', owner: 'self' } }];
const RULES_B = [{ id: 'everyone', effect: 'allow', match: { zone: 'notes', owner: 'any' } }];
const EVENTS = [
  { id: 'r-1', at: '2026-10-22T01:00:00.000Z', kind: 'read', subject: 'u-1' },
  { id: 'r-2', at: '2026-10-22T01:01:00.000Z', kind: 'login', subject: 'u-2' },
];

async function prepared() {
  const env = await setup();
  await env.activate(RULES_A, 0);
  await env.call('OP', 'POST', '/events', { events: EVENTS });
  const backup = (await env.call('OP', 'POST', '/backups', {})).body;
  return { env, backup };
}

const state = async env => ({
  policy: (await env.call('OP', 'GET', '/policy')).body.active,
  events: (await env.call('OP', 'GET', '/events?limit=1000')).body.items,
  audit: (await env.store.list('audit')).length,
});

test('D4-1 만든 백업은 공개 계약 검증을 통과하고 감사·인증값을 담지 않는다', async () => {
  const { backup } = await prepared();
  const v = verifyBackup(backup, { projectId: PROJECT_ID });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(v.items['policy.json'].rules, RULES_A);
  assert.deepEqual(v.items['selected-events.json'].map(e => e.id).sort(), ['r-1', 'r-2']);
});

test('D4-2 나쁜 정책 업데이트 뒤 복원하면 예전 규칙이 새 판 번호로 돌아오고 감사 기록은 줄지 않는다', async () => {
  const { env, backup } = await prepared();
  await env.activate(RULES_B, 1);
  const noteA = (await env.call('A', 'POST', '/resources/notes', { data: {} })).body.id;
  assert.equal((await env.call('B', 'GET', `/resources/notes/${noteA}`)).status, 200);
  const before = await state(env);
  const r = await env.call('OP', 'POST', '/restore', { backup });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.revision, 3);
  const after = await state(env);
  assert.deepEqual(after.policy.rules, RULES_A);
  assert.equal(after.policy.revision, 3);
  assert.ok(after.audit >= before.audit + 1, '복원도 감사 기록에 남아야 합니다');
  assert.equal((await env.call('B', 'GET', `/resources/notes/${noteA}`)).status, 403);
  assert.equal((await env.call('A', 'GET', `/resources/notes/${noteA}`)).status, 200);
  const hist = (await env.call('OP', 'GET', '/policy/history')).body.items;
  assert.equal(hist[0].source, 'restore');
});

test('D4-3 손상·다른 프로젝트·금지 내용 백업은 422 이고 아무것도 바뀌지 않는다', async () => {
  const { env, backup } = await prepared();
  const before = await state(env);
  const tampered = structuredClone(backup);
  tampered.payload['policy.json'] = tampered.payload['policy.json'].replace('own-notes', 'own-notez');
  const other = structuredClone(backup);
  other.manifest.projectId = 'someone-else';
  for (const [bad, code] of [[tampered, 'backup_hash_mismatch'], [other, 'backup_project'], [{ format: 'zip' }, 'backup_format']]) {
    const r = await env.call('OP', 'POST', '/restore', { backup: bad });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, code);
  }
  assert.deepEqual(await state(env), before);
});

test('D4-4 같은 id 의 사건이 다른 내용으로 있으면 422 restore_conflict 이고 정책도 그대로다', async () => {
  const { env, backup } = await prepared();
  const fresh = await setup();
  await fresh.activate(RULES_B, 0);
  await fresh.call('OP', 'POST', '/events', { events: [{ ...EVENTS[0], kind: 'write' }] });
  const before = await state(fresh);
  const r = await fresh.call('OP', 'POST', '/restore', { backup });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'restore_conflict');
  assert.deepEqual(await state(fresh), before);
  assert.equal((await env.call('A', 'POST', '/restore', { backup })).status, 403);
});
