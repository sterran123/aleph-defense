// 제공 코드. 제공 플랫폼 파일의 해시 목록(PLATFORM_SHA256SUMS)을 확인합니다.
//   node scripts/platform-sums.mjs          → 지금 파일이 목록과 같은지 확인(다르면 종료 코드 1)
// 심판도 제출 커밋에서 같은 방법으로 확인합니다. 제공 파일을 고치면 집행 기록 판정이 "미검증"이 됩니다.
// 고칠 일이 있으면 직접 고치지 말고 운영진에게 알려 주세요. 목록을 다시 만드는 --write 는 제공자만 씁니다.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPlatformFiles, sha256Bytes, PLATFORM_SUMS_FILE } from '../vendor/defense-product-contracts/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const PLATFORM_PATHS = ['src/platform', 'api', 'vendor', 'scripts/serve-local.mjs', 'scripts/test-identities.mjs', 'scripts/platform-sums.mjs'];

function walk(p) {
  const abs = join(root, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [p];
  return readdirSync(abs).sort().flatMap(name => walk(relative(root, join(abs, name)).split(sep).join('/')));
}

const files = PLATFORM_PATHS.flatMap(walk).sort();
if (process.argv.includes('--write')) {
  writeFileSync(join(root, PLATFORM_SUMS_FILE), files.map(f => `${sha256Bytes(readFileSync(join(root, f)))}  ${f}`).join('\n') + '\n');
  console.log(`${PLATFORM_SUMS_FILE}: ${files.length}개 파일`);
} else {
  const sums = existsSync(join(root, PLATFORM_SUMS_FILE)) ? readFileSync(join(root, PLATFORM_SUMS_FILE), 'utf8') : '';
  const r = await verifyPlatformFiles(sums, async f => (existsSync(join(root, f)) ? readFileSync(join(root, f)) : null));
  const listed = new Set(sums.split('\n').filter(Boolean).map(l => l.slice(66)));
  const extra = files.filter(f => !listed.has(f));
  if (r.ok && extra.length === 0) console.log(`제공 파일 ${listed.size}개가 목록과 같습니다.`);
  else {
    console.log('제공 파일이 목록과 다릅니다.');
    for (const f of r.changed) console.log(`  바뀜: ${f}`);
    for (const f of r.missing) console.log(`  없음: ${f}`);
    for (const f of extra) console.log(`  목록에 없는 파일: ${f}`);
    if (r.code) console.log(`  목록 형식 오류: ${r.code}`);
    process.exitCode = 1;
  }
}
