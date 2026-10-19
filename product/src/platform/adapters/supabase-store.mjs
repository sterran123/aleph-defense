// 제공 코드. 기본 경로(이미 쓰고 있는 무료 Supabase 프로젝트)의 영속 저장소.
// 먼저 supabase/product_kv.sql 을 내 프로젝트 SQL 편집기에서 한 번 실행하세요.
// 서버(Vercel 함수)에서만 씁니다. 필요한 값: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(내 프로젝트 것, 서버 환경변수에만).
// 브라우저 코드·저장소·화면에는 서비스 키를 절대 넣지 않습니다.
//
// 저장소 약속은 memory-store.mjs 와 같습니다. transaction 은 낙관적 잠금으로 동작합니다.
//   - 트랜잭션 안에서 읽은 행의 판(ver)을 기억해 두고, 끝날 때 쓰기를 한 번에 product_kv_apply 로 보냅니다.
//   - 그 사이 누가 같은 행을 바꿨으면 DB 가 거부하고, 함수 전체를 처음부터 다시 실행합니다(최대 5회).
//   - list() 로 읽은 범위에 새 행이 끼어드는 경우까지는 막지 못합니다. 꼭 필요한 판단은 get() 으로 한 행을 읽고 하세요.
export function createSupabaseStore({ url, serviceKey, projectId, fetchImpl = fetch, maxRetries = 5 }) {
  if (!url || !serviceKey || !projectId) throw new Error('SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY·projectId 가 필요합니다.');
  const base = `${url.replace(/\/+$/u, '')}/rest/v1`;
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
  const enc = encodeURIComponent;

  // 끝까지 나눠 읽습니다. 서버가 한 번에 돌려주는 행 수(Supabase 의 Max rows, 기본 1000)가 PAGE 보다 작아도
  // 실제로 받은 행 수만큼 다음 offset 을 옮기고, 빈 응답(또는 Content-Range 의 전체 개수)에 닿을 때까지 읽습니다.
  // MAX_ROWS 를 넘거나 서버가 진전 없이 같은 자리를 돌려주면 조용히 자르지 않고 오류를 냅니다.
  const PAGE = 1000;
  const MAX_ROWS = 50_000;
  const MAX_REQUESTS = 1_000;
  async function pages(query, select) {
    const out = [];
    let offset = 0;
    for (let n = 0; n < MAX_REQUESTS; n += 1) {
      const res = await fetchImpl(`${base}/product_kv?project_id=eq.${enc(projectId)}${query ? `&${query}` : ''}&select=${select}&order=coll.asc,id.asc&limit=${PAGE}&offset=${offset}`, { headers });
      if (!res.ok) throw new Error(`supabase read ${res.status}`);
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length > PAGE) throw new Error('product_kv_read_invalid');
      if (batch.length === 0) return out;
      // 정렬 순서(coll, id)대로 이어져야 합니다. 앞 쪽과 겹치거나 거꾸로 오면 읽기가 어긋난 것입니다.
      const last = out.at(-1);
      if (last && (batch[0].coll < last.coll || (batch[0].coll === last.coll && batch[0].id <= last.id))) throw new Error('product_kv_read_invalid');
      out.push(...batch);
      if (out.length > MAX_ROWS) throw new Error('product_kv_too_many_rows');
      offset += batch.length;
      const m = /\/(\d+)$/u.exec(res.headers?.get?.('content-range') ?? '');
      if (m && offset >= Number(m[1])) return out;
    }
    throw new Error('product_kv_read_unbounded');
  }
  const rows = query => pages(query, 'coll,id,value,ver');
  async function getRow(coll, id) {
    const out = await rows(`coll=eq.${enc(coll)}&id=eq.${enc(id)}`);
    return out[0] ?? null;
  }
  async function apply(reads, writes) {
    const res = await fetchImpl(`${base}/rpc/product_kv_apply`, {
      method: 'POST', headers, body: JSON.stringify({ p_project: projectId, p_reads: reads, p_writes: writes }),
    });
    if (res.ok) return true;
    const text = await res.text();
    if (text.includes('product_kv_conflict')) return false;
    throw new Error(`supabase write ${res.status}`);
  }

  const store = {
    async get(coll, id) { return (await getRow(coll, id))?.value ?? null; },
    async list(coll) { return (await rows(`coll=eq.${enc(coll)}`)).map(r => ({ id: r.id, value: r.value })); },
    async listCollections() {
      return [...new Set((await pages('', 'coll')).map(r => r.coll))].sort();
    },
    async put(coll, id, value) { return store.transaction(tx => tx.put(coll, id, value)); },
    async delete(coll, id) { return store.transaction(tx => tx.delete(coll, id)); },
    async transaction(fn) {
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const reads = new Map();
        const writes = new Map();
        const key = (c, i) => `${c}\u0000${i}`;
        const tx = {
          async get(coll, id) {
            const k = key(coll, id);
            if (writes.has(k)) return writes.get(k).deleted ? null : structuredClone(writes.get(k).value);
            const row = await getRow(coll, id);
            if (!reads.has(k)) reads.set(k, { coll, id, ver: row?.ver ?? 0 });
            return row ? row.value : null;
          },
          async list(coll) {
            const map = new Map((await store.list(coll)).map(r => [r.id, r.value]));
            for (const [k, w] of writes) { const [c, id] = k.split('\u0000'); if (c === coll) { if (w.deleted) map.delete(id); else map.set(id, w.value); } }
            return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, value]) => ({ id, value }));
          },
          async put(coll, id, value) { writes.set(key(coll, id), { coll, id, value: structuredClone(value) }); },
          async delete(coll, id) { writes.set(key(coll, id), { coll, id, deleted: true }); },
        };
        const result = await fn(tx);
        if (!writes.size) return result;
        const ok = await apply([...reads.values()], [...writes.values()].map(w => ({ coll: w.coll, id: w.id, value: w.deleted ? null : w.value, deleted: Boolean(w.deleted) })));
        if (ok) return result;
      }
      throw new Error('product_kv_conflict: 다시 시도 횟수를 넘었습니다');
    },
  };
  return store;
}
