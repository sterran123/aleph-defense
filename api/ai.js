// AI 중계 API — 로그인한 사용자만. 사용자별 하루 호출 상한을 서버가 세고,
// 외부 AI 호출은 서버 환경변수의 키로만 합니다. 상한 기록은 Supabase 의
// ai_usage 표에 남아 서버리스 인스턴스가 바뀌어도 유지됩니다.
// AI 연결(AI_PROXY_URL·AI_API_KEY)이 없으면 답을 꾸미지 않고 503으로 돌려줍니다.
import { readFileSync } from 'node:fs';
import { sessionAuth } from '../src/server-session.mjs';
import { createLoginVerifier } from '../src/verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));

const intEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};
const DAILY_LIMIT = intEnv('AI_DAILY_LIMIT', 20);
const PROMPT_MAX = 4_000;

let verifier = null;
const verify = () => verifier ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });

// 하루 사용량을 한 번 올리고 새 값을 받습니다. 실패는 조용히 넘기지 않고 위로 던집니다.
async function hitDailyLimit(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('ai_usage_store_unavailable');
  const today = new Date().toISOString().slice(0, 10); // UTC 날짜
  const res = await fetch(`${url}/rest/v1/rpc/ai_usage_hit`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_user: userId, p_day: today, p_limit: DAILY_LIMIT }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ai_usage_http_${res.status}`);
  const used = await res.json();
  if (!Number.isSafeInteger(used)) throw new Error('ai_usage_bad_reply');
  return used;
}

const handler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['POST', 'GET'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  let identity;
  try { identity = await verify()(req.headers?.authorization ?? req.headers?.Authorization ?? ''); }
  catch { identity = null; }
  if (!identity) return res.status(401).json({ error: 'UNAUTHORIZED' });

  let used;
  try { used = await hitDailyLimit(identity.userId); }
  catch { return res.status(503).json({ error: 'AI_USAGE_STORE_UNAVAILABLE' }); }
  if (used > DAILY_LIMIT) {
    return res.status(429).json({ error: 'AI_DAILY_LIMIT', limit: DAILY_LIMIT, used });
  }
  if (req.method === 'GET') {
    return res.status(200).json({ limit: DAILY_LIMIT, used, remaining: Math.max(0, DAILY_LIMIT - used) });
  }

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON 형식을 확인하세요.' }); }
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > PROMPT_MAX) return res.status(400).json({ error: 'AI_PROMPT_INVALID' });

  // 외부 AI 연결은 서버 환경변수에만 둡니다. 없으면 성공을 꾸미지 않습니다.
  const proxyUrl = process.env.AI_PROXY_URL;
  const proxyKey = process.env.AI_API_KEY;
  if (!proxyUrl || !proxyKey) {
    return res.status(503).json({ error: 'AI_NOT_CONFIGURED', detail: '서버에 AI 연결 환경변수가 없습니다.' });
  }
  try {
    const upstream = await fetch(proxyUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${proxyKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, model: process.env.AI_MODEL || undefined }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await upstream.text();
    if (!upstream.ok) return res.status(502).json({ error: 'AI_UPSTREAM_FAILED', status: upstream.status });
    let data;
    try { data = JSON.parse(text); } catch { data = { text }; }
    return res.status(200).json({ reply: data, used, limit: DAILY_LIMIT });
  } catch {
    return res.status(503).json({ error: 'AI_UPSTREAM_UNREACHABLE' });
  }
};

export default sessionAuth.wrap(handler);
