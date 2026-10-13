import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BACKUP_OWNER_ID, createNotesHandlers } from '../src/notes-api.mjs';

const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const liveRows = rows => rows.filter(row => row.owner_id !== BACKUP_OWNER_ID);
const auditActions = async handlers => {
  const audit = makeResponse();
  await handlers.audit({ method: 'GET', headers: { authorization: 'Bearer B' } }, audit);
  return audit.body?.entries?.map(entry => entry.action) ?? [];
};

function makeResponse() {
  return {
    headers: new Map(), statusCode: null, body: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    status(code) {
      this.statusCode = code;
      return { json: payload => { this.body = payload; return payload; } };
    },
  };
}

function createMemorySupabase() {
  const rows = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'vault_notes');
      const query = { mode: 'select', filters: [], values: null, columns: null };
      const matches = row => query.filters.every(([column, value]) => row[column] === value);
      const project = row => row && query.columns
        ? Object.fromEntries(query.columns.split(',').map(column => [column, row[column]]))
        : row ? structuredClone(row) : null;
      const execute = () => {
        if (query.mode === 'insert') {
          if (rows.some(row => row.id === query.values.id)) return { data: null, error: { code: '23505' } };
          const sort_order = Math.max(0, ...rows.map(existing => existing.sort_order ?? 0)) + 1;
          const row = { sort_order, created_at: '2026-10-10T00:00:00.000Z', ...query.values };
          rows.push(row);
          return { data: project(row), error: null };
        }
        const found = rows.filter(matches);
        if (query.mode === 'update') {
          if (found[0]) Object.assign(found[0], query.values);
          return { data: project(found[0]), error: null };
        }
        if (query.mode === 'delete') {
          if (found[0]) rows.splice(rows.indexOf(found[0]), 1);
          return { data: project(found[0]), error: null };
        }
        return { data: found.map(project), error: null };
      };
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order() { return builder; },
        insert(values) { query.mode = 'insert'; query.values = values; return builder; },
        update(values) { query.mode = 'update'; query.values = values; return builder; },
        delete() { query.mode = 'delete'; return builder; },
        single() { return Promise.resolve(execute()); },
        maybeSingle() {
          const result = execute();
          return Promise.resolve(Array.isArray(result.data)
            ? { ...result, data: result.data[0] ?? null }
            : result);
        },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return builder;
    },
  };
  return { supabase, rows };
}

const verifyLogin = async authorization => ({
  'Bearer A': { kind: 'student', userId: ownerA },
  'Bearer B': { kind: 'student', userId: ownerB },
  'Bearer judgeB': { kind: 'judge', userId: ownerB, runId: randomUUID(), identity: 'b' },
})[authorization] ?? null;

test('restore keeps the first verified backup and changes only the selected note', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase, verifyLogin });
  const noteId = randomUUID();
  const otherId = randomUUID();

  const created = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, title: 'Original B note', body: 'original private content' } }, created);
  assert.equal(created.statusCode, 201);

  const other = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer A' },
    body: { id: otherId, title: 'Unrelated A note', body: 'leave this unchanged' } }, other);
  assert.equal(other.statusCode, 201);

  const changed = makeResponse();
  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id: noteId },
    body: { title: 'Tampered B note', body: 'attacker changed content' } }, changed);
  assert.equal(changed.statusCode, 200);

  // A later read must not replace the pre-tamper copy with modified content.
  const readTampered = makeResponse();
  await handlers.item({ method: 'GET', headers: { authorization: 'Bearer B' }, query: { id: noteId } }, readTampered);
  assert.equal(readTampered.statusCode, 200);
  assert.equal(readTampered.body.body, 'attacker changed content');

  const restored = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: noteId } }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.id, noteId);
  assert.equal(restored.body.title, 'Original B note');
  assert.equal(restored.body.body, 'original private content');
  assert.equal(restored.body.restored, true);
  assert.equal(restored.body.restore.verifiedBackup, true);
  assert.deepEqual(restored.body.restore.changedFields.sort(), ['content', 'title']);
  assert.ok(Array.isArray(restored.body.restore.retests) && restored.body.restore.retests.length >= 4);
  assert.ok(restored.body.restore.retests.every(entry => entry.ran === true));

  const recovered = rows.find(row => row.id === noteId);
  const untouched = rows.find(row => row.id === otherId);
  assert.equal(recovered.owner_id, ownerB);
  assert.equal(sha256(recovered.content), sha256('original private content'));
  assert.equal(untouched.id, otherId);
  assert.equal(untouched.owner_id, ownerA);
  assert.equal(untouched.title, 'Unrelated A note');
  assert.equal(untouched.content, 'leave this unchanged');
  assert.equal(liveRows(rows).length, 2);
});

