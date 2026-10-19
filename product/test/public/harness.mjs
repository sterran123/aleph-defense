// 공개 시험용 준비 도구(제공 코드). 메모리 저장소·로컬 로그인·고장 주입 집행기로 내 업무 코드를 HTTP 계약대로 부릅니다.
// 심판 시험은 같은 계약에 새 값·새 순서를 넣습니다. 이 공개 시험의 값에 맞춘 코드는 통과하지 못합니다.
import { randomUUID } from 'node:crypto';
import { createMemoryStore } from '../../src/platform/adapters/memory-store.mjs';
import { createLocalAuth } from '../../src/platform/adapters/local-auth.mjs';
import { createLocalExecutor, withFaults } from '../../src/platform/adapters/executor.mjs';
import { createHandler } from '../../src/platform/handler.mjs';
import { scopeStore } from '../../src/platform/adapters/scoped-store.mjs';

export const PROJECT_ID = 'proj-public-test';
const implPath = process.env.PRODUCT_IMPL ? new URL(process.env.PRODUCT_IMPL, `file://${process.cwd()}/`).href : new URL('../../src/product/index.mjs', import.meta.url).href;
export const product = await import(implPath);

/** 시험 환경 하나를 만듭니다. faults: 집행기 고장 순서(withFaults 참고) */
export async function setup({ faults = [], startMs = Date.parse('2026-10-20T00:00:00.000Z') } = {}) {
  let now = startMs;
  const clock = () => now;
  const slept = [];
  const sleep = async ms => { slept.push(ms); now += ms; };
  const store = createMemoryStore();
  const auth = createLocalAuth({ store, secret: 'public-test-secret-public-test-secret!!', clock });
  const runId = randomUUID();
  const space = scopeStore(store, `run:${runId}/`);
  const base = createLocalExecutor({ store: space, clock });
  const executor = withFaults(base, faults);
  const handle = createHandler({ product, auth, store, executor: () => executor, projectId: PROJECT_ID, commit: 'test', clock, sleep });

  const users = {};
  for (const [name, role] of [['A', 'member'], ['B', 'member'], ['OP', 'operator']]) {
    const email = `${name.toLowerCase()}@test.local`;
    const password = `pw-${randomUUID()}`;
    const { userId } = await auth.createUser(email, password);
    if (role === 'operator') await store.put('roles', userId, { role });
    const login = await handle({ method: 'POST', path: '/api/product/v1/auth/login', body: { email, password } });
    users[name] = { userId, token: login.body.accessToken };
  }

  const call = (who, method, path, body = null) => handle({
    method, path: `/api/product/v1${path}`, body,
    headers: { authorization: `Bearer ${users[who].token}`, 'x-aleph-run-id': runId },
  });

  /** 정책을 초안→활성화까지 한 번에. rules 와 지금 판 번호를 받습니다. */
  async function activate(rules, expectedRevision) {
    const snapshot = { schema: 'aleph.product.policy.v1', projectId: PROJECT_ID, revision: expectedRevision + 1, rules };
    const d = await call('OP', 'POST', '/policy/drafts', { snapshot });
    if (d.status !== 201) throw new Error(`draft ${d.status} ${JSON.stringify(d.body)}`);
    const a = await call('OP', 'POST', '/policy/activate', { draftId: d.body.draftId, expectedRevision });
    if (a.status !== 200) throw new Error(`activate ${a.status} ${JSON.stringify(a.body)}`);
    return a.body;
  }

  return { store: space, rootStore: store, executor, baseExecutor: base, handle, call, users, runId, clock, slept, activate, advance: ms => { now += ms; } };
}

/** 결정적 의사 난수(시드 고정) */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
