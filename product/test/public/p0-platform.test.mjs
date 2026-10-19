import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.mjs';

test('P-1 시험 실행 공간은 실제 자료와 섞이지 않고, 정리하면 그 실행 자료만 지워지며 감사 기록은 남는다', async () => {
  const env = await setup();
  await env.rootStore.put('resources', 'notes/real-1', { owner: 'someone', data: '실제 자료' });
  await env.activate([{ id: 'open', effect: 'allow', match: { zone: 'notes' } }], 0);
  const id = (await env.call('A', 'POST', '/resources/notes', { data: {} })).body.id;
  assert.ok(await env.store.get('resources', `notes/${id}`) || (await env.store.list('resources')).length > 0, '시험 자료는 실행 공간에 저장돼야 합니다');
  assert.equal(await env.rootStore.get('resources', `notes/${id}`), null);
  const auditBefore = (await env.store.list('audit')).length;
  assert.equal((await env.call('A', 'POST', '/test/reset')).status, 403);
  const r = await env.call('OP', 'POST', '/test/reset');
  assert.equal(r.status, 200);
  assert.equal((await env.store.list('resources')).length, 0);
  assert.equal((await env.store.list('audit')).length, auditBefore);
  assert.deepEqual(await env.rootStore.get('resources', 'notes/real-1'), { owner: 'someone', data: '실제 자료' });
});

test('P-2 /me 는 로그인한 본인의 userId 와 역할만 돌려준다', async () => {
  const env = await setup();
  const a = await env.call('A', 'GET', '/me');
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, { userId: env.users.A.userId, role: 'member' });
  assert.equal((await env.call('OP', 'GET', '/me')).body.role, 'operator');
  assert.equal((await env.handle({ method: 'GET', path: '/api/product/v1/me' })).status, 401);
});
