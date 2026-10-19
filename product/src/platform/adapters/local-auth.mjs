// 제공 코드. 내 PC 에서 돌릴 때 쓰는 로그인 어댑터(무료 대체 경로).
// 이미 Supabase 로그인을 쓰고 있다면 supabase-auth.mjs 를 쓰세요. 두 어댑터는 같은 약속을 지킵니다.
//   login(email, password) → { accessToken, expiresIn, userId }   실패 시 null
//   verify(accessToken)    → { userId }                             실패 시 null
// 비밀번호는 scrypt 로 바꾼 값만 저장합니다. 토큰은 서버 비밀값(PRODUCT_TOKEN_SECRET)으로 서명합니다.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, randomUUID } from 'node:crypto';

const b64u = buf => Buffer.from(buf).toString('base64url');

export function createLocalAuth({ store, secret, ttlSeconds = 3600, clock = () => Date.now() }) {
  if (!secret || secret.length < 32) throw new Error('PRODUCT_TOKEN_SECRET 는 32자 이상이어야 합니다.');
  const sign = body => b64u(createHmac('sha256', secret).update(body).digest());

  return {
    async createUser(email, password) {
      const salt = randomBytes(16);
      const hash = scryptSync(password, salt, 32);
      const userId = randomUUID();
      await store.put('auth_users', email.toLowerCase(), { userId, salt: b64u(salt), hash: b64u(hash) });
      return { userId };
    },
    async removeUser(email) { await store.delete('auth_users', email.toLowerCase()); },
    async login(email, password) {
      if (typeof email !== 'string' || typeof password !== 'string') return null;
      const row = await store.get('auth_users', email.toLowerCase());
      if (!row) return null;
      const got = scryptSync(password, Buffer.from(row.salt, 'base64url'), 32);
      if (!timingSafeEqual(got, Buffer.from(row.hash, 'base64url'))) return null;
      const exp = Math.floor(clock() / 1000) + ttlSeconds;
      const body = b64u(JSON.stringify({ sub: row.userId, exp }));
      return { accessToken: `${body}.${sign(body)}`, expiresIn: ttlSeconds, userId: row.userId };
    },
    async verify(token) {
      if (typeof token !== 'string') return null;
      const [body, sig] = token.split('.');
      if (!body || !sig) return null;
      const want = Buffer.from(sign(body));
      const have = Buffer.from(sig);
      if (want.length !== have.length || !timingSafeEqual(want, have)) return null;
      let claims;
      try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
      if (!claims?.sub || !Number.isFinite(claims.exp) || claims.exp * 1000 <= clock()) return null;
      return { userId: claims.sub };
    },
  };
}
