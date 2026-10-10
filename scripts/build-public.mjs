import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const stalePublicData = resolve(publicDir, 'data.json');
const identityFile = resolve(publicDir, 'aleph.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
  throw new Error('aleph.config.json의 step을 확인하세요.');
}
await mkdir(publicDir, { recursive: true });
await rm(stalePublicData, { force: true });
console.log('공개 정적 자료 파일이 배포에 포함되지 않도록 확인했습니다.');
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(identityFile, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
} else {
  await rm(identityFile, { force: true });
}
