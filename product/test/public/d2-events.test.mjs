import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, rng } from './harness.mjs';
import { makeEvents, shuffle } from '../../tools/event-generator.mjs';

test('D2-1 같은 사건은 중복, 같은 id 의 다른 내용은 충돌, 형식 오류 묶음은 통째로 거부', async () => {
  const env = await setup();
  const ev = { id: 'e-1', at: '2026-10-20T00:00:01.000Z', kind: 'read', subject: 'u-1' };
  assert.equal((await env.call('A', 'POST', '/events', { events: [ev] })).status, 403);
  const first = await env.call('OP', 'POST', '/events', { events: [ev] });
  assert.equal(first.status, 200);
  assert.equal(first.body.accepted, 1);
  const again = await env.call('OP', 'POST', '/events', { events: [{ ...ev }, { ...ev, kind: 'write' }] });
  assert.equal(again.body.accepted, 0);
  assert.equal(again.body.duplicates, 1);
  assert.deepEqual(again.body.conflicts, ['e-1']);
  const bad = await env.call('OP', 'POST', '/events', { events: [{ id: 'e-2', at: '2026-10-20T00:00:02.000Z', kind: 'read', subject: 'u-1' }, { id: 'e-3', at: 'not-a-time', kind: 'read', subject: 'u-1' }] });
  assert.equal(bad.status, 400);
  const all = await env.call('OP', 'GET', '/events');
  assert.deepEqual(all.body.items.map(e => e.id), ['e-1']);
  assert.equal(all.body.items[0].kind, 'read');
});

test('D2-2 받은 순서와 관계없이 사건 시각 순으로 조회하고, 나눠 읽어도 빠짐·겹침이 없다', async () => {
  const env = await setup();
  const r = rng(7031);
  const events = makeEvents({ seed: 7031, count: 230, subjects: ['u-1', 'u-2', 'u-3'], kinds: ['read', 'write', 'login'] });
  for (const chunk of [events.slice(0, 90), events.slice(90)]) {
    const res = await env.call('OP', 'POST', '/events', { events: shuffle(chunk, r) });
    assert.equal(res.status, 200);
  }
  const expected = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1)).map(e => e.id);
  const seen = [];
  let cursor;
  for (let guard = 0; guard < 50; guard += 1) {
    const q = new URLSearchParams({ limit: '37', ...(cursor ? { cursor } : {}) });
    const page = await env.call('OP', 'GET', `/events?${q}`);
    seen.push(...page.body.items.map(e => e.id));
    cursor = page.body.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, expected);
  const onlyU2 = await env.call('OP', 'GET', '/events?subject=u-2&kind=read&limit=1000');
  assert.ok(onlyU2.body.items.length > 0);
  assert.ok(onlyU2.body.items.every(e => e.subject === 'u-2' && e.kind === 'read'));
});

async function burst(env, subject, count, startIso, stepMs, idPrefix) {
  const t0 = Date.parse(startIso);
  const events = Array.from({ length: count }, (_, i) => ({ id: `${idPrefix}-${i}`, at: new Date(t0 + i * stepMs).toISOString(), kind: 'read', subject }));
  const res = await env.call('OP', 'POST', '/events', { events });
  assert.equal(res.status, 200);
}

test('D2-3 burst_read: 10분 안 120건은 관찰, 121건이면 incident 하나', async () => {
  const env = await setup();
  await burst(env, 'u-quiet', 120, '2026-10-20T01:00:00.000Z', 4000, 'q');
  assert.equal((await env.call('OP', 'GET', '/incidents')).body.items.length, 0);
  await burst(env, 'u-loud', 121, '2026-10-20T01:00:00.000Z', 4000, 'l');
  const inc = (await env.call('OP', 'GET', '/incidents')).body.items;
  assert.equal(inc.length, 1);
  assert.equal(inc[0].subject, 'u-loud');
  assert.equal(inc[0].rule, 'burst_read');
  const one = await env.call('OP', 'GET', `/incidents/${encodeURIComponent(inc[0].id)}`);
  assert.equal(one.status, 200);
  assert.ok(one.body.eventIds.length >= 121);
  assert.equal((await env.call('OP', 'GET', '/incidents/none')).status, 404);
});

test('D2-4 다른 사용자를 합치지 않고, 10분 밖 사건을 같은 구간으로 세지 않으며, 다시 넣어도 incident 가 늘지 않는다', async () => {
  const env = await setup();
  await burst(env, 'u-a', 70, '2026-10-20T02:00:00.000Z', 1000, 'a');
  await burst(env, 'u-b', 70, '2026-10-20T02:00:00.000Z', 1000, 'b');
  await burst(env, 'u-c', 121, '2026-10-20T02:00:00.000Z', 5000, 'c'); // 121건이 600초를 넘게 퍼짐
  assert.equal((await env.call('OP', 'GET', '/incidents')).body.items.length, 0);
  await burst(env, 'u-d', 130, '2026-10-20T03:00:00.000Z', 1000, 'd');
  await burst(env, 'u-d', 130, '2026-10-20T03:00:00.000Z', 1000, 'd');
  await burst(env, 'u-d', 10, '2026-10-20T03:03:00.000Z', 1000, 'd2');
  assert.equal((await env.call('OP', 'GET', '/incidents')).body.items.length, 1);
});
