import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandlers, routeResource } from '../src/notes-api.mjs';
import { RESOURCE_IDS } from '../src/resource-ids.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeResponse() {
  return {
    headers: new Map(),
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    status(code) {
      this.statusCode = code;
      return { json: payload => { this.body = payload; return payload; } };
    },
  };
}

function handlersFor(verifyLogin) {
  return createNotesHandlers({ supabase: { from() { throw new Error('unused'); } }, verifyLogin });
}

test('a student cannot change an instructor announcement even with a forged body role', async () => {
  const handlers = handlersFor(async authorization => authorization === 'Bearer student'
    ? { kind: 'student', userId } : null);
  for (const method of ['PUT', 'DELETE']) {
    const response = makeResponse();
    await handlers.announcement({ method, headers: { authorization: 'Bearer student' },
      query: { id: itemId }, body: { role: 'teacher', userId, title: 'forged' } }, response);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: 'TEACHER_PERMISSION_REQUIRED' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('unverified announcement requests and malformed IDs fail closed', async () => {
  const handlers = handlersFor(async authorization => authorization === 'Bearer student'
    ? { kind: 'student', userId } : null);
  const anonymous = makeResponse();
  await handlers.announcement({ method: 'PUT', headers: {}, query: { id: itemId } }, anonymous);
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.body, { error: 'UNAUTHORIZED' });

  const malformed = makeResponse();
  await handlers.announcement({ method: 'PUT', headers: { authorization: 'Bearer student' },
    query: { id: 'export' } }, malformed);
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.body, { error: 'INVALID_ID' });
});

test('the API router rejects a path that cannot be mapped to the declared resource ID', async () => {
  const response = makeResponse();
  await routeResource(RESOURCE_IDS.notes, 'item', { method: 'GET', url: '/api/notes/export' }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'RESOURCE_NOT_FOUND' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});


test('item URLs, not query parameters or handler names, select the API resource', async () => {
  const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const conflict = makeResponse();
  await routeResource(RESOURCE_IDS.notes, 'item', {
    method: 'GET', url: `/api/notes/${itemId}?id=${otherId}`, query: { id: otherId },
  }, conflict);
  assert.equal(conflict.statusCode, 400);
  assert.deepEqual(conflict.body, { error: 'INVALID_ID' });

  const wrongHandler = makeResponse();
  await routeResource(RESOURCE_IDS.notes, 'collection', {
    method: 'GET', url: `/api/notes/${itemId}`, query: { id: itemId },
  }, wrongHandler);
  assert.equal(wrongHandler.statusCode, 404);
  assert.deepEqual(wrongHandler.body, { error: 'RESOURCE_NOT_FOUND' });
});
