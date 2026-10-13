import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createNotesHandlers } from '../src/notes-api.mjs';
import { diffPolicy, restorePolicy, VERIFIED_POLICY_BACKUP, VERIFIED_POLICY_RULES } from '../src/policy-backup.mjs';

const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha256 = value => createHash('sha256').update(value).digest('hex');

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
  const tables = { vault_notes: [], vault_note_backups: [], vault_note_restore_audit: [] };
  let rejectBackupWrites = false;
  const project = (row, columns) => {
    if (!row) return null;
    if (!columns) return structuredClone(row);
    return Object.fromEntries(columns.split(',').map(column => [column, row[column]]));
  };
  const supabase = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `unexpected table ${table}`);
      const rows = tables[table];
      const key = table === 'vault_notes' ? 'id' : table === 'vault_note_backups' ? 'note_id' : 'id';
      const query = { mode: 'select', filters: [], values: null, columns: null };
      const matches = row => query.filters.every(([column, value]) => row[column] === value);
      const execute = () => {
        if (query.mode === 'insert') {
          if (table === 'vault_note_backups' && rejectBackupWrites) return { data: null, error: { code: 'XX000' } };
          if (rows.some(row => row[key] === query.values[key])) return { data: null, error: { code: '23505' } };
          const extras = table === 'vault_notes'
            ? { sort_order: Math.max(0, ...rows.map(row => row.sort_order ?? 0)) + 1, created_at: '2026-10-10T00:00:00.000Z' }
            : table === 'vault_note_backups' ? { captured_at: '2026-10-10T00:00:00.000Z' }
              : { created_at: '2026-10-10T00:00:00.000Z' };
          const row = { ...extras, ...query.values };
          rows.push(row);
          return { data: project(row, query.columns), error: null };
        }
        const found = rows.filter(matches);
        if (query.mode === 'update') {
          if (found[0]) Object.assign(found[0], query.values);
          return { data: project(found[0], query.columns), error: null };
        }
        if (query.mode === 'delete') {
          if (found[0]) rows.splice(rows.indexOf(found[0]), 1);
          return { data: project(found[0], query.columns), error: null };
        }
        return { data: found.map(row => project(row, query.columns)), error: null };
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
          return Promise.resolve(Array.isArray(result.data) ? { ...result, data: result.data[0] ?? null } : result);
        },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return builder;
    },
    rpc(name, args) {
      assert.equal(name, 'restore_vault_note_with_audit');
      return { single: async () => {
        const backup = tables.vault_note_backups.find(row => row.note_id === args.p_note_id);
        if (!backup) return { data: null, error: { code: 'P0002' } };
        if (backup.owner_id !== args.p_owner_id || backup.title !== args.p_title
            || backup.content !== args.p_content || backup.content_sha256 !== args.p_content_sha256
            || sha256(backup.content) !== backup.content_sha256) return { data: null, error: { code: '23514' } };
        let row = tables.vault_notes.find(note => note.id === args.p_note_id);
        if (row && row.owner_id !== args.p_owner_id) return { data: null, error: { code: 'P0002' } };
        if (row) {
          row.title = backup.title;
          row.content = backup.content;
        } else {
          row = {
            id: backup.note_id, owner_id: backup.owner_id, title: backup.title, content: backup.content,
            sort_order: Math.max(0, ...tables.vault_notes.map(note => note.sort_order ?? 0)) + 1,
            created_at: '2026-10-10T00:00:00.000Z',
          };
          tables.vault_notes.push(row);
        }
        if (row.id !== backup.note_id || row.owner_id !== backup.owner_id || row.title !== backup.title
            || sha256(row.content) !== backup.content_sha256) return { data: null, error: { code: '23514' } };
        tables.vault_note_restore_audit.push({
          id: randomUUID(), note_id: backup.note_id, actor_id: args.p_owner_id,
          backup_sha256: backup.content_sha256, action: 'restore', created_at: '2026-10-10T00:00:00.000Z',
        });
        return { data: { id: row.id, owner_id: row.owner_id, title: row.title, content: row.content }, error: null };
      } };
    },
  };
  return {
    supabase, notes: tables.vault_notes, backups: tables.vault_note_backups, audit: tables.vault_note_restore_audit,
    rejectBackupWrites(value) { rejectBackupWrites = value; },
  };
}

function handlersFor(supabase) {
  const verifyLogin = async authorization => ({
    'Bearer A': { kind: 'student', userId: ownerA },
    'Bearer B': { kind: 'student', userId: ownerB },
  })[authorization] ?? null;
  return createNotesHandlers({ supabase, verifyLogin });
}

