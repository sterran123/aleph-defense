import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyPolicySnapshot, diffTestPolicy, restoreTestPolicy } from '../src/policy-restore.mjs';
import { createRestoreNoteHandler, loadVerifiedNoteBackup } from '../src/restore-note-api.mjs';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const response = () => ({
  statusCode: 0, body: undefined, headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
  end() { return this; },
});
const config = { identityProvider: { issuer: 'https://example.supabase.co/auth/v1' } };
const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const noteId = '22222222-2222-4222-8222-222222222222';
const body = '비공개 시험 메모';
const contentSha256 = createHash('sha256').update(body).digest('hex');
const note = { id: noteId, ownerId, title: '복구 시험', body, contentSha256 };
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-test-key' };

// supabase-js 체인을 흉내 내는 최소 목. 호출 기록을 남겨 한 건만 쓰는지 확인한다.
function fakeSupabase({ existing = [], written = [], calls = [] } = {}) {
  return {
    from: table => {
      assert.equal(table, 'vault_notes');
      return {
        select: () => ({ eq: () => {
          calls.push({ op: 'select' });
          return Promise.resolve({ data: existing, error: null });
        } }),
        update: value => ({ eq: () => ({ eq: () => ({ select: () => {
          calls.push({ op: 'update', value });
          return Promise.resolve({ data: written, error: null });
        } }) }) }),
        insert: value => ({ select: () => {
          calls.push({ op: 'insert', value });
          return Promise.resolve({ data: written, error: null });
        } }),
      };
    },
  };
}

test('안전 정책은 해시를 확인하고 변경 범위를 먼저 표시한다', async () => {
  const text = await readFile(new URL('../backups/step10/safe-policy.json', import.meta.url), 'utf8');
  const hash = (await readFile(new URL('../backups/step10/safe-policy.sha256', import.meta.url), 'utf8')).trim();
  const snapshot = verifyPolicySnapshot(text, hash);
  const current = await readJson('./fixtures/step10-current-policy.json');
  const plan = diffTestPolicy(snapshot, current);
  assert.equal(plan.service, 'student-notes');
  assert.deepEqual(plan.changes.map(change => change.ruleId),
    ['device_registered', 'resource_zone', 'step_up_required']);
  assert.throws(() => restoreTestPolicy(snapshot, current, 'wrong-version'), /버전/);
  const { restored } = restoreTestPolicy(snapshot, current, snapshot.version);
  assert.deepEqual(restored.services['student-notes'].rules, snapshot.rules);
  assert.deepEqual(restored.services['unrelated-service'], current.services['unrelated-service']);
  assert.deepEqual(restored.auditHistory, current.auditHistory);
  const changedText = text.replace('"mode": "require"', '"mode": "optional"');
  assert.throws(() => verifyPolicySnapshot(changedText, hash), /검증/);
});

test('비공개 사본은 환경 변수에서만 읽고 전체 해시와 본문 해시를 대조한다', () => {
  const raw = JSON.stringify({ schema: 'aleph.private-note-backup.v1', note });
  const digest = createHash('sha256').update(raw).digest('hex');
  assert.equal(loadVerifiedNoteBackup({
    RESTORE_NOTE_BACKUP_JSON: raw, RESTORE_NOTE_BACKUP_SHA256: digest,
  }).id, noteId);
  assert.throws(() => loadVerifiedNoteBackup({}), /사본/);
  assert.throws(() => loadVerifiedNoteBackup({
    RESTORE_NOTE_BACKUP_JSON: raw,
    RESTORE_NOTE_BACKUP_SHA256: '0'.repeat(64),
  }), /검증/);
  const tampered = JSON.stringify({ schema: 'aleph.private-note-backup.v1',
    note: { ...note, body: '손댄 본문' } });
  assert.throws(() => loadVerifiedNoteBackup({
    RESTORE_NOTE_BACKUP_JSON: tampered,
    RESTORE_NOTE_BACKUP_SHA256: createHash('sha256').update(tampered).digest('hex'),
  }), /검증/);
});

test('메모 복원은 로그인·대상·소유자가 모두 일치해야 한다', async () => {
  const handler = createRestoreNoteHandler({ config, env,
    verifierFactory: () => async () => ({ userId: ownerId }), backupLoader: () => note,
    supabaseFactory: () => fakeSupabase(),
  });
  let res = response();
  await handler({ method: 'POST', headers: {}, query: { id: noteId } }, res);
  assert.equal(res.statusCode, 401);
  res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' },
    query: { id: '11111111-1111-4111-8111-111111111111' } }, res);
  assert.equal(res.statusCode, 404);
  res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' },
    query: { id: noteId }, body: { ownerId } }, res);
  assert.equal(res.statusCode, 400);
  const otherHandler = createRestoreNoteHandler({ config, env,
    verifierFactory: () => async () => ({ userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    backupLoader: () => note, supabaseFactory: () => fakeSupabase() });
  res = response();
  await otherHandler({ method: 'POST', headers: { authorization: 'Bearer test' }, query: { id: noteId } }, res);
  assert.equal(res.statusCode, 403);
});

test('사본이 없거나 검증에 실패하면 503으로 중단하고 쓰지 않는다', async () => {
  const calls = [];
  const handler = createRestoreNoteHandler({ config, env,
    verifierFactory: () => async () => ({ userId: ownerId }),
    backupLoader: () => { throw new Error('no backup'); },
    supabaseFactory: () => fakeSupabase({ calls }) });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, query: { id: noteId } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(calls.length, 0);
});

test('B의 지정 메모 한 건만 복원하고 해시를 다시 확인한다', async () => {
  const calls = [];
  const handler = createRestoreNoteHandler({ config, env,
    verifierFactory: () => async () => ({ userId: ownerId }), backupLoader: () => note,
    supabaseFactory: () => fakeSupabase({
      existing: [], written: [{ id: noteId, owner_id: ownerId, content: body }], calls,
    }) });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, query: { id: noteId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.restored, true);
  assert.equal(res.body.ownerVerified, true);
  assert.equal(res.body.contentSha256, contentSha256);
  assert.equal(calls.filter(c => c.op === 'insert').length, 1);
  assert.deepEqual(calls[1].value, { id: noteId, owner_id: ownerId, title: '복구 시험', content: body });
});

test('이미 사본과 같은 내용이면 쓰지 않고 restored:false를 반환한다', async () => {
  const calls = [];
  const handler = createRestoreNoteHandler({ config, env,
    verifierFactory: () => async () => ({ userId: ownerId }), backupLoader: () => note,
    supabaseFactory: () => fakeSupabase({
      existing: [{ id: noteId, owner_id: ownerId, content: body }], calls,
    }) });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, query: { id: noteId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.restored, false);
  assert.equal(calls.filter(c => c.op !== 'select').length, 0);
});
