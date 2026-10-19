// 제공 코드. 심판 시험(X-Aleph-Run-Id 가 붙은 요청)에서 대응을 "제공자 집행 서비스"로 보내는 어댑터.
//
// 시험 중에는 차단을 내 서버 안에서 집행하지 않고, 심판이 띄운 집행 서비스에 요청합니다.
// 집행 서비스는 실제 집행할 때마다 순번과 해시 사슬로 기록을 남기고(aleph.product.executor-log.v1),
// 심판은 그 기록으로 "같은 작업 키가 정확히 한 번 집행됐는지"를 확인합니다. 학생 코드는 이 기록에 쓸 수 없습니다.
//
// 약속은 로컬 집행기(executor.mjs)와 같습니다. apply · release · status · isBlocked.
// - 429·503 은 ExecutorError(status) 로, 응답을 받지 못하면 ExecutorError(null, { uncertain: true }) 로 알립니다.
// - status·isBlocked 가 응답을 못 받으면 ExecutorError(503) 를 던집니다(집행 서비스 장애는 심판이 미검증으로 처리합니다).
//
// 설정: 집행 서비스 주소는 서버 환경변수 ALEPH_EXECUTOR_URL 로만 받습니다(요청 머리글로 주소를 바꿀 수 없음).
// 이용권(grant)은 심판이 실행마다 X-Aleph-Executor-Grant 머리글로 보냅니다. 내 PC 에서 직접 시험할 때는 ALEPH_EXECUTOR_TOKEN 을 씁니다.
// 주소나 이용권이 없으면 플랫폼은 로컬 집행기를 그대로 씁니다. 내 PC 개발·공개 시험에는 영향이 없습니다.
import { ExecutorError } from './executor.mjs';

const TIMEOUT_MS = 5000;

export function createRemoteExecutor({ url, token, runId, fetchImpl = (...a) => fetch(...a), timeoutMs = TIMEOUT_MS }) {
  const base = new URL(url);
  if (!/^https?:$/u.test(base.protocol) || !token || !runId) throw new Error('remote_executor_config');
  const headers = { authorization: `Bearer ${token}`, 'x-aleph-run-id': runId, 'content-type': 'application/json' };
  const target = path => new URL(path, base.href.endsWith('/') ? base.href : `${base.href}/`).href;

  async function call(method, path, body, { uncertainOnLoss }) {
    let res;
    try {
      res = await fetchImpl(target(path), { method, headers, redirect: 'error', cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw uncertainOnLoss ? new ExecutorError(null, { uncertain: true }) : new ExecutorError(503);
    }
    let json = null;
    try { json = await res.json(); } catch {
      if (res.ok) throw uncertainOnLoss ? new ExecutorError(null, { uncertain: true }) : new ExecutorError(503);
    }
    if (res.ok) return json;
    const ra = Number(res.headers.get('retry-after'));
    throw new ExecutorError(res.status, { retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null });
  }

  return {
    async apply({ operationKey, target: t, action }) {
      await call('POST', 'apply', { operationKey, target: t, action }, { uncertainOnLoss: true });
      return { status: 200 };
    },
    async release({ operationKey, target: t }) {
      await call('POST', 'release', { operationKey, target: t }, { uncertainOnLoss: true });
      return { status: 200 };
    },
    async status(operationKey) {
      const out = await call('GET', `status?operationKey=${encodeURIComponent(operationKey)}`, undefined, { uncertainOnLoss: false });
      return ['applied', 'released'].includes(out?.state) ? out.state : 'unknown';
    },
    /** 심판이 정한 시험 시계 차이(ms). 플랫폼이 요청마다 한 번 읽어 ctx.clock 에 더합니다. */
    async clockOffset() {
      const out = await call('GET', 'clock', undefined, { uncertainOnLoss: false });
      if (!Number.isSafeInteger(out?.offsetMs) || out.offsetMs < 0) throw new ExecutorError(503);
      return out.offsetMs;
    },
    async isBlocked(t) {
      const out = await call('GET', `blocked?target=${encodeURIComponent(t)}`, undefined, { uncertainOnLoss: false });
      return out?.blocked === true;
    },
  };
}

/** 플랫폼 진입점이 쓰는 고르기 함수. 실행 공간이고 설정이 있으면 원격, 아니면 로컬. */
export function executorFactory({ env = process.env, local, fetchImpl } = {}) {
  return (store, { runId = null, grant = null } = {}) => {
    const token = grant ?? env.ALEPH_EXECUTOR_TOKEN;
    return runId && env.ALEPH_EXECUTOR_URL && token
      ? createRemoteExecutor({ url: env.ALEPH_EXECUTOR_URL, token, runId, fetchImpl })
      : local(store);
  };
}
