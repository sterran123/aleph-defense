// 제공 코드. 대응(D3)을 내 서버의 보호 자원에 실제로 집행하는 어댑터.
//
// 집행기 약속:
//   apply({ operationKey, target, action })   → { status: 200 }  · 실패하면 ExecutorError 를 던집니다.
//   release({ operationKey, target })         → { status: 200 }
//   status(operationKey)                       → 'applied' | 'released' | 'unknown'
//   isBlocked(target)                          → true | false     (보호 자원이 요청마다 확인)
//
// 집행기는 같은 작업을 두 번 받아도 막아 주지 않습니다. 한 번만 집행하는 책임은 학생 업무 코드에 있습니다.
// 응답을 받지 못한 경우(uncertain)에는 집행됐을 수도 있으니, 다시 보내기 전에 status() 로 확인하세요.
export class ExecutorError extends Error {
  constructor(status, { uncertain = false, retryAfterMs = null } = {}) {
    super(`executor ${status ?? 'no-response'}`);
    this.name = 'ExecutorError';
    this.status = status;
    this.uncertain = uncertain;
    this.retryAfterMs = retryAfterMs;
  }
}

export const BLOCK_ACTIONS = Object.freeze(['block_subject', 'block_device']);

export function createLocalExecutor({ store, clock = () => Date.now() }) {
  const log = []; // 실제로 일어난 집행 기록(시험이 읽습니다)
  return {
    log,
    async apply({ operationKey, target, action }) {
      if (!BLOCK_ACTIONS.includes(action)) throw new ExecutorError(422);
      await store.transaction(async tx => {
        await tx.put('blocks', target, { operationKey, action, at: new Date(clock()).toISOString() });
        await tx.put('executions', operationKey, { state: 'applied', target, action });
      });
      log.push({ kind: 'apply', operationKey, target, action });
      return { status: 200 };
    },
    async release({ operationKey, target }) {
      await store.transaction(async tx => {
        const row = await tx.get('blocks', target);
        if (row && row.operationKey === operationKey) await tx.delete('blocks', target);
        await tx.put('executions', operationKey, { state: 'released', target });
      });
      log.push({ kind: 'release', operationKey, target });
      return { status: 200 };
    },
    async status(operationKey) {
      return (await store.get('executions', operationKey))?.state ?? 'unknown';
    },
    async isBlocked(target) {
      return Boolean(await store.get('blocks', target));
    },
  };
}

/**
 * 연습·시험용 고장 주입. plan 은 apply 호출마다 차례로 쓸 동작 목록입니다.
 *   'ok'       정상 집행
 *   'busy'     집행하지 않고 503
 *   'limited'  집행하지 않고 429 (retryAfterMs 포함)
 *   'timeout'  집행하지 않고 응답 없음(uncertain)
 *   'lost'     집행은 했지만 응답이 사라짐(uncertain)
 *   'denied'   집행하지 않고 403
 * plan 을 다 쓰면 그 뒤로는 'ok' 입니다.
 */
export function withFaults(executor, plan = []) {
  const steps = [...plan];
  return {
    ...executor,
    async apply(op) {
      const step = steps.shift() ?? 'ok';
      if (step === 'busy') throw new ExecutorError(503);
      if (step === 'limited') throw new ExecutorError(429, { retryAfterMs: 1500 });
      if (step === 'timeout') throw new ExecutorError(null, { uncertain: true });
      if (step === 'denied') throw new ExecutorError(403);
      const out = await executor.apply(op);
      if (step === 'lost') throw new ExecutorError(null, { uncertain: true });
      return out;
    },
  };
}
