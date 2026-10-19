// 제공 코드. 3단계에서 붙인 Supabase 로그인을 그대로 쓰는 어댑터(기본 경로, 무료 플랜으로 충분).
// 서버에서만 씁니다. 필요한 값: SUPABASE_URL, SUPABASE_ANON_KEY(공개 키). 서비스 키는 쓰지 않습니다.
//   login(email, password) → { accessToken, expiresIn, userId }   실패 시 null
//   verify(accessToken)    → { userId }                             실패 시 null
export function createSupabaseAuth({ url, anonKey, fetchImpl = fetch }) {
  if (!url || !anonKey) throw new Error('SUPABASE_URL 과 SUPABASE_ANON_KEY 를 서버 환경변수로 넣으세요.');
  const base = url.replace(/\/+$/u, '');
  return {
    async login(email, password) {
      const res = await fetchImpl(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (!body?.access_token || !body?.user?.id) return null;
      return { accessToken: body.access_token, expiresIn: body.expires_in ?? 3600, userId: body.user.id };
    },
    async verify(token) {
      if (typeof token !== 'string' || token.length < 10) return null;
      const res = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const user = await res.json();
      return user?.id ? { userId: user.id } : null;
    },
  };
}
