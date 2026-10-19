import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import { RESOURCE_IDS, parseApiResourcePath } from './resource-ids.mjs';

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

const BACKUP_COLUMNS = 'note_id,owner_id,title,content,content_sha256,captured_at';

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isVerifiedBackup(backup, { id, ownerId } = {}) {
  return Boolean(backup && backup.note_id === id && backup.owner_id === ownerId
    && typeof backup.title === 'string' && typeof backup.content === 'string'
    && typeof backup.content_sha256 === 'string' && /^[a-f0-9]{64}$/iu.test(backup.content_sha256)
    && hashContent(backup.content) === backup.content_sha256);
}

async function persistNoteBackup(supabase, { id, owner_id: ownerId, title, content }) {
  if (typeof id !== 'string' || !UUID.test(id) || typeof ownerId !== 'string' || !UUID.test(ownerId)
      || typeof title !== 'string' || typeof content !== 'string') {
    throw new Error('INVALID_NOTE_BACKUP');
  }

  const contentHash = hashContent(content);
  const { error: insertError } = await supabase.from('vault_note_backups').insert({
    note_id: id,
    owner_id: ownerId,
    title,
    content,
    content_sha256: contentHash,
  });
  if (insertError && insertError.code !== '23505') throw new Error('BACKUP_PERSISTENCE_FAILED');

  // Read the persisted record, not a process-local or client-supplied copy.
  const { data: persisted, error: readError } = await supabase.from('vault_note_backups')
    .select(BACKUP_COLUMNS)
    .eq('note_id', id)
    .maybeSingle();
  if (readError || !isVerifiedBackup(persisted, { id, ownerId })) {
    throw new Error('BACKUP_VERIFICATION_FAILED');
  }
  return persisted;
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

export function createNotesHandlers({ supabase, verifyLogin } = {}) {
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
          await persistNoteBackup(supabase, {
            id: row.id, owner_id: identity.userId, title: row.title, content: row.content,
          });
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
      await persistNoteBackup(supabase, {
        id, owner_id: identity.userId, title: input.title, content: input.body,
      });
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
        await persistNoteBackup(supabase, {
          id: data.id, owner_id: data.owner_id, title: data.title, content: data.content,
        });
        return response.status(200).json(asNote(data));
      }

      if (method === 'PUT') {
        const input = parseNoteInput(request.body, false);
        if (!input) return response.status(400).json({ error: 'INVALID_NOTE' });
        const { data: beforeEdit, error: beforeEditError } = await supabase.from('vault_notes')
          .select('id,title,content,owner_id')
          .eq('id', id)
          .eq('owner_id', identity.userId)
          .maybeSingle();
        if (beforeEditError) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
        if (beforeEdit) {
          await persistNoteBackup(supabase, {
            id: beforeEdit.id, owner_id: beforeEdit.owner_id, title: beforeEdit.title, content: beforeEdit.content,
          });
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
        return response.status(200).json(asNote(data));
      }

      const { data: beforeDelete, error: beforeDeleteError } = await supabase.from('vault_notes')
        .select('id,title,content,owner_id')
        .eq('id', id)
        .eq('owner_id', identity.userId)
        .maybeSingle();
      if (beforeDeleteError) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
      if (beforeDelete) {
        await persistNoteBackup(supabase, {
          id: beforeDelete.id, owner_id: beforeDelete.owner_id, title: beforeDelete.title, content: beforeDelete.content,
        });
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

  const restore = async (request, response) => {
    setSecurityHeaders(response);
    const method = String(request.method ?? '').toUpperCase();
    if (method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const identity = await authorizedUser(request, verifyLogin);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });

    let body = request.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return response.status(400).json({ error: 'INVALID_JSON' }); }
    }
    const id = body?.id ?? request.query?.id;
    if (typeof id !== 'string' || !UUID.test(id)) {
      return response.status(400).json({ error: 'INVALID_ID' });
    }

    // Re-read the server-only durable backup for every restore; never trust client data.
    const { data: backup, error: backupReadError } = await supabase.from('vault_note_backups')
      .select(BACKUP_COLUMNS)
      .eq('note_id', id)
      .maybeSingle();
    if (backupReadError) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
    if (!backup) return response.status(404).json({ error: 'BACKUP_NOT_FOUND' });
    if (backup.owner_id !== identity.userId) return response.status(404).json({ error: 'BACKUP_NOT_FOUND' });
    if (!isVerifiedBackup(backup, { id, ownerId: identity.userId })) {
      return response.status(409).json({ error: 'BACKUP_VERIFICATION_FAILED' });
    }

    // The database function rechecks the immutable copy and restores one row plus
    // an append-only audit event in the same transaction.
    const { data: restored, error: restoreError } = await supabase
      .rpc('restore_vault_note_with_audit', {
        p_note_id: id,
        p_owner_id: identity.userId,
        p_title: backup.title,
        p_content: backup.content,
        p_content_sha256: backup.content_sha256,
      })
      .single();
    if (restoreError?.code === 'P0002') return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
    if (restoreError?.code === '23514') return response.status(409).json({ error: 'BACKUP_VERIFICATION_FAILED' });
    if (restoreError || !restored) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });

    const restoredHash = typeof restored.content === 'string' ? hashContent(restored.content) : null;
    if (restored.id !== id || restored.owner_id !== identity.userId
        || restored.title !== backup.title || restoredHash !== backup.content_sha256) {
      return response.status(503).json({ error: 'RESTORE_VERIFICATION_FAILED' });
    }
    return response.status(200).json(asNote(restored));
  };

  return Object.freeze({ collection, item, announcement, restore });
}

export function getConfiguredNotesHandlers() {
  if (configuredHandlers) return configuredHandlers;
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (typeof supabaseUrl !== 'string' || !SUPABASE_URL_PATTERN.test(supabaseUrl)
      || typeof secretKey !== 'string' || secretKey.length < 20 || secretKey !== secretKey.trim()) return null;
  try {
    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const verifyLogin = createLoginVerifier({ config, supabaseSecretKey: secretKey, supabaseClient: supabase });
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
