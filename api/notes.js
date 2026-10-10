import { createClient } from '@supabase/supabase-js';

const SAMPLE_MARKER = 'SAMPLE_NOTE_1';
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co$/iu;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (typeof supabaseUrl !== 'string' || !SUPABASE_URL_PATTERN.test(supabaseUrl)
      || typeof secretKey !== 'string' || secretKey.length < 20) {
    return response.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  }

  try {
    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase
      .from('vault_notes')
      .select('title,content')
      .order('sort_order', { ascending: true });
    if (error || !Array.isArray(data)) {
      return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
    }
    const notes = data.map((row) => {
      if (typeof row?.title !== 'string' || typeof row?.content !== 'string') {
        throw new Error('INVALID_NOTE_RECORD');
      }
      return { title: row.title, content: row.content };
    });
    return response.status(200).json({ sampleMarker: SAMPLE_MARKER, notes });
  } catch {
    return response.status(503).json({ error: 'DATA_UNAVAILABLE' });
  }
}
