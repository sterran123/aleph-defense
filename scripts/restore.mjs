// 10단계 로컬 연습 도구: 사본을 다시 읽어 지문을 검증한 뒤 local-vault.json을 되돌립니다.
// 사본이 없거나 지문이 맞지 않으면 아무것도 쓰지 않고 멈춥니다.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vaultFile = join(root, 'local-vault.json');
const backupDir = join(root, 'backups');
const snapshotFile = join(backupDir, 'notes-snapshot.json');
const manifestFile = join(backupDir, 'notes-snapshot.sha256');
const auditFile = join(backupDir, 'audit.log');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const audit = line => appendFileSync(auditFile, `${new Date().toISOString()} ${line}\n`, 'utf8');

if (!existsSync(snapshotFile) || !existsSync(manifestFile)) {
  console.error('저장된 사본이 없습니다. npm run backup을 먼저 실행하세요.');
  process.exit(1);
}

// 사본을 다시 읽어 지문을 검증합니다. 손댄 사본은 거부합니다.
const snapshotText = readFileSync(snapshotFile, 'utf8');
const manifest = readFileSync(manifestFile, 'utf8').trim().split(/\s+/u)[0];
if (sha256(snapshotText) !== manifest) {
  audit('restore refused: snapshot fingerprint mismatch');
  console.error('사본 지문이 맞지 않습니다. 복원을 중단합니다.');
  process.exit(1);
}
const snapshot = JSON.parse(snapshotText);
if (snapshot.schema !== 'vault-backup.v1' || !Array.isArray(snapshot.notes)) {
  audit('restore refused: snapshot schema invalid');
  console.error('사본 형식이 올바르지 않습니다. 복원을 중단합니다.');
  process.exit(1);
}
const badNote = snapshot.notes.find(note => note.contentHash !== sha256(String(note.content ?? '')));
if (badNote) {
  audit(`restore refused: note ${badNote.id} hash mismatch`);
  console.error(`사본 안 ${badNote.id}의 내용 지문이 맞지 않습니다. 복원을 중단합니다.`);
  process.exit(1);
}

// 실행 전에 버전과 바뀔 항목을 보여 줍니다.
const current = existsSync(vaultFile) ? JSON.parse(readFileSync(vaultFile, 'utf8')) : [];
const byId = new Map(current.map(row => [row.id, row]));
const changed = snapshot.notes.filter(note => {
  const live = byId.get(note.id);
  return !live || live.title !== note.title || String(live.content ?? '') !== String(note.content);
});
console.log(`사본 버전: ${snapshot.createdAt} · 메모 ${snapshot.notes.length}건`);
console.log(`바뀔 항목 ${changed.length}건: ${changed.map(n => n.id).join(', ') || '(없음)'}`);

if (process.argv.includes('--yes') !== true && changed.length > 0) {
  console.log('실제로 쓰려면 npm run restore -- --yes 를 실행하세요. 지금은 미리보기만 했습니다.');
  audit(`restore preview: ${changed.length} change(s), not applied`);
  process.exit(0);
}

writeFileSync(vaultFile, `${JSON.stringify(snapshot.notes.map(({ contentHash, ...rest }) => rest), null, 2)}\n`, 'utf8');
audit(`restore applied: version ${snapshot.createdAt}, changed ${changed.length}`);
console.log(`복원 완료. 감사 기록: ${auditFile}`);
