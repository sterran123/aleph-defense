// 제공 코드. 메모리 저장소(시험·연습용). 서버를 다시 켜면 내용이 사라집니다.
// 저장소 약속(모든 저장 어댑터 공통):
//   get(coll, id) → 값 또는 null
//   put(coll, id, value) · delete(coll, id)
//   list(coll) → [{ id, value }]  (id 순)
//   listCollections() → 비어 있지 않은 모음 이름 목록
//   transaction(async tx => { ... }) → tx 안의 쓰기는 함수가 끝까지 성공해야 함께 반영되고,
//     예외가 나면 하나도 반영되지 않습니다. 트랜잭션은 한 번에 하나씩 차례로 실행됩니다.
// 값은 반영할 때 깊은 복사합니다. 꺼낸 값을 고쳐도 저장된 값은 바뀌지 않습니다.

const clone = v => (v === undefined ? undefined : structuredClone(v));

export function createMemoryStore(initial = {}) {
  let data = new Map(Object.entries(initial).map(([coll, rows]) => [coll, new Map(Object.entries(rows).map(([id, v]) => [id, clone(v)]))]));
  let queue = Promise.resolve();

  const view = (base, writes) => ({
    async get(coll, id) {
      const key = `${coll}\u0000${id}`;
      if (writes && writes.has(key)) return clone(writes.get(key).value ?? null);
      return clone(base.get(coll)?.get(id) ?? null);
    },
    async list(coll) {
      const rows = new Map(base.get(coll) ?? []);
      if (writes) for (const [key, w] of writes) {
        const [c, id] = key.split('\u0000');
        if (c !== coll) continue;
        if (w.deleted) rows.delete(id); else rows.set(id, w.value);
      }
      return [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, value]) => ({ id, value: clone(value) }));
    },
  });

  function commit(writes) {
    const next = new Map([...data].map(([c, rows]) => [c, new Map(rows)]));
    for (const [key, w] of writes) {
      const [c, id] = key.split('\u0000');
      if (!next.has(c)) next.set(c, new Map());
      if (w.deleted) next.get(c).delete(id); else next.get(c).set(id, clone(w.value));
    }
    data = next;
  }

  const store = {
    ...view(data, null),
    async get(coll, id) { return view(data, null).get(coll, id); },
    async list(coll) { return view(data, null).list(coll); },
    async put(coll, id, value) { return store.transaction(tx => tx.put(coll, id, value)); },
    async delete(coll, id) { return store.transaction(tx => tx.delete(coll, id)); },
    transaction(fn) {
      const run = async () => {
        const writes = new Map();
        const tx = {
          ...view(data, writes),
          async put(coll, id, value) { writes.set(`${coll}\u0000${id}`, { value: clone(value) }); },
          async delete(coll, id) { writes.set(`${coll}\u0000${id}`, { deleted: true }); },
        };
        const result = await fn(tx);
        commit(writes);
        store.onCommit?.(data);
        return result;
      };
      const p = queue.then(run, run);
      queue = p.catch(() => {});
      return p;
    },
    async listCollections() { return [...data.keys()].filter(c => data.get(c).size > 0).sort(); },
    snapshot() {
      return Object.fromEntries([...data].map(([c, rows]) => [c, Object.fromEntries([...rows].map(([id, v]) => [id, clone(v)]))]));
    },
  };
  return store;
}
