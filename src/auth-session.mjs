import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';

const names = ['__Host-notes-access', '__Host-notes-refresh'];
// 요청 쿠키에서 허용된 세션 쿠키만 추출합니다.
function cookies(req) {
  const out = {};
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 20000) return out;
  for (const entry of raw.split(';')) {
    const index = entry.indexOf('=');
    const name = entry.slice(0, index).trim();
    if (!names.includes(name)) continue;
    try { out[name] = decodeURIComponent(entry.slice(index + 1)); } catch {}
  }
  return out;
}
// 보안 속성을 갖춘 세션 쿠키를 설정하거나 만료시킵니다.
function setCookies(res, session) {
  const tokens = session ? [session.access_token, session.refresh_token] : ['', ''];
  res.setHeader('Set-Cookie', names.map((name, i) => `${name}=${encodeURIComponent(tokens[i])}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${session ? (i ? 604800 : Math.min(session.expires_in ?? 3600, 3600)) : 0}`));
}
// 공식 SDK와 기존 토큰 검증 도우미를 연결해 서버 인증 처리기를 만듭니다.
export function createSessionAuth({ config, authConfig, env = process.env,
  clientFactory = createClient, verifierFactory = createLoginVerifier } = {}) {
  let verify;
  // 토큰 검증기를 필요할 때 한 번 만들고 재사용합니다.
  const verifier = () => verify ??= verifierFactory({ config, supabaseSecretKey: env.SUPABASE_SECRET_KEY });
  // 발급자 설정을 확인하고 서버용 Supabase Auth 클라이언트를 만듭니다.
  const client = () => {
    if (authConfig.projectUrl + '/auth/v1' !== config.identityProvider.issuer) throw new Error();
    return clientFactory(authConfig.projectUrl,
      env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLIC_KEY || authConfig.publishableKey,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  };
  // 요청의 출처가 설정된 자료실 주소와 같은지 확인합니다.
  const sameOrigin = req => req.headers?.origin === new URL(config.publicAppUrl).origin;
  // 세션을 검증하고 필요하면 공식 SDK로 갱신한 토큰을 다시 검증합니다.
  async function tokenFromCookie(req, res) {
    const jar = cookies(req);
    const access = jar[names[0]], refresh = jar[names[1]];
    if (access && await verifier()(`Bearer ${access}`)) return access;
    if (!refresh) return null;
    const { data, error } = await client().auth.refreshSession({ refresh_token: refresh });
    if (error || !data?.session || !await verifier()(`Bearer ${data.session.access_token}`)) {
      setCookies(res, null); return null;
    }
    setCookies(res, data.session); return data.session.access_token;
  }
  // 로그인 상태·로그인·로그아웃 요청을 처리합니다.
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const fail = (status, error) => res.status(status).json({ error });
    try {
      if (req.method === 'GET') {
        const token = await tokenFromCookie(req, res);
        return res.status(200).json({ authenticated: !!token });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return fail(405, '허용되지 않은 요청입니다.'); }
      if (!sameOrigin(req)) return fail(403, '같은 사이트에서 요청하세요.');
      let body = req.body;
      try { if (typeof body === 'string') body = JSON.parse(body); } catch { return fail(400, 'JSON 형식을 확인하세요.'); }
      if (body?.action === 'login') {
        if (typeof body.email !== 'string' || !body.email.trim() || body.email.length > 320
            || typeof body.password !== 'string' || !body.password || body.password.length > 4096) return fail(400, '이메일과 비밀번호를 입력하세요.');
        const { data, error } = await client().auth.signInWithPassword({ email: body.email.trim(), password: body.password });
        if (error || !data?.session) {
          const reason = error?.code === 'email_not_confirmed' ? '이메일 확인을 먼저 완료하세요.'
            : error?.code === 'invalid_credentials' ? '이메일 또는 비밀번호가 올바르지 않습니다.' : '로그인할 수 없습니다. 계정 설정을 확인하세요.';
          return fail(401, reason);
        }
        if (!await verifier()(`Bearer ${data.session.access_token}`)) return fail(401, '로그인 토큰을 확인할 수 없습니다.');
        setCookies(res, data.session);
        return res.status(200).json({ authenticated: true });
      }
      if (body?.action === 'logout') {
        const jar = cookies(req);
        try {
          if (jar[names[0]] && jar[names[1]]) {
            const sdk = client();
            const session = await sdk.auth.setSession({ access_token: jar[names[0]], refresh_token: jar[names[1]] });
            if (!session.error) await sdk.auth.signOut({ scope: 'local' });
          }
        } finally { setCookies(res, null); }
        return res.status(200).json({ authenticated: false });
      }
      return fail(400, '로그인 또는 로그아웃 요청을 확인하세요.');
    } catch { return fail(503, '로그인 서버 설정을 확인하세요.'); }
  };
  // 쿠키 인증을 기존 API 검증에 연결하고 변경 요청의 출처를 검사합니다.
  const wrap = next => async (req, res) => {
    // 심판·엔진이 보낸 검증된 Bearer 요청은 기존 계약을 그대로 유지합니다.
    if (req.headers?.authorization) { req.authSource = 'bearer'; return next(req, res); }
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(403).json({ error: '같은 사이트에서 요청하세요.' });
    }
    try {
      const token = await tokenFromCookie(req, res);
      if (token) { req.headers = { ...req.headers, authorization: `Bearer ${token}` }; req.authSource = 'cookie'; }
      return next(req, res);
    } catch { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); return res.status(503).json({ error: '로그인 서버 설정을 확인하세요.' }); }
  };
  return { handler, wrap };
}
