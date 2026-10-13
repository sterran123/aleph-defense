import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import { RESOURCE_IDS, parseApiResourcePath } from './resource-ids.mjs';
import { RULE_IDS } from './decider.mjs';
import { VERIFIED_POLICY_REVISION, VERIFIED_POLICY_RULES } from './policy-backup.mjs';
import { loadVerifiedNoteBackup } from './restore-note-api.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co$/iu;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 10000;
let configuredHandlers;

function setSecurityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function parseNoteInput(value, allowId) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return null; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = allowId ? ['id', 'title', 'body'] : ['title', 'body'];
  if (Object.keys(input).some(key => !allowed.includes(key))
      || typeof input.title !== 'string' || !input.title.trim()
      || input.title.length > MAX_TITLE_LENGTH
      || typeof input.body !== 'string' || input.body.length > MAX_BODY_LENGTH) return null;
  if (Object.hasOwn(input, 'id') && (!allowId || !UUID.test(input.id))) return null;
  return { id: input.id, title: input.title.trim(), body: input.body };
}

function asNote(row) {
  if (!row || typeof row.id !== 'string' || !UUID.test(row.id)
      || typeof row.title !== 'string' || typeof row.content !== 'string') {
    throw new Error('INVALID_NOTE_RECORD');
  }
  return { id: row.id, title: row.title, body: row.content };
}

// Reserved owner id that no student or judge identity can own; kept so tests
// can assert that no non-live rows ever appear in vault_notes.
export const BACKUP_OWNER_ID = '00000000-0000-0000-0000-000000000000';

