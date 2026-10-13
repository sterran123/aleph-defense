// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// deviceRegistered는 엔진 확인값만 사용하며 브라우저 입력·키·역할은 신뢰하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

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
    && typeof event.kind === 'string' && event.kind.length > 0
    && Number.isFinite(event.ageSeconds) && event.ageSeconds >= 0
    && Number.isInteger(event.count) && event.count >= 0);
  if (!validEvents) return null;

  return { region: signals.region, network: signals.network, hour: signals.hour, events };
}

function hasCompositeAnomaly(signals) {
  if (!signals) return false;
  const unusualHour = signals.hour < 6 || signals.hour >= 22;
  const firstSeenNetwork = signals.network === 'unusual';
  const suddenBulkRead = signals.events.some(event => event.kind === 'risk_signal'
    && event.ageSeconds <= 300 && event.count >= 20);
  return unusualHour && firstSeenNetwork && suddenBulkRead;
}

function hasRecentStepUp(stepUp) {
  return Boolean(stepUp && typeof stepUp === 'object' && !Array.isArray(stepUp)
    && Object.keys(stepUp).sort().join(',') === 'authAgeSeconds,verified'
    && stepUp.verified === true
    && Number.isInteger(stepUp.authAgeSeconds)
    && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= 900);
}

export async function decide(request) {
  const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
  const registered = request?.schema === 'aleph.decision.v1'
    && request.deviceRegistered === true;
  const signalSource = request?.signals?.source;
  const signals = readJudgeFixtureSignals(request);
  const sourceUnclear = signalSource !== 'none' && signals === null;
  const needsStepUp = sourceUnclear || hasCompositeAnomaly(signals);
  const stepUpRequired = registered && needsStepUp && !hasRecentStepUp(request?.stepUp);

  return {
    schema: 'aleph.decision.v1',
    requestId,
    decision: !registered ? 'deny' : stepUpRequired ? 'step_up' : 'allow',
    reasonCode: !registered ? 'device_not_registered'
      : stepUpRequired ? 'step_up_required' : 'approved',
    ruleIds: [stepUpRequired ? RULE_IDS[1] : RULE_IDS[0]],
  };
}
