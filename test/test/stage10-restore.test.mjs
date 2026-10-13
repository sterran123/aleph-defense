import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createNotesHandlers } from '../src/notes-api.mjs';

const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

test('restore keeps the first verified backup and changes only the selected note', async () => {
  const { supabase, rows } = createMemorySupabase();
  const verifyLogin = async authorization => ({
    'Bearer A': { kind: 'student', userId: ownerA },
    'Bearer B': { kind: 'student', userId: ownerB },
  })[authorization] ?? null;
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
  assert.deepEqual(restored.body, { id: noteId, title: 'Original B note', body: 'original private content' });

  const recovered = rows.find(row => row.id === noteId);
  const untouched = rows.find(row => row.id === otherId);
  assert.equal(recovered.owner_id, ownerB);
  assert.equal(createHash('sha256').update(recovered.content).digest('hex'),
    createHash('sha256').update('original private content').digest('hex'));
  assert.deepEqual(untouched, {
    id: otherId, owner_id: ownerA, title: 'Unrelated A note', content: 'leave this unchanged',
    created_at: '2026-10-10T00:00:00.000Z', sort_order: 2,
  });
  assert.equal(rows.length, 2);
});

test('restore fails closed when no private backup exists', async () => {
  const { supabase, rows } = createMemorySupabase();
  const handlers = createNotesHandlers({ supabase,
    verifyLogin: async authorization => authorization === 'Bearer B' ? { kind: 'student', userId: ownerB } : null });
  const response = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: randomUUID() } }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'BACKUP_NOT_FOUND' });
  assert.equal(rows.length, 0);
});
