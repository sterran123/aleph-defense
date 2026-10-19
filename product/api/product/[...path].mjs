// 제공 코드. Vercel 서버 함수 진입점(기본 경로). /api/product/v1/* 요청을 핸들러로 넘깁니다.
// 기존 자료실 저장소의 api/ 폴더에 이 파일을 복사해 쓰거나, 기존 서버 함수에서 createHandler 를 불러 연결하세요.
// 서버 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PRODUCT_PROJECT_ID
import { createHandler } from '../../src/platform/handler.mjs';
import { createSupabaseAuth } from '../../src/platform/adapters/supabase-auth.mjs';
import { createSupabaseStore } from '../../src/platform/adapters/supabase-store.mjs';
import { createLocalExecutor } from '../../src/platform/adapters/executor.mjs';
import { executorFactory } from '../../src/platform/adapters/remote-executor.mjs';
import * as product from '../../src/product/index.mjs';

let handle;
function build() {
  const env = process.env;
  const store = createSupabaseStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, projectId: env.PRODUCT_PROJECT_ID });
  const auth = createSupabaseAuth({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
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
