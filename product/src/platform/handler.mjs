// 제공 코드. HTTP 계약(docs/defense/product-v6/HTTP_CONTRACT_r2.md)의 경로를 학생 업무 함수에 연결합니다.
// 이 파일은 로그인 확인·경로 연결·오류 본문만 맡습니다. 권한 판단·정책·사건·대응·복구는 src/product/ 의 학생 코드가 합니다.
// 프레임워크 없이 { method, path, headers, body } → { status, headers, body } 로 동작합니다.
import { ProductError, badRequest, unauthorized, notFound } from './errors.mjs';
import { CONTRACTS_VERSION } from '../../vendor/defense-product-contracts/index.mjs';
import { scopeStore } from './adapters/scoped-store.mjs';

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }, body });
const lower = h => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

// executor 는 (저장소, { runId }) => 집행기 함수입니다. 실행 공간마다 따로 만들어 둡니다.
// 심판 시험(runId 있음)에서는 제공자 집행 서비스로 보내는 원격 집행기를 고를 수 있습니다(adapters/remote-executor.mjs).
export function createHandler({ product, auth, store, executor: executorFor, projectId, commit = 'unknown', clock = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), startedAt = new Date().toISOString() }) {
  async function actorOf(headers) {
    const m = /^Bearer (.+)$/u.exec(headers.authorization ?? '');
    if (!m) return null;
    const who = await auth.verify(m[1]);
    if (!who) return null;
    const roleRow = await store.get('roles', who.userId);
    return { userId: who.userId, role: roleRow?.role === 'operator' ? 'operator' : 'member' };
  }

  function decisionHeaders(d) {
    if (!d) return {};
    return {
      'x-aleph-decision': d.decision,
      'x-aleph-rule-ids': (d.ruleIds ?? []).join(','),
      'x-aleph-policy-revision': String(d.revision ?? ''),
      'x-aleph-policy-digest': d.digest ?? '',
    };
  }

  const spaces = new Map();
  function spaceOf(runId, grant = null) {
    const key = `${runId ?? ''}|${grant ?? ''}`;
    if (!spaces.has(key)) {
      const s = runId ? scopeStore(store, `run:${runId}/`) : store;
      spaces.set(key, { store: s, executor: executorFor(s, { runId: runId ?? null, grant: runId ? grant : null }) });
    }
    return spaces.get(key);
  }

  // 그 실행 공간의 시험 자료만 지웁니다. 감사 기록(audit)은 남깁니다. 실제 공간·계정·역할은 건드리지 않습니다.
  async function resetTestRun(runId) {
    const { store: s } = spaceOf(runId);
    let removed = 0;
    for (const coll of await s.listCollections()) {
      if (coll === 'audit') continue;
      const rows = await s.list(coll);
      await s.transaction(async tx => { for (const { id } of rows) { await tx.delete(coll, id); removed += 1; } });
    }
    for (const key of [...spaces.keys()]) if (key.startsWith(`${runId}|`)) spaces.delete(key);
    return { removed };
  }

  return async function handle({ method, path, headers: rawHeaders = {}, body = null }) {
    const headers = lower(rawHeaders);
    try {
      const url = new URL(path, 'http://product.local');
      const p = url.pathname.replace(/\/+$/u, '');
      const prefix = '/api/product/v1';
      if (!p.startsWith(prefix)) throw notFound();
      const route = p.slice(prefix.length) || '/';
      const runId = headers['x-aleph-run-id'];
      if (runId !== undefined && !RUN_ID.test(runId)) throw badRequest('run_id_invalid');
      // 심판이 실행마다 주는 집행 서비스 이용권. 실행 공간에서만 쓰고, 학생 업무 코드에는 넘기지 않습니다.
      const grant = headers['x-aleph-executor-grant'];
      if (grant !== undefined && (runId === undefined || !/^[A-Za-z0-9._~-]{16,512}$/u.test(grant))) throw badRequest('executor_grant_invalid');

      if (method === 'GET' && route === '/health') {
        return json(200, { schema: 'aleph.product.health.v1', contracts: CONTRACTS_VERSION, projectId, commit, startedAt });
      }
      if (method === 'POST' && route === '/auth/login') {
        const out = await auth.login(body?.email, body?.password);
        if (!out) throw unauthorized('login_failed');
        return json(200, { accessToken: out.accessToken, expiresIn: out.expiresIn });
      }

      const actor = await actorOf(headers);
      if (!actor) throw unauthorized();
      const space = spaceOf(runId ?? null, grant ?? null);
      // 심판 시험(이용권 있음)에서는 제공자가 정한 시험 시계를 씁니다. 업무 코드는 언제나 ctx.clock() 으로 시각을 읽으세요.
      let ctxClock = clock;
      if (grant && typeof space.executor.clockOffset === 'function') {
        let offset;
        try { offset = await space.executor.clockOffset(); } catch { throw new ProductError(503, 'executor_unavailable'); }
        ctxClock = () => clock() + offset;
      }
      const ctx = { projectId, actor, store: space.store, executor: space.executor, clock: ctxClock, sleep, runId: runId ?? null };
      const seg = route.split('/').filter(Boolean).map(decodeURIComponent);

      // 로그인한 본인 확인(제공). 심판이 대응 대상(subject:<userId>)을 만들 때 씁니다.
      if (route === '/me' && method === 'GET') return json(200, { userId: actor.userId, role: actor.role });

      // D1 정책
      if (route === '/policy' && method === 'GET') return json(200, await product.getPolicy(ctx));
      if (route === '/policy/history' && method === 'GET') return json(200, await product.policyHistory(ctx, { limit: Number(url.searchParams.get('limit')) || 50 }));
      if (route === '/policy/drafts' && method === 'POST') return json(201, await product.createDraft(ctx, body ?? {}));
      if (route === '/policy/activate' && method === 'POST') return json(200, await product.activatePolicy(ctx, body ?? {}));
      if (route === '/policy/rollback' && method === 'POST') return json(200, await product.rollbackPolicy(ctx, body ?? {}));

      // 보호 자원
      if (seg[0] === 'resources' && seg.length === 3 && method === 'GET') {
        const out = await product.readResource(ctx, { zone: seg[1], id: seg[2] });
        return json(out.status, out.body, decisionHeaders(out.decision));
      }
      if (seg[0] === 'resources' && seg.length === 2 && method === 'POST') {
        const out = await product.writeResource(ctx, { zone: seg[1], body: body ?? {} });
        return json(out.status, out.body, decisionHeaders(out.decision));
      }

      // D2 사건
      if (route === '/events' && method === 'POST') return json(200, await product.ingestEvents(ctx, body ?? {}));
      if (route === '/events' && method === 'GET') {
        const q = Object.fromEntries(url.searchParams);
        if (q.limit) q.limit = Number(q.limit);
        return json(200, await product.queryEvents(ctx, q));
      }
      if (route === '/incidents' && method === 'GET') return json(200, await product.listIncidents(ctx));
      if (seg[0] === 'incidents' && seg.length === 2 && method === 'GET') return json(200, await product.getIncident(ctx, seg[1]));

      // D3 대응
      if (route === '/responses' && method === 'POST') {
        const out = await product.createResponse(ctx, body ?? {});
        return json(out.status, out.body);
      }
      if (seg[0] === 'responses' && seg.length === 3 && method === 'POST') {
        const fn = { approve: product.approveResponse, reject: product.rejectResponse, release: product.releaseResponse }[seg[2]];
        if (!fn) throw notFound();
        return json(200, await fn(ctx, seg[1]));
      }
      if (seg[0] === 'responses' && seg.length === 2 && method === 'GET') return json(200, await product.getResponse(ctx, seg[1]));

      // D4 백업·복구
      if (route === '/backups' && method === 'POST') return json(200, await product.createBackup(ctx, body ?? {}));
      if (route === '/restore' && method === 'POST') return json(200, await product.restoreBackup(ctx, body ?? {}));

      // 시험 자료 정리(제공)
      if (route === '/test/reset' && method === 'POST') {
        if (actor.role !== 'operator') throw new ProductError(403, 'forbidden');
        if (!ctx.runId) throw badRequest('run_id_required');
        return json(200, await resetTestRun(ctx.runId));
      }
      throw notFound();
    } catch (error) {
      if (error instanceof ProductError) return json(error.status, { error: { code: error.code, detail: error.detail } });
      return json(500, { error: { code: 'internal', detail: '서버 오류' } });
    }
  };
}
