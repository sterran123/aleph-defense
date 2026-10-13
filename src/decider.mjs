// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// deviceRegistered는 엔진 확인값만 사용하며 브라우저 입력·키·역할은 신뢰하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered']);

// judge_fixture is virtual input only; absent or unclear signals get no normal-value defaults.
function readJudgeFixtureSignals(request) {
  const signals = request?.signals;
  const events = request?.recentEvents;
  if (!signals || signals.source !== 'judge_fixture'
      || Object.keys(signals).sort().join(',') !== 'hour,network,region,source'
      || typeof signals.region !== 'string' || !signals.region.trim() || signals.region === 'unknown'
      || typeof signals.network !== 'string' || !signals.network.trim() || signals.network === 'unknown'
      || !Number.isInteger(signals.hour) || signals.hour < 0 || signals.hour > 23
      || !Array.isArray(events) || events.length > 12) return null;

  const validEvents = events.every(event => event && typeof event === 'object'
    && !Array.isArray(event)
    && Object.keys(event).sort().join(',') === 'ageSeconds,count,kind'
    && typeof event.kind === 'string'
    && Number.isFinite(event.ageSeconds) && event.ageSeconds >= 0
    && Number.isInteger(event.count) && event.count >= 0);
  if (!validEvents) return null;

  return { region: signals.region, network: signals.network, hour: signals.hour, events };
}

export async function decide(request) {
  const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
  const registered = request?.schema === 'aleph.decision.v1'
    && request.deviceRegistered === true;

  return {
    schema: 'aleph.decision.v1',
    requestId,
    decision: registered ? 'allow' : 'deny',
    reasonCode: registered ? 'approved' : 'device_not_registered',
    ruleIds: [RULE_IDS[0]],
  };
}