test('backup survives a fresh handler instance (serverless cold start)', async () => {
  const { supabase, rows } = createMemorySupabase();
  const first = createNotesHandlers({ supabase, verifyLogin });
  const noteId = randomUUID();

  const created = makeResponse();
  await first.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, title: 'Durable note', body: 'content before invasion' } }, created);
  assert.equal(created.statusCode, 201);

  // New handler set = empty in-memory cache, same durable store.
  const cold = createNotesHandlers({ supabase, verifyLogin });
  const tampered = makeResponse();
  await cold.item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id: noteId },
    body: { title: 'Tampered', body: 'tampered body' } }, tampered);
  assert.equal(tampered.statusCode, 200);

  const restored = makeResponse();
  await cold.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: noteId } }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.body, 'content before invasion');
});

test('restore fails closed when no private backup exists', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase,
    verifyLogin: async authorization => authorization === 'Bearer B' ? { kind: 'student', userId: ownerB } : null });
  const response = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: randomUUID() } }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'BACKUP_NOT_FOUND' });
  assert.equal(liveRows(rows).length, 0);
});

test('restore refuses a tampered backup copy', async () => {
  const { supabase, rows } = createMemorySupabase();
  const backupMap = new Map();
  const handlers = createNotesHandlers({ supabase, verifyLogin, backupMap });
  const noteId = randomUUID();

  const created = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, title: 'Safe note', body: 'safe content' } }, created);
  assert.equal(created.statusCode, 201);

  const record = backupMap.get(noteId);
  assert.ok(record, 'backup record must be persisted');
  record.content = 'attacker wrote a fake backup';

  const live = rows.find(row => row.id === noteId);
  live.content = 'tampered live note';

  const response = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: noteId } }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'BACKUP_VERIFICATION_FAILED' });
  assert.equal(live.content, 'tampered live note');
});

test('restore recreates a deleted note and appends audit entries', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase, verifyLogin });
  const noteId = randomUUID();

  const created = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, title: 'Delete me', body: 'will be deleted then restored' } }, created);
  assert.equal(created.statusCode, 201);

  const deleted = makeResponse();
  await handlers.item({ method: 'DELETE', headers: { authorization: 'Bearer B' }, query: { id: noteId } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(rows.find(row => row.id === noteId), undefined);

  const restored = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: noteId } }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.body, 'will be deleted then restored');
  assert.equal(restored.body.restore.changedFields.includes('missing_note'), true);

  const actions = await auditActions(handlers);
  assert.ok(actions.includes('note.create'));
  assert.ok(actions.includes('note.delete'));
  assert.ok(actions.includes('note.restore'));

  const audit = makeResponse();
  await handlers.audit({ method: 'GET', headers: { authorization: 'Bearer B' } }, audit);
  assert.equal(audit.statusCode, 200);
  assert.ok(audit.body.count >= 3);
});

test('restore preview reports version and changed fields without writing', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase, verifyLogin });
  const noteId = randomUUID();

  const created = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, title: 'Before', body: 'before content' } }, created);
  assert.equal(created.statusCode, 201);

  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id: noteId },
    body: { title: 'After', body: 'tampered' } }, makeResponse());

  const preview = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, dryRun: true } }, preview);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.preview, true);
  assert.deepEqual(preview.body.restore.changedFields.sort(), ['content', 'title']);
  assert.equal(rows.find(row => row.id === noteId).content, 'tampered');
});

test('judge-supplied verified snapshot restores when no stored backup exists', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase, verifyLogin });
  const noteId = randomUUID();

  rows.push({ id: noteId, owner_id: ownerB, title: 'B note', content: 'tampered by attacker',
    sort_order: 1, created_at: '2026-10-10T00:00:00.000Z' });

  const restored = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer judgeB' },
    body: { id: noteId, title: 'B note', content: 'safe original content',
      contentHash: sha256('safe original content') } }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.body, 'safe original content');
  assert.equal(restored.body.restore.backupSource, 'request');
});

test('judge-supplied snapshot with a bad fingerprint is refused', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase, verifyLogin });
  const noteId = randomUUID();

  rows.push({ id: noteId, owner_id: ownerB, title: 'B note', content: 'live content',
    sort_order: 1, created_at: '2026-10-10T00:00:00.000Z' });

  const restored = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer judgeB' },
    body: { id: noteId, title: 'B note', content: 'forged content',
      contentHash: sha256('different content') } }, restored);
  assert.equal(restored.statusCode, 409);
  assert.equal(restored.body.error, 'BACKUP_VERIFICATION_FAILED');
  assert.equal(rows.find(row => row.id === noteId).content, 'live content');
});

test('restore without an id restores the single drifted note', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase, verifyLogin });
  const noteId = randomUUID();
  const intactId = randomUUID();

  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, title: 'Drifted', body: 'original' } }, makeResponse());
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: intactId, title: 'Intact', body: 'same' } }, makeResponse());
  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id: noteId },
    body: { title: 'Drifted', body: 'changed by attacker' } }, makeResponse());

  const restored = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: {} }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.id, noteId);
  assert.equal(restored.body.body, 'original');
});
