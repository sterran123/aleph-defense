import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './harness.mjs';

const OPEN_NOTES = [{ id: 'own-notes', effect: 'allow', match: { zone: 'notes' } }];

async function withIncident(faults = []) {
  const env = await setup({ faults });
  await env.activate(OPEN_NOTES, 0);
  const t0 = Date.parse('2026-10-20T05:00:00.000Z');
  const events = Array.from({ length: 125 }, (_, i) => ({ id: `x-${i}`, at: new Date(t0 + i * 1000).toISOString(), kind: 'read', subject: env.users.B.userId }));
  await env.call('OP', 'POST', '/events', { events });
  const [incident] = (await env.call('OP', 'GET', '/incidents')).body.items;
  assert.ok(incident, 'burst_read incident 가 있어야 대응 시험을 할 수 있습니다(D2 먼저)');
  const noteA = (await env.call('A', 'POST', '/resources/notes', { data: {} })).body.id;
  const noteB = (await env.call('B', 'POST', '/resources/notes', { data: {} })).body.id;
  const order = (key = randomUUID()) => ({ operationKey: key, incidentId: incident.id, target: `subject:${env.users.B.userId}`, action: 'block_subject', payload: { reason: 'burst_read' } });
  return { env, incident, noteA, noteB, order };
}

const applies = env => env.baseExecutor.log.filter(x => x.kind === 'apply').length;

test('D3-1 새 작업 201, 같은 키·같은 내용 200, 같은 키·다른 내용 409, 형식 오류 400, 일반 사용자 403', async () => {
  const { env, order } = await withIncident();
  const o = order();
  assert.equal((await env.call('A', 'POST', '/responses', o)).status, 403);
  const first = await env.call('OP', 'POST', '/responses', o);
  assert.equal(first.status, 201);
  assert.equal(first.body.state, 'pending');
  assert.equal(first.body.approval, 'waiting');
  const again = await env.call('OP', 'POST', '/responses', { ...o });
  assert.equal(again.status, 200);
  assert.equal(again.body.operationKey, o.operationKey);
  const other = await env.call('OP', 'POST', '/responses', { ...o, target: `subject:${env.users.A.userId}` });
  assert.equal(other.status, 409);
  assert.equal(other.body.error.code, 'operation_conflict');
  assert.equal((await env.call('OP', 'POST', '/responses', { ...o, operationKey: 'not-a-key' })).status, 400);
  assert.equal((await env.call('OP', 'POST', '/responses', { ...order(), incidentId: 'nope' })).status, 404);
});

test('D3-2 승인 전에는 집행하지 않고, 승인 뒤 대상만 막히며, 해제하면 돌아온다', async () => {
  const { env, noteA, noteB, order } = await withIncident();
  const o = order();
  await env.call('OP', 'POST', '/responses', o);
  assert.equal((await env.call('B', 'GET', `/resources/notes/${noteB}`)).status, 200);
  assert.equal(applies(env), 0);
  const ok = await env.call('OP', 'POST', `/responses/${o.operationKey}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.state, 'succeeded');
  const blocked = await env.call('B', 'GET', `/resources/notes/${noteB}`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'blocked');
  assert.equal((await env.call('A', 'GET', `/resources/notes/${noteA}`)).status, 200);
  const rel = await env.call('OP', 'POST', `/responses/${o.operationKey}/release`);
  assert.equal(rel.status, 200);
  assert.equal(rel.body.state, 'released');
  assert.equal((await env.call('B', 'GET', `/resources/notes/${noteB}`)).status, 200);
  assert.equal((await env.call('OP', 'POST', `/responses/${o.operationKey}/reject`)).status, 409);
});

test('D3-3 503 두 번 뒤 성공: 1초·2초 기다리고 집행은 한 번', async () => {
  const { env, order } = await withIncident(['busy', 'busy']);
  const o = order();
  await env.call('OP', 'POST', '/responses', o);
  const r = await env.call('OP', 'POST', `/responses/${o.operationKey}/approve`);
  assert.equal(r.body.state, 'succeeded');
  assert.equal(r.body.attempts, 3);
  assert.deepEqual(env.slept, [1000, 2000]);
  assert.equal(applies(env), 1);
});

test('D3-4 집행 뒤 응답만 사라지면 다시 집행하지 않고 상태를 확인해 성공으로 끝낸다', async () => {
  const { env, order } = await withIncident(['lost']);
  const o = order();
  await env.call('OP', 'POST', '/responses', o);
  const r = await env.call('OP', 'POST', `/responses/${o.operationKey}/approve`);
  assert.equal(r.body.state, 'succeeded');
  assert.equal(applies(env), 1);
});

test('D3-5 계속 바쁘면 보류(pending)로 남기고 완료로 표시하지 않는다, 403 은 다시 시도하지 않는다', async () => {
  const held = await withIncident(['busy', 'busy', 'busy']);
  const o = held.order();
  await held.env.call('OP', 'POST', '/responses', o);
  const r = await held.env.call('OP', 'POST', `/responses/${o.operationKey}/approve`);
  assert.equal(r.body.state, 'pending');
  assert.equal(applies(held.env), 0);
  assert.equal((await held.env.call('B', 'GET', `/resources/notes/${held.noteB}`)).status, 200);

  const denied = await withIncident(['denied']);
  const d = denied.order();
  await denied.env.call('OP', 'POST', '/responses', d);
  const f = await denied.env.call('OP', 'POST', `/responses/${d.operationKey}/approve`);
  assert.equal(f.body.state, 'failed');
  assert.equal(f.body.attempts, 1);
  assert.deepEqual(denied.env.slept, []);
});

test('D3-6 승인을 동시에 두 번 눌러도 집행은 한 번', async () => {
  const { env, order } = await withIncident();
  const o = order();
  await env.call('OP', 'POST', '/responses', o);
  const [a, b] = await Promise.all([
    env.call('OP', 'POST', `/responses/${o.operationKey}/approve`),
    env.call('OP', 'POST', `/responses/${o.operationKey}/approve`),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(applies(env), 1);
  assert.equal((await env.call('OP', 'GET', `/responses/${o.operationKey}`)).body.state, 'succeeded');
});