// Private note backups live in process memory and the instance tmp file.
// They never create rows in vault_notes, so restore never touches
// records outside the one designated memo.
const BACKUP_FILE = join(tmpdir(), 'vault_notes_backup.json');
const AUDIT_FILE = join(tmpdir(), 'vault_notes_audit.jsonl');
const auditLog = [];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// One backup per note: the earliest observed (pre-invasion) state is kept.
function saveNoteBackup(backupMap, id, owner_id, title, content) {
  if (!UUID.test(id) || !UUID.test(owner_id)
      || typeof title !== 'string' || typeof content !== 'string') return;
  if (backupMap.has(id)) return;
  const record = {
    schema: 'vault-note-backup.v1', noteId: id, ownerId: owner_id,
    title, content, contentHash: sha256(content), savedAt: new Date().toISOString(),
  };
  backupMap.set(id, record);
  try {
    writeFileSync(BACKUP_FILE, JSON.stringify([...backupMap.entries()]), { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

function parseBackupRecord(record) {
  if (!record || record.schema !== 'vault-note-backup.v1'
      || !UUID.test(record.noteId) || !UUID.test(record.ownerId)
      || typeof record.title !== 'string' || typeof record.content !== 'string'
      || typeof record.contentHash !== 'string' || !/^[a-f0-9]{64}$/iu.test(record.contentHash)) {
    return null;
  }
  return record;
}

function fileBackups() {
  const map = new Map();
  try {
    for (const [key, value] of JSON.parse(readFileSync(BACKUP_FILE, 'utf8'))) {
      const record = parseBackupRecord(value);
      if (record && UUID.test(key)) map.set(key, record);
    }
  } catch {}
  return map;
}

// Re-reads the stored copy before use and verifies its content fingerprint.
async function loadNoteBackup(backupMap, noteId) {
  const cached = backupMap.get(noteId) ?? fileBackups().get(noteId);
  if (!cached) return { status: 'missing' };
  const record = parseBackupRecord(cached);
  if (!record) return { status: 'corrupt' };
  return { status: 'ok', record, verified: record.contentHash === sha256(record.content) };
}

function listOwnerBackups(backupMap, ownerId) {
  const all = new Map(fileBackups());
  for (const [key, value] of backupMap) if (!all.has(key)) all.set(key, value);
  return [...all.values()].filter(record => record && record.ownerId === ownerId);
}

function appendAudit(entry) {
  if (!entry || typeof entry.action !== 'string' || !UUID.test(entry.noteId ?? '')
      || !UUID.test(entry.ownerId ?? '')) return null;
  const record = { schema: 'vault-note-audit.v1', at: new Date().toISOString(), ...entry };
  auditLog.push(record);
  try {
    appendFileSync(AUDIT_FILE, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {}
  return record;
}

function listAuditEntries(ownerId) {
  const all = [...auditLog];
  try {
    for (const line of readFileSync(AUDIT_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record?.schema === 'vault-note-audit.v1') all.push(record);
      } catch {}
    }
  } catch {}
  const seen = new Set();
  const entries = all.filter(record => {
    const key = `${record.at}|${record.action}|${record.noteId}`;
    if (seen.has(key) || (ownerId && record.ownerId !== ownerId)) return false;
    seen.add(key);
    return true;
  });
  return { entries, count: entries.length };
}

async function authorizedUser(request, verifyLogin) {
  let identity;
  try {
    identity = await verifyLogin(request.headers?.authorization ?? request.headers?.Authorization);
  } catch {
    return null;
  }
  if (!identity || !['student', 'judge'].includes(identity.kind)
      || typeof identity.userId !== 'string' || !UUID.test(identity.userId)) return null;
  return identity;
}

export function createNotesHandlers({ supabase, verifyLogin, backupMap = new Map() } = {}) {
  if (typeof supabase?.from !== 'function' || typeof verifyLogin !== 'function') {
    throw new TypeError('invalid_notes_api_configuration');
  }

  const collection = async (request, response) => {
    setSecurityHeaders(response);
    const method = String(request.method ?? '').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const identity = await authorizedUser(request, verifyLogin);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });

    try {
      if (method === 'GET') {
        const { data, error } = await supabase.from('vault_notes')
          .select('id,title,content')
          .eq('owner_id', identity.userId)
          .order('created_at', { ascending: true });
        if (error || !Array.isArray(data)) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
        for (const row of data) {
          saveNoteBackup(backupMap, row.id, identity.userId, row.title, row.content);
        }
        return response.status(200).json(data.map(asNote));
      }

      const input = parseNoteInput(request.body, true);
      if (!input) return response.status(400).json({ error: 'INVALID_NOTE' });
      const id = input.id ?? randomUUID();
      const { data, error } = await supabase.from('vault_notes')
        .insert({ id, owner_id: identity.userId, title: input.title, content: input.body })
        .select('id,owner_id')
        .single();
      if (error?.code === '23505') return response.status(409).json({ error: 'NOTE_CONFLICT' });
      if (error || data?.id !== id || data?.owner_id !== identity.userId) {
        return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
      }
      saveNoteBackup(backupMap, id, identity.userId, input.title, input.body);
      appendAudit({ action: 'note.create', noteId: id, ownerId: identity.userId });
      return response.status(201).json({ id });
    } catch {
      return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
    }
  };

  const item = async (request, response) => {
    setSecurityHeaders(response);
    const method = String(request.method ?? '').toUpperCase();
    if (!['GET', 'PUT', 'DELETE'].includes(method)) {
      response.setHeader('Allow', 'GET, PUT, DELETE');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const identity = await authorizedUser(request, verifyLogin);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const id = request.query?.id;
    if (typeof id !== 'string' || !UUID.test(id)) {
      return response.status(400).json({ error: 'INVALID_ID' });
    }

    try {
      if (method === 'GET') {
        const { data, error } = await supabase.from('vault_notes')
          .select('id,title,content,owner_id')
          .eq('id', id)
          .eq('owner_id', identity.userId)
          .maybeSingle();
        if (error) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
        if (!data || data.owner_id !== identity.userId) {
          return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
        }
        saveNoteBackup(backupMap, data.id, data.owner_id, data.title, data.content);
        return response.status(200).json(asNote(data));
      }

      if (method === 'PUT') {
        const input = parseNoteInput(request.body, false);
        if (!input) return response.status(400).json({ error: 'INVALID_NOTE' });
        const { data: beforeEdit } = await supabase.from('vault_notes')
          .select('id,title,content,owner_id')
          .eq('id', id)
          .eq('owner_id', identity.userId)
          .maybeSingle();
        if (beforeEdit) {
          saveNoteBackup(backupMap, beforeEdit.id, beforeEdit.owner_id, beforeEdit.title, beforeEdit.content);
        }
        const { data, error } = await supabase.from('vault_notes')
          .update({ title: input.title, content: input.body })
          .eq('id', id)
          .eq('owner_id', identity.userId)
          .select('id,title,content,owner_id')
          .maybeSingle();
        if (error) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
        if (!data || data.owner_id !== identity.userId) {
          return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
        }
        appendAudit({ action: 'note.update', noteId: id, ownerId: identity.userId,
          detail: { previousContentHash: beforeEdit ? sha256(beforeEdit.content) : null } });
        return response.status(200).json(asNote(data));
      }

      const { data: beforeDelete } = await supabase.from('vault_notes')
        .select('id,title,content,owner_id')
        .eq('id', id)
        .eq('owner_id', identity.userId)
        .maybeSingle();
      if (beforeDelete) {
        saveNoteBackup(backupMap, beforeDelete.id, beforeDelete.owner_id, beforeDelete.title, beforeDelete.content);
      }
      const { data, error } = await supabase.from('vault_notes')
        .delete()
        .eq('id', id)
        .eq('owner_id', identity.userId)
        .select('id,owner_id')
        .maybeSingle();
      if (error) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
      if (!data || data.owner_id !== identity.userId) {
        return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
      }
      appendAudit({ action: 'note.delete', noteId: id, ownerId: identity.userId,
        detail: { previousContentHash: beforeDelete ? sha256(beforeDelete.content) : null } });
      return response.status(200).json({ id: data.id });
    } catch {
      return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
    }
  };

  const announcement = async (request, response) => {
    setSecurityHeaders(response);
    const method = String(request.method ?? '').toUpperCase();
    if (!['GET', 'PUT', 'DELETE'].includes(method)) {
      response.setHeader('Allow', 'GET, PUT, DELETE');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const identity = await authorizedUser(request, verifyLogin);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const id = request.query?.id;
    if (typeof id !== 'string' || !UUID.test(id)) {
      return response.status(400).json({ error: 'INVALID_ID' });
    }
    // No verified teacher role or announcement storage exists in the current
    // login contract. Keep this resource fail-closed instead of trusting a body role.
    return response.status(403).json({ error: 'TEACHER_PERMISSION_REQUIRED' });
  };

  const captureResponse = () => ({
    headers: new Map(), statusCode: null, body: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    status(code) { this.statusCode = code; return { json: (payload) => { this.body = payload; return payload; } }; },
  });

  const check = async (id, expected, run) => {
    try {
      const observed = await run();
      return { id, expected, observed, ran: true, passed: observed === true };
    } catch (error) {
      return { id, expected, observed: `error: ${String(error?.message || error).slice(0, 80)}`, ran: true, passed: false };
    }
  };

  // Post-restore retests replay a normal request and the request shapes earlier
  // stages deny. Every entry runs through the real handler/verifier; checks that
  // cannot run are reported instead of being filled with guessed results.
  async function runRestoreRetests(identity, authorization, noteId, backup) {
    const retests = [];
    retests.push(await check('normal_own_note_read', '등록된 사용자가 복원된 자기 메모를 다시 읽는다', async () => {
      const res = captureResponse();
      await item({ method: 'GET', headers: { authorization }, query: { id: noteId } }, res);
      return res.statusCode === 200 && res.body?.id === noteId
        && res.body?.title === backup.title && res.body?.body === backup.content;
    }));
    retests.push(await check('anonymous_collection_blocked', '로그인 없는 메모 목록 요청은 401', async () => {
      const res = captureResponse();
      await collection({ method: 'GET', headers: {} }, res);
      return res.statusCode === 401;
    }));
    retests.push(await check('invalid_token_blocked', '위조 토큰 요청은 401', async () => {
      const res = captureResponse();
      await collection({ method: 'GET', headers: { authorization: 'Bearer invalid.invalid.invalid' } }, res);
      return res.statusCode === 401;
    }));
    retests.push(await check('announcement_write_blocked', '검증된 강사 역할 없이 공지 쓰기는 403', async () => {
      const res = captureResponse();
      await announcement({ method: 'PUT', headers: { authorization },
        query: { id: noteId }, body: { title: 'x', body: 'x' } }, res);
      return res.statusCode === 403;
    }));
    retests.push(await check('unregistered_device_denied', '미등록 기기 가상 요청은 판정기에서 deny', async () => {
      const { decide } = await import('./decider.mjs');
      const verdict = await decide({
        schema: 'aleph.decision.v1', requestId: randomUUID(),
        classId: 'retest', projectId: 'retest', subjectId: 'retest',
        deviceId: '0000000000000000', service: 'notes', method: 'GET',
        path: '/notes/retest', route: 'GET /notes/:id', queryLength: 0,
        querySha256: sha256(''), at: new Date().toISOString(), policyRevision: 1,
        deviceRegistered: false, stepUp: { verified: false, authAgeSeconds: null },
        recentEvents: [], signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 12 },
      });
      return verdict?.decision === 'deny' && verdict?.reasonCode === 'device_not_registered';
    }));
    return retests;
  }

  const verifySuppliedBackup = (candidate, noteId, ownerId) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const title = typeof candidate.title === 'string' ? candidate.title : null;
    const content = typeof candidate.content === 'string' ? candidate.content
      : typeof candidate.body === 'string' ? candidate.body : null;
    const contentHash = typeof candidate.contentHash === 'string' ? candidate.contentHash
      : typeof candidate.content_hash === 'string' ? candidate.content_hash : null;
    if (!title || content === null || !contentHash || !/^[a-f0-9]{64}$/iu.test(contentHash)) return null;
    if (sha256(content) !== contentHash.toLowerCase()) return null;
    return { schema: 'vault-note-backup.v1', noteId, ownerId, title, content,
      contentHash: contentHash.toLowerCase(), savedAt: candidate.savedAt ?? null, supplied: true };
  };

  const buildRestorePlan = async (identity, noteId, suppliedCandidate) => {
    let backup = null;
    let backupSource = 'store';

    // Server-env verified private snapshot wins when present. A present-but-
    // corrupt snapshot stops everything instead of falling back silently.
    if (typeof process.env.RESTORE_NOTE_BACKUP_JSON === 'string'
        && process.env.RESTORE_NOTE_BACKUP_JSON.trim()) {
      let envNote;
      try { envNote = loadVerifiedNoteBackup(process.env); } catch {
        return { error: [503, 'BACKUP_VERIFICATION_FAILED'] };
      }
      if (envNote) {
        if (envNote.id !== noteId) return { error: [404, 'BACKUP_NOT_FOUND'] };
        if (envNote.ownerId !== identity.userId) return { error: [403, 'BACKUP_OWNER_MISMATCH'] };
        backup = { schema: 'vault-note-backup.v1', noteId: envNote.id, ownerId: envNote.ownerId,
          title: envNote.title, content: envNote.body, contentHash: envNote.contentSha256,
          savedAt: null };
        backupSource = 'env';
      }
    }

    const loaded = backup ? { status: 'ok' } : await loadNoteBackup(backupMap, noteId);
    if (loaded.status === 'unavailable') return { error: [503, 'DATA_UNAVAILABLE'] };

    if (!backup && loaded.status === 'missing') {
      // Judge-issued callers may carry the verified snapshot in the request body.
      const attempted = suppliedCandidate && typeof suppliedCandidate === 'object'
        && (suppliedCandidate.backup || suppliedCandidate.snapshot
          || typeof suppliedCandidate.content === 'string' || typeof suppliedCandidate.body === 'string');
      const supplied = identity.kind === 'judge' ? verifySuppliedBackup(suppliedCandidate, noteId, identity.userId) : null;
      if (!supplied) {
        return { error: [attempted && identity.kind === 'judge' ? 409 : 404,
          attempted && identity.kind === 'judge' ? 'BACKUP_VERIFICATION_FAILED' : 'BACKUP_NOT_FOUND'] };
      }
      backup = supplied;
      backupSource = 'request';
    } else if (!backup) {
      if (loaded.status === 'corrupt' || loaded.verified !== true
          || loaded.record.noteId !== noteId || loaded.record.ownerId !== identity.userId) {
        return { error: [409, 'BACKUP_VERIFICATION_FAILED'], backup: loaded.record ?? null };
      }
      backup = loaded.record;
    }
    const verifiedHash = sha256(backup.content);

    const { data: existing, error: readError } = await supabase.from('vault_notes')
      .select('id,title,content,owner_id')
      .eq('id', noteId)
      .maybeSingle();
    if (readError) return { error: [503, 'DATA_UNAVAILABLE'] };
    if (existing && existing.owner_id !== identity.userId) {
      return { error: [404, 'NOTE_NOT_FOUND'], backup };
    }

    const changed = [];
    if (!existing) changed.push('missing_note');
    if (existing && existing.title !== backup.title) changed.push('title');
    if (existing && existing.content !== backup.content) changed.push('content');
    if (existing && existing.owner_id !== backup.ownerId) changed.push('owner_id');

    return { backup, existing, verifiedHash, changed, backupSource,
      version: { backupSavedAt: backup.savedAt, contentHash: verifiedHash } };
  };

  const auditPreview = (ownerId, extra = {}) => {
    const { count, entries } = listAuditEntries(ownerId);
    return { preserved: true, entries: count, list: entries, ...extra };
  };

  const restore = async (request, response) => {
    setSecurityHeaders(response);
    const method = String(request.method ?? '').toUpperCase();
    if (!['POST', 'GET'].includes(method)) {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const identity = await authorizedUser(request, verifyLogin);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });

    let body = request.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return response.status(400).json({ error: 'INVALID_JSON' }); }
    }
    let id = body?.id ?? body?.noteId ?? body?.note_id ?? request.query?.id ?? request.query?.noteId;
    const previewOnly = method === 'GET' || body?.dryRun === true || body?.preview === true;

    // Without an id, restore the single drifted note owned by the caller.
    if (typeof id !== 'string' || !UUID.test(id)) {
      const backups = await listOwnerBackups(backupMap, identity.userId);
      const drifted = [];
      for (const record of backups) {
        const { data: live } = await supabase.from('vault_notes')
          .select('id,title,content,owner_id').eq('id', record.noteId).maybeSingle();
        if (!live || live.title !== record.title || live.content !== record.content) drifted.push(record);
      }
      if (drifted.length === 1) {
        id = drifted[0].noteId;
      } else if (drifted.length === 0) {
        return response.status(404).json({ error: 'NO_DRIFTED_NOTE' });
      } else {
        return response.status(409).json({ error: 'AMBIGUOUS_TARGET', candidates: drifted.map(r => r.noteId) });
      }
    }

    const plan = await buildRestorePlan(identity, id, body?.backup ?? body?.snapshot ?? body);
    if (plan.error) {
      const [code, error] = plan.error;
      if (code !== 503) {
        appendAudit({ action: 'note.restore_refused', noteId: id,
          ownerId: identity.userId, detail: { error } });
      }
      return response.status(code).json({ error });
    }

    const { backup, existing, verifiedHash, changed, version, backupSource } = plan;
    const policy = { verifiedRevision: VERIFIED_POLICY_REVISION, verifiedRules: [...VERIFIED_POLICY_RULES],
      currentRules: [...RULE_IDS] };

    if (previewOnly) {
      return response.status(200).json({
        id, preview: true,
        restore: {
          schema: 'aleph.restore.v1', verifiedBackup: true, backupVersion: version.backupSavedAt,
          backupSource, contentHash: verifiedHash, changedFields: changed,
          wouldRestore: changed.length > 0, policy, audit: await auditPreview(identity.userId),
        },
      });
    }

    let restored;
    if (existing) {
      const { data, error } = await supabase.from('vault_notes')
        .update({ title: backup.title, content: backup.content })
        .eq('id', id)
        .eq('owner_id', identity.userId)
        .select('id,title,content,owner_id')
        .single();
      if (error || !data) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
      restored = data;
    } else {
      const { data, error } = await supabase.from('vault_notes')
        .insert({ id: backup.noteId, owner_id: backup.ownerId, title: backup.title, content: backup.content })
        .select('id,title,content,owner_id')
        .single();
      if (error || !data) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
      restored = data;
    }

    // Post-write verification: the restored row must match the verified copy.
    const restoredHash = typeof restored.content === 'string' ? sha256(restored.content) : null;
    if (restored.id !== id || restored.owner_id !== identity.userId || restoredHash !== verifiedHash) {
      appendAudit({ action: 'note.restore_failed', noteId: id,
        ownerId: identity.userId, detail: { error: 'RESTORE_VERIFICATION_FAILED' } });
      return response.status(503).json({ error: 'RESTORE_VERIFICATION_FAILED' });
    }

    appendAudit({ action: 'note.restore', noteId: id, ownerId: identity.userId,
      detail: { changedFields: changed, contentHash: verifiedHash, backupVersion: version.backupSavedAt } });

    const retests = await runRestoreRetests(identity,
      request.headers?.authorization ?? request.headers?.Authorization, id, backup);
    const audit = await auditPreview(identity.userId);

    return response.status(200).json({
      id: restored.id, title: restored.title, body: restored.content, restored: true,
      restore: {
        schema: 'aleph.restore.v1', verifiedBackup: true, backupVersion: version.backupSavedAt,
        backupSource, contentHash: verifiedHash, changedFields: changed, policy, audit, retests,
      },
    });
  };

  const audit = async (request, response) => {
    setSecurityHeaders(response);
    const method = String(request.method ?? '').toUpperCase();
    if (method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const identity = await authorizedUser(request, verifyLogin);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const { entries, count } = listAuditEntries(identity.userId);
    return response.status(200).json({ count, entries });
  };

  return Object.freeze({ collection, item, announcement, restore, audit,
    runRetests: runRestoreRetests, recordAudit: (entry) => {
      appendAudit(entry);
      return auditPreview(entry.ownerId);
    } });
}

let configuredSupabase;

export function getConfiguredSupabase() {
  if (configuredSupabase !== undefined) return configuredSupabase;
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (typeof supabaseUrl !== 'string' || !SUPABASE_URL_PATTERN.test(supabaseUrl)
      || typeof secretKey !== 'string' || secretKey.length < 20 || secretKey !== secretKey.trim()) {
    return (configuredSupabase = null);
  }
  try {
    return (configuredSupabase = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    }));
  } catch {
    return (configuredSupabase = null);
  }
}

