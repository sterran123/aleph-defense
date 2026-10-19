// 4차 방어전 제품 API 진입점. 기존 배포(aleph-defense-three)에 얹는 얇은 연결입니다.
// 실제 구현은 product/ 키트에 있고, 제공 코드(product/src/platform/)가 로그인·역할·경로·저장소를 담당합니다.
// 서버 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PRODUCT_PROJECT_ID
import { createHandler } from '../../product/src/platform/handler.mjs';
import { createSupabaseAuth } from '../../product/src/platform/adapters/supabase-auth.mjs';
import { createSupabaseStore } from '../../product/src/platform/adapters/supabase-store.mjs';
import { createLocalExecutor } from '../../product/src/platform/adapters/executor.mjs';
import { executorFactory } from '../../product/src/platform/adapters/remote-executor.mjs';
import * as product from '../../product/src/product/index.mjs';

let handle;
function build() {
  const env = process.env;
  const store = createSupabaseStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, projectId: env.PRODUCT_PROJECT_ID });
  const auth = createSupabaseAuth({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY });
  return createHandler({ product, auth, store, executor: executorFactory({ local: s => createLocalExecutor({ store: s }) }), projectId: env.PRODUCT_PROJECT_ID, commit: env.VERCEL_GIT_COMMIT_SHA ?? 'unknown' });
}

export default async function vercelHandler(req, res) {
  handle ??= build();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = null;
  if (raw) { try { body = JSON.parse(raw); } catch { res.statusCode = 400; res.setHeader('content-type', 'application/json; charset=utf-8'); return res.end('{"error":{"code":"json_invalid","detail":""}}'); } }
  const out = await handle({ method: req.method, path: req.url, headers: req.headers, body });
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(JSON.stringify(out.body));
}
