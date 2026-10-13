// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// deviceRegistered는 엔진 확인값만 사용하며 브라우저 입력·키·역할은 신뢰하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered']);

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
