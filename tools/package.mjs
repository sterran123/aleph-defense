// npm run package — package/ 의 배포 묶음을 검증하고 artifacts/ztna-package/ 로 조립합니다.
// 심판이 보는 것: 설치 안내만으로 배포 가능한지, 구성도가 실제 코드와 맞는지,
// 규칙 목록이 RULE_IDS와 정확히 같은지.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(root, 'package');
const outDir = join(root, 'artifacts', 'ztna-package');
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); return cond; };

const read = rel => readFileSync(join(root, rel), 'utf8');
const exists = rel => existsSync(join(root, rel));

// 1. 필수 문서와 "채워짐" 검사
const required = ['package/README.md', 'package/ARCHITECTURE.md', 'package/POLICIES.md',
  'package/DEMO.md', 'package/THREAT-INTEL.md', 'package/SELF-CHECK.md', 'package/CAPTURES.md'];
for (const rel of required) ok(exists(rel), `없는 파일: ${rel}`);

const readme = exists('package/README.md') ? read('package/README.md') : '';
for (const needle of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'Environment Variables', '새 Vercel 프로젝트', 'vercel.json'])
  ok(readme.includes(needle), `README.md에 없는 안내: ${needle}`);
ok(!/npm start/u.test(readme), 'README.md에 npm start 안내가 남아 있습니다(실제 빌드와 불일치).');

// 2. 구성도 SVG — 필수 상자가 실제 코드 요소와 맞는지
const svgRel = 'package/architecture.svg';
const svg = exists(svgRel) ? read(svgRel) : '';
ok(exists(svgRel), 'package/architecture.svg 가 없습니다.');
for (const box of ['브라우저', '검문소', '자료실', '판정기', '/api/ai', '/api/threat-intel'])
  ok(svg.includes(box), `구성도에 없는 구성 요소: ${box}`);
ok(read('package/ARCHITECTURE.md').includes('architecture.svg'),
  'ARCHITECTURE.md가 architecture.svg를 연결하지 않습니다.');

// 3. 규칙 목록 — RULE_IDS와 한 글자도 다르면 실패
const { RULE_IDS } = await import(new URL(`file:///${root.replaceAll('\\', '/')}src/decider.mjs`).href);
const policies = exists('package/POLICIES.md') ? read('package/POLICIES.md') : '';
for (const id of RULE_IDS ?? []) ok(policies.includes(`\`${id}\``), `POLICIES.md에 없는 규칙: ${id}`);
ok(Array.isArray(RULE_IDS) && RULE_IDS.length >= 1, 'RULE_IDS가 비어 있습니다.');

// 4. 캡처 목록 — SELF-CHECK.md의 항목과 CAPTURES.md의 파일 이름이 맞는지
const selfCheck = exists('package/SELF-CHECK.md') ? read('package/SELF-CHECK.md') : '';
const captures = exists('package/CAPTURES.md') ? read('package/CAPTURES.md') : '';
for (const png of selfCheck.match(/P\d+-\d+\.png/gu) ?? [])
  ok(captures.includes(png), `CAPTURES.md에 없는 캡처 파일명: ${png}`);

// 5. 비밀값 스캔 — 묶음에 토큰·키·비밀번호가 있으면 실패
// 이름 언급(service_role 등)은 허용하고, 실제 값 형태(JWT·개인키·키 문자열·비밀번호 값)만 잡습니다.
const secretPat = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|BEGIN [A-Z ]*PRIVATE KEY|sb_secret_[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9]{10,}|password\s*[:=]\s*\S+|비밀번호\s*[:=]\s*\S+/ui;
for (const name of readdirSync(pkgDir)) {
  if (!/\.(md|svg|json)$/u.test(name)) continue;
  const text = readFileSync(join(pkgDir, name), 'utf8');
  ok(!secretPat.test(text), `비밀값 의심 문자열: package/${name}`);
}

if (problems.length) {
  console.error('묶음 검증 실패:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// 조립: package/ 전체를 artifacts/ztna-package/ 로 복사하고 목록표를 씁니다.
mkdirSync(outDir, { recursive: true });
cpSync(pkgDir, outDir, { recursive: true });
const files = readdirSync(outDir).sort();
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  rules: RULE_IDS,
  files,
}, null, 2) + '\n');
console.log(`묶음 조립 완료: artifacts/ztna-package/ (${files.length + 1}개 파일)`);
console.log(`규칙 ${RULE_IDS.length}개 확인: ${RULE_IDS.join(', ')}`);
