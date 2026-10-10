import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';
import config from '../aleph.config.json' with { type: 'json' };

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
        return response.status(200).json(asNote(data));
      }

      if (method === 'PUT') {
        const input = parseNoteInput(request.body, false);
        if (!input) return response.status(400).json({ error: 'INVALID_NOTE' });
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

  return Object.freeze({ collection, item });
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

export async function routeNotes(kind, request, response) {
  setSecurityHeaders(response);
  const handlers = getConfiguredNotesHandlers();
  if (!handlers || !handlers[kind]) return response.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  return handlers[kind](request, response);
}
