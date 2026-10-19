// 제공 코드 시험. 서버 행 제한이 PAGE 보다 작을 때 뒤 자료를 놓치지 않는지 확인합니다(Codex #247 재현).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../../src/platform/adapters/supabase-store.mjs';

function fixture({ total, maxRows, contentRange = 'exact', stuck = false }) {
  const all = Array.from({ length: total }, (_, i) => ({ coll: 'f', id: `row-${String(i + 1).padStart(5, '0')}`, value: i + 1, ver: 1 }));
  const requests = [];
  const fetchImpl = async input => {
    const u = new URL(String(input));
    const offset = stuck ? 0 : Number(u.searchParams.get('offset') || 0);
    const limit = Number(u.searchParams.get('limit'));
    requests.push(offset);
    const batch = all.slice(offset, offset + Math.min(limit, maxRows));
    const range = contentRange === 'exact' ? `${offset}-${offset + batch.length - 1}/${total}` : contentRange === 'star' ? `${offset}-${offset + batch.length - 1}/*` : null;
    return { ok: true, status: 200, headers: { get: n => (n.toLowerCase() === 'content-range' ? range : null) }, json: async () => batch };
  };
  return { store: createSupabaseStore({ url: 'https://fixture.supabase.co', serviceKey: 'fixture-only', projectId: 'qa', fetchImpl }), requests };
}

test('서버 행 제한 100, 전체 205 → 205개를 모두 읽는다(Codex 재현 입력)', async () => {
  const { store, requests } = fixture({ total: 205, maxRows: 100 });
  const got = await store.list('f');
  assert.equal(got.length, 205);
  assert.equal(got.at(-1).id, 'row-00205');
  assert.deepEqual(requests, [0, 100, 200]);
});

test('Content-Range 전체 개수가 없거나 * 이면 빈 응답이 올 때까지 읽는다', async () => {
  for (const contentRange of ['star', 'none']) {
    const { store, requests } = fixture({ total: 205, maxRows: 100, contentRange });
    assert.equal((await store.list('f')).length, 205, contentRange);
    assert.deepEqual(requests, [0, 100, 200, 205]);
  }
});

test('행 제한이 PAGE 이상이거나 딱 나누어떨어져도 빠짐·겹침이 없다', async () => {
  for (const [total, maxRows] of [[2500, 1000], [2000, 1000], [0, 1000], [300, 100], [1, 1]]) {
    const { store } = fixture({ total, maxRows });
    const got = await store.list('f');
    assert.equal(got.length, total, `${total}/${maxRows}`);
    assert.equal(new Set(got.map(r => r.id)).size, total);
  }
});

test('상한을 넘거나 서버가 진전 없이 같은 자리를 돌려주면 자르지 않고 오류', async () => {
  await assert.rejects(fixture({ total: 50_001, maxRows: 1000 }).store.list('f'), /product_kv_too_many_rows/u);
  await assert.rejects(fixture({ total: 300, maxRows: 100, contentRange: 'none', stuck: true }).store.list('f'), /product_kv_read_invalid/u);
});