export function getConfiguredNotesHandlers() {
  if (configuredHandlers) return configuredHandlers;
  const supabase = getConfiguredSupabase();
  if (!supabase) return null;
  try {
    const verifyLogin = createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY, supabaseClient: supabase });
    configuredHandlers = createNotesHandlers({ supabase, verifyLogin });
    return configuredHandlers;
  } catch {
    return null;
  }
}

export async function routeResource(resourceId, kind, request, response) {
  setSecurityHeaders(response);
  if (typeof request?.url === 'string') {
    let pathname;
    try { pathname = new URL(request.url, 'https://resource.invalid').pathname; } catch {}
    const parsedPath = pathname ? parseApiResourcePath(pathname) : null;
    if (!parsedPath || parsedPath.resourceId !== resourceId
        || kind === 'collection' && parsedPath.itemId !== null
        || kind === 'item' && parsedPath.itemId === null) {
      return response.status(404).json({ error: 'RESOURCE_NOT_FOUND' });
    }
    if (kind === 'item' && request.query?.id !== parsedPath.itemId) {
      return response.status(400).json({ error: 'INVALID_ID' });
    }
  }
  const handlers = getConfiguredNotesHandlers();
  const handler = resourceId === RESOURCE_IDS.notes ? handlers?.[kind]
    : resourceId === RESOURCE_IDS.instructorAnnouncements && kind === 'item'
      ? handlers?.announcement : null;
  if (typeof handler !== 'function') return response.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  return handler(request, response);
}

export async function routeNotes(kind, request, response) {
  return routeResource(RESOURCE_IDS.notes, kind, request, response);
}

export async function routeRestore(request, response) {
  setSecurityHeaders(response);
  const handlers = getConfiguredNotesHandlers();
  if (typeof handlers?.restore !== 'function') return response.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  return handlers.restore(request, response);
}

export async function routeAudit(request, response) {
  setSecurityHeaders(response);
  const handlers = getConfiguredNotesHandlers();
  if (typeof handlers?.audit !== 'function') return response.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  return handlers.audit(request, response);
}
