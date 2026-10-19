// 제공 코드. 내 PC 에서 돌리는 영속 저장소(무료 대체 경로).
// 메모리 저장소와 같은 약속을 지키고, 트랜잭션이 반영될 때마다 JSON 파일에 통째로 저장합니다.
// 임시 파일에 먼저 쓰고 이름을 바꿔 덮어쓰므로, 저장 도중 꺼져도 예전 파일이 남습니다.
// 서버를 다시 켜면 파일에서 그대로 읽어 옵니다.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMemoryStore } from './memory-store.mjs';

export function createFileStore(file) {
  const initial = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const store = createMemoryStore(initial);
  store.onCommit = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(store.snapshot()), 'utf8');
    renameSync(tmp, file);
  };
  return store;
}
