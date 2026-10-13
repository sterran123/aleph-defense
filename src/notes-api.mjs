import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

const BACKUP_FILE = '/tmp/vault_notes_backup.json';
const backupMap = new Map();

function loadBackups() {
  try {
    const raw = readFileSync(BACKUP_FILE, 'utf8');
    const entries = JSON.parse(raw);
    for (const [id, record] of entries) {
      backupMap.set(id, record);
    }
  } catch {}
}
loadBackups();

function persistBackups() {
  try {
    writeFileSync(BACKUP_FILE, JSON.stringify([...backupMap.entries()]), 'utf8');
  } catch {}
}

function saveNoteBackup(id, owner_id, title, content) {
  if (!id || !owner_id || typeof title !== 'string' || typeof content !== 'string') return;
  const contentHash = createHash('sha256').update(content).digest('hex');
  const record = { id, owner_id, title, content, contentHash, savedAt: new Date().toISOString() };
  backupMap.set(id, record);
  persistBackups();
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
          saveNoteBackup(row.id, identity.userId, row.title, row.content);
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
      saveNoteBackup(id, identity.userId, input.title, input.body);
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
        saveNoteBackup(data.id, data.owner_id, data.title, data.content);
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
          saveNoteBackup(beforeEdit.id, beforeEdit.owner_id, beforeEdit.title, beforeEdit.content);
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

      const { data: beforeDelete } = await supabase.from('vault_notes')
        .select('id,title,content,owner_id')
        .eq('id', id)
        .eq('owner_id', identity.userId)
        .maybeSingle();
      if (beforeDelete) {
        saveNoteBackup(beforeDelete.id, beforeDelete.owner_id, beforeDelete.title, beforeDelete.content);
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

    // Re-read backup from runtime map (populated by earlier PUT/POST/GET/DELETE)
    let backup = backupMap.get(id);

    // S10_BACKUP_UNVERIFIED: if no backup exists, stop immediately
    if (!backup) {
      return response.status(404).json({ error: 'BACKUP_NOT_FOUND' });
    }

    // Re-verify: compute hash of stored content and compare to recorded hash
    const verifiedHash = createHash('sha256').update(backup.content).digest('hex');
    if (backup.contentHash && backup.contentHash !== verifiedHash) {
      // Verification failed: do NOT proceed with restore
      return response.status(409).json({ error: 'BACKUP_VERIFICATION_FAILED' });
    }

    // Owner check
    if (backup.owner_id !== identity.userId) {
      return response.status(403).json({ error: 'FORBIDDEN' });
    }

    // S10_RESTORE_MISMATCH: restore exactly one note matching id + owner
    const { data: existing } = await supabase.from('vault_notes')
      .select('id,owner_id')
      .eq('id', id)
      .maybeSingle();

    if (existing) {
      const { data: updated, error: updateError } = await supabase.from('vault_notes')
        .update({ title: backup.title, content: backup.content })
        .eq('id', id)
        .eq('owner_id', identity.userId)
        .select('id,title,content,owner_id')
        .single();
      if (updateError || !updated) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
      return response.status(200).json(asNote(updated));
    } else {
      const { data: inserted, error: insertError } = await supabase.from('vault_notes')
        .insert({ id: backup.id, owner_id: backup.owner_id, title: backup.title, content: backup.content })
        .select('id,title,content,owner_id')
        .single();
      if (insertError || !inserted) return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
      return response.status(200).json(asNote(inserted));
    }
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
