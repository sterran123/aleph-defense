import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPolicySnapshot, diffTestPolicy, restoreTestPolicy } from '../src/policy-restore.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const snapshotPath = resolve(root, 'backups/step10/safe-policy.json');
const hashPath = resolve(root, 'backups/step10/safe-policy.sha256');
const currentPath = resolve(root, 'test/fixtures/step10-current-policy.json');
const outputPath = resolve(root, 'artifacts/step10-restored-policy.json');

const [command = 'plan', confirmation = ''] = process.argv.slice(2);
const snapshotText = await readFile(snapshotPath, 'utf8').catch(() => { throw new Error('안전 정책 사본이 없어 중단했습니다.'); });
const expectedHash = (await readFile(hashPath, 'utf8').catch(() => { throw new Error('안전 정책 검증 해시가 없어 중단했습니다.'); })).trim();
const snapshot = verifyPolicySnapshot(snapshotText, expectedHash);
const current = JSON.parse(await readFile(currentPath, 'utf8'));
const plan = diffTestPolicy(snapshot, current);
console.log(JSON.stringify({ mode: 'plan', ...plan }, null, 2));

if (command === 'plan') process.exit(0);
if (command !== 'apply') throw new Error('plan 또는 apply만 사용할 수 있습니다.');
const confirmedVersion = confirmation.startsWith('--confirm=') ? confirmation.slice(10) : '';
const { restored } = restoreTestPolicy(snapshot, current, confirmedVersion);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(restored, null, 2) + '\n');
console.log(`시험 정책 복원 결과: ${outputPath}`);
