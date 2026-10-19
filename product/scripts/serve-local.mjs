// 제공 코드. 내 PC 에서 제품을 띄웁니다(무료 대체 경로). 127.0.0.1 에서만 열립니다.
//   npm run start:local            → http://127.0.0.1:8787/ (시작 화면), /api/product/v1/health
// 자료는 .data/product.json 에 저장되고, 서버를 껐다 켜도 남습니다.
// 토큰 서명용 비밀값은 처음 켤 때 .data/secret 에 만들어 둡니다(저장소에 올리지 마세요. .gitignore 에 있음).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createHandler } from '../src/platform/handler.mjs';
import { createFileStore } from '../src/platform/adapters/file-store.mjs';
import { createLocalAuth } from '../src/platform/adapters/local-auth.mjs';
import { createLocalExecutor } from '../src/platform/adapters/executor.mjs';
import { executorFactory } from '../src/platform/adapters/remote-executor.mjs';
import * as product from '../src/product/index.mjs';

const port = Number(process.env.PORT || 8787);
mkdirSync('.data', { recursive: true });
if (!existsSync('.data/secret')) writeFileSync('.data/secret', randomBytes(32).toString('base64url'), { mode: 0o600 });
const secret = process.env.PRODUCT_TOKEN_SECRET || readFileSync('.data/secret', 'utf8').trim();
const store = createFileStore('.data/product.json');
const auth = createLocalAuth({ store, secret });
const projectId = process.env.PRODUCT_PROJECT_ID || 'local-project';
const handle = createHandler({ product, auth, store, executor: executorFactory({ local: s => createLocalExecutor({ store: s }) }), projectId, commit: process.env.PRODUCT_COMMIT || 'local' });

createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/console.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(readFileSync(new URL('../public/console.html', import.meta.url)));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = null;
  if (raw) { try { body = JSON.parse(raw); } catch { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }); return res.end('{"error":{"code":"json_invalid","detail":""}}'); } }
  const out = await handle({ method: req.method, path: req.url, headers: req.headers, body });
  res.writeHead(out.status, out.headers);
  res.end(JSON.stringify(out.body));
}).listen(port, '127.0.0.1', () => console.log(`제품 서버: http://127.0.0.1:${port}/ (시작 화면) · /api/product/v1/health (프로젝트 ${projectId})`));
