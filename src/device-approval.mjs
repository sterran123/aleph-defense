import { randomUUID } from 'node:crypto';
import { createLoginVerifier } from './verify-login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOKIE = '__Host-device-id';

function cookieDeviceId(req) {
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 20000) return null;
  for (const item of raw.split(';')) {
    const [name, ...rest] = item.trim().split('=');
    if (name !== COOKIE) continue;
    try { const value = decodeURIComponent(rest.join('=')); return UUID.test(value) ? value : null; } catch { return null; }
  }
  return null;
}
const requestCode = deviceId => deviceId ? deviceId.slice(0, 8).toLowerCase() : null;

function database(env, config) {
  const base = new URL(env.SUPABASE_URL);
  if (base.protocol !== 'https:' || base.username || base.password
      || base.origin + '/auth/v1' !== config.identityProvider.issuer || !env.SUPABASE_SECRET_KEY) throw new Error();
  return new URL('/rest/v1/device_approvals', base);
}

async function approvalRow({ req, identity, config, env, fetchImpl }) {
  const deviceId = cookieDeviceId(req);
  if (!deviceId) return { deviceId: null, row: null };
  const url = database(env, config);
  url.searchParams.set('select', 'status,requested_at,approved_at');
  url.searchParams.set('owner_id', 'eq.' + identity.userId);
  url.searchParams.set('device_id', 'eq.' + deviceId);
  const response = await fetchImpl(url, { method: 'GET', headers: { apikey: env.SUPABASE_SECRET_KEY }, redirect: 'error' });
  if (!response.ok) throw new Error();
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 1) throw new Error();
  return { deviceId, row: rows[0] ?? null };
}

export function createDeviceApproval({ config, env = process.env,
  fetchImpl = (...args) => fetch(...args), verifierFactory = createLoginVerifier } = {}) {
  let verify;
  const identity = authorization => (verify ??= verifierFactory({ config,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY }))(authorization);

  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const error = (status, message) => res.status(status).json({ error: message });
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return error(405, '허용되지 않은 요청입니다.'); }
    let owner;
    try { owner = await identity(req.headers?.authorization); } catch { return error(503, '기기 승인 서버 설정을 확인하세요.'); }
    if (!UUID.test(owner?.userId ?? '')) return error(401, '로그인이 필요합니다.');
    try {
      let state = await approvalRow({ req, identity: owner, config, env, fetchImpl });
      if (req.method === 'GET') return res.status(200).json({
        approved: state.row?.status === 'approved', status: state.row?.status ?? 'not_requested',
        requestCode: requestCode(state.deviceId),
      });
      let body = req.body;
      try { if (typeof body === 'string') body = JSON.parse(body); } catch { return error(400, 'JSON 형식을 확인하세요.'); }
      if (body?.action !== 'request' || Object.keys(body).some(key => key !== 'action')) {
        return error(400, '기기 승인 요청을 확인하세요.');
      }
      if (!state.deviceId) {
        state = { deviceId: randomUUID(), row: null };
        res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(state.deviceId)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`);
      }
      if (!state.row) {
        const url = database(env, config);
        const response = await fetchImpl(url, {
          method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ owner_id: owner.userId, device_id: state.deviceId, status: 'pending' }), redirect: 'error',
        });
        if (!response.ok) throw new Error();
      }
      const alreadyApproved = state.row?.status === 'approved';
      return res.status(alreadyApproved ? 200 : 202).json({ approved: alreadyApproved,
        status: alreadyApproved ? 'approved' : 'pending', requestCode: requestCode(state.deviceId) });
    } catch { return error(503, '기기 승인 상태를 확인할 수 없습니다.'); }
  };

  const guard = next => async (req, res) => {
    // 운영 엔진·심판이 검증한 Bearer 요청은 기존 계약을 유지하고, 브라우저 쿠키 세션만 서버 승인표를 재검사합니다.
    if (req.authSource === 'bearer') return next(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const owner = await identity(req.headers?.authorization);
      if (!UUID.test(owner?.userId ?? '')) return res.status(401).json({ error: '로그인이 필요합니다.' });
      const state = await approvalRow({ req, identity: owner, config, env, fetchImpl });
      if (state.row?.status !== 'approved') return res.status(403).json({ error: '서버에서 승인한 기기만 자료를 열 수 있습니다.' });
      req.deviceRegistered = true;
      return next(req, res);
    } catch { return res.status(503).json({ error: '기기 승인 상태를 확인할 수 없습니다.' }); }
  };
  return { handler, guard };
}