test('restore rereads the durable first backup and appends an audit without changing other notes', async () => {
  const { supabase, notes, backups, audit } = createMemorySupabase();
  const handlers = handlersFor(supabase);
  const noteId = randomUUID();
  const otherId = randomUUID();
  const created = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id: noteId, title: 'Original B note', body: 'original private content' } }, created);
  assert.equal(created.statusCode, 201);
  assert.equal(backups.length, 1);
  assert.equal(backups[0].content_sha256, sha256('original private content'));

  const other = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer A' },
    body: { id: otherId, title: 'Unrelated A note', body: 'leave this unchanged' } }, other);
  assert.equal(other.statusCode, 201);
  const unrelated = structuredClone(notes.find(row => row.id === otherId));

  const changed = makeResponse();
  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id: noteId },
    body: { title: 'Tampered B note', body: 'attacker changed content' } }, changed);
  assert.equal(changed.statusCode, 200);
  const readTampered = makeResponse();
  await handlers.item({ method: 'GET', headers: { authorization: 'Bearer B' }, query: { id: noteId } }, readTampered);
  assert.equal(readTampered.statusCode, 200);
  assert.equal(readTampered.body.body, 'attacker changed content');
  assert.equal(backups.find(row => row.note_id === noteId).content, 'original private content');

  const historicalAudit = {
    id: randomUUID(), note_id: otherId, actor_id: ownerA, backup_sha256: sha256('prior'),
    action: 'restore', created_at: '2026-10-09T00:00:00.000Z',
  };
  audit.push(structuredClone(historicalAudit));
  const deleted = makeResponse();
  await handlers.item({ method: 'DELETE', headers: { authorization: 'Bearer B' }, query: { id: noteId } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(notes.some(row => row.id === noteId), false);

  const restored = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: noteId } }, restored);
  assert.equal(restored.statusCode, 200);
  assert.deepEqual(restored.body, { id: noteId, title: 'Original B note', body: 'original private content' });
  const recovered = notes.find(row => row.id === noteId);
  assert.equal(recovered.owner_id, ownerB);
  assert.equal(sha256(recovered.content), backups.find(row => row.note_id === noteId).content_sha256);
  assert.deepEqual(notes.find(row => row.id === otherId), unrelated);
  assert.equal(notes.length, 2);
  assert.deepEqual(audit[0], historicalAudit);
  assert.equal(audit.length, 2);
  assert.deepEqual(audit[1], {
    id: audit[1].id, note_id: noteId, actor_id: ownerB,
    backup_sha256: sha256('original private content'), action: 'restore', created_at: '2026-10-10T00:00:00.000Z',
  });
});

test('restore fails closed when no server-side backup exists', async () => {
  const { supabase, notes, audit } = createMemorySupabase();
  const response = makeResponse();
  await handlersFor(supabase).restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id: randomUUID() } }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'BACKUP_NOT_FOUND' });
  assert.equal(notes.length, 0);
  assert.equal(audit.length, 0);
});

test('tampered backup content is rejected without restoring or adding an audit event', async () => {
  const { supabase, notes, backups, audit } = createMemorySupabase();
  const handlers = handlersFor(supabase);
  const id = randomUUID();
  const created = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer B' },
    body: { id, title: 'Original', body: 'verified content' } }, created);
  const changed = makeResponse();
  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id },
    body: { title: 'Tampered', body: 'changed content' } }, changed);
  backups[0].content = 'forged content';
  const response = makeResponse();
  await handlers.restore({ method: 'POST', headers: { authorization: 'Bearer B' }, body: { id } }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'BACKUP_VERIFICATION_FAILED' });
  assert.equal(notes.find(row => row.id === id).content, 'changed content');
  assert.equal(audit.length, 0);
});

test('destructive update fails closed if the durable backup cannot be written', async () => {
  const { supabase, notes, rejectBackupWrites } = createMemorySupabase();
  const id = randomUUID();
  notes.push({ id, owner_id: ownerB, title: 'Original', content: 'keep me', sort_order: 1 });
  rejectBackupWrites(true);
  const response = makeResponse();
  await handlersFor(supabase).item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id },
    body: { title: 'Tampered', body: 'must not write' } }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(notes[0], { id, owner_id: ownerB, title: 'Original', content: 'keep me', sort_order: 1 });
});

test('policy preview verifies the safe version and restore preserves service rules and audit history', () => {
  const current = {
    revision: 99,
    rules: ['device_registered', 'experimental_bypass'],
    serviceRules: ['billing_permission'],
    auditRecords: [{ id: 'prior-audit', action: 'policy_change' }],
  };
  const preview = diffPolicy(current);
  assert.equal(preview.verifiedRevision, VERIFIED_POLICY_BACKUP.revision);
  assert.equal(preview.inSync, false);
  assert.deepEqual(preview.missing, ['step_up_required', 'resource_zone']);
  assert.deepEqual(preview.added, ['experimental_bypass']);
  assert.deepEqual(preview.scope.target, VERIFIED_POLICY_RULES);
  const restored = restorePolicy(current);
  assert.equal(restored.restored, true);
  assert.deepEqual(restored.state.rules, VERIFIED_POLICY_RULES);
  assert.deepEqual(restored.state.serviceRules, ['billing_permission']);
  assert.deepEqual(restored.state.auditRecords, [{ id: 'prior-audit', action: 'policy_change' }]);
  assert.deepEqual(current.rules, ['device_registered', 'experimental_bypass']);
  assert.throws(() => diffPolicy(current, { ...VERIFIED_POLICY_BACKUP, sha256: '0'.repeat(64) }), /unverified_policy_backup/u);
});
