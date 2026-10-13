import { RESOURCE_IDS, resourceIdForDecisionRequest } from './resource-ids.mjs';

// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// deviceRegistered는 엔진 확인값만 사용하며 브라우저 입력·키·역할은 신뢰하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required', 'resource_zone']);

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

function hasVerifiedAccessContext(request) {
  return ['classId', 'projectId', 'subjectId'].every(key =>
    typeof request?.[key] === 'string' && request[key].trim().length > 0 && request[key].length <= 256)
    && typeof request?.deviceId === 'string' && /^[0-9a-f]{16}$/u.test(request.deviceId);
}

function hasZoneAccess(request, resourceId) {
  if (!hasVerifiedAccessContext(request)) return false;
  return resourceId === RESOURCE_IDS.notes;
}

export async function decide(request) {
  const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
  const registered = request?.schema === 'aleph.decision.v1'
    && request.deviceRegistered === true;
  const resourceId = resourceIdForDecisionRequest(request);
  const resourceAllowed = hasZoneAccess(request, resourceId);
  const resourceDenied = !resourceAllowed;
  const signalSource = request?.signals?.source;
  const signals = readJudgeFixtureSignals(request);
  const sourceUnclear = signalSource !== 'none' && signals === null;
  const needsStepUp = sourceUnclear || hasCompositeAnomaly(signals);
  const stepUpRequired = registered && !resourceDenied
    && needsStepUp && !hasRecentStepUp(request?.stepUp);
  const decision = !registered || resourceDenied ? 'deny' : stepUpRequired ? 'step_up' : 'allow';
  // The repository has no registered zone-denial code. Keep the access decision
  // as deny, reuse the already exercised escalation code, and return a distinct
  // 403 reason from the final API boundary.
  const reasonCode = !registered ? 'device_not_registered'
    : resourceDenied ? 'resource_zone'
      : stepUpRequired ? 'step_up_required' : 'approved';
  const ruleIds = !registered ? ['device_registered']
    : resourceDenied ? ['resource_zone']
      : stepUpRequired ? ['resource_zone', 'step_up_required']
        : ['device_registered', 'resource_zone'];

  return { schema: 'aleph.decision.v1', requestId, decision, reasonCode, ruleIds };
}
