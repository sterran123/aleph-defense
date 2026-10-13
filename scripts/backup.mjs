// 10단계 로컬 연습 도구: 로컬 가상 금고(local-vault.json)의 사본을 해시 지문과 함께 저장합니다.
// 서버 배포물과 무관하게 저장소 안에서 백업 절차를 연습할 때만 씁니다.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vaultFile = join(root, 'local-vault.json');
const backupDir = join(root, 'backups');
const snapshotFile = join(backupDir, 'notes-snapshot.json');
const manifestFile = join(backupDir, 'notes-snapshot.sha256');

const sha256 = value => createHash('sha256').update(value).digest('hex');

let rows;
if (existsSync(vaultFile)) {
  rows = JSON.parse(readFileSync(vaultFile, 'utf8'));
  if (!Array.isArray(rows)) {
    console.error('local-vault.json은 메모 배열이어야 합니다.');
    process.exit(1);
  }
} else {
  // 연습용 가상 자료 — 실제 자료가 없을 때만 사용합니다.
  rows = [
    { id: 'demo-1', owner: 'demo', title: '가상 메모 1', content: 'sample content 1' },
    { id: 'demo-2', owner: 'demo', title: '가상 메모 2', content: 'sample content 2' },
  ];
  writeFileSync(vaultFile, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  console.log('local-vault.json을 가상 자료로 새로 만들었습니다.');
}

const snapshot = {
  schema: 'vault-backup.v1',
  createdAt: new Date().toISOString(),
  notes: rows.map(row => ({ ...row, contentHash: sha256(String(row.content ?? '')) })),
};
mkdirSync(backupDir, { recursive: true });
writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
writeFileSync(manifestFile, `${sha256(readFileSync(snapshotFile, 'utf8'))}  notes-snapshot.json\n`, 'utf8');

console.log(`백업 저장: ${snapshotFile}`);
console.log(`지문 파일: ${manifestFile}`);
console.log(`버전 ${snapshot.createdAt} · 메모 ${snapshot.notes.length}건`);
