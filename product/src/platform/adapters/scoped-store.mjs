// 제공 코드. 시험 실행마다 자료를 따로 두는 저장소 감싸기.
// 심판 시험(X-Aleph-Run-Id 가 붙은 요청)은 모음 이름 앞에 'run:<실행ID>/' 를 붙인 별도 공간을 씁니다.
// 그래서 시험이 정책을 바꾸거나 사건을 넣어도 내 실제 자료와 섞이지 않습니다.
// 로그인 계정(auth_users)과 역할(roles)만 실제 공간을 함께 씁니다.
export const SHARED_COLLECTIONS = Object.freeze(['auth_users', 'roles']);

export function scopeStore(store, prefix) {
  const name = coll => (SHARED_COLLECTIONS.includes(coll) ? coll : `${prefix}${coll}`);
  const wrap = s => ({
    get: (coll, id) => s.get(name(coll), id),
    list: coll => s.list(name(coll)),
    put: (coll, id, value) => s.put(name(coll), id, value),
    delete: (coll, id) => s.delete(name(coll), id),
  });
  return {
    ...wrap(store),
    transaction: fn => store.transaction(tx => fn(wrap(tx))),
    async listCollections() {
      return (await store.listCollections()).filter(c => c.startsWith(prefix)).map(c => c.slice(prefix.length));
    },
    prefix,
  };
}
