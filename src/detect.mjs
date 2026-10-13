// 9단계 탐지 함수: 같은 사용자의 GET 요청이 10분 구간에서 120건을 넘을 때 회수 제안
export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');

  const userEvents = new Map();
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    if (event.method !== 'GET') continue;

    const sub = event.identity?.sub ?? event.subjectId ?? event.subject;
    if (!sub || typeof sub !== 'string' || !sub.trim()) continue;

    const at = new Date(event.at).getTime();
    if (!Number.isFinite(at)) continue;

    const device = event.deviceId ?? event.device ?? event.identity?.deviceId ?? event.identity?.device;
    const isUnusual = event.network === 'unusual' || event.signals?.network === 'unusual';

    if (!userEvents.has(sub)) {
      userEvents.set(sub, []);
    }
    userEvents.get(sub).push({ at, device, isUnusual });
  }

  for (const [sub, records] of userEvents.entries()) {
    records.sort((a, b) => a.at - b.at);

    let left = 0;
    for (let right = 0; right < records.length; right++) {
      while (records[right].at - records[left].at > TEN_MINUTES_MS) {
        left++;
      }
      const countInWindow = right - left + 1;
      const windowRecords = records.slice(left, right + 1);
      const hasUnusualNetwork = windowRecords.some(r => r.isUnusual);

      // 1. 순수 조회 건수: 10분 안에 120건 초과
      // 2. 복합 이상: 평소와 다른 네트워크 + 다량 조회 (20건 초과)
      if (countInWindow > 120 || (hasUnusualNetwork && countInWindow > 20)) {
        const foundDevice = windowRecords.find(r => r.device)?.device;
        const result = {
          action: 'propose_revocation',
          reasonCode: 'burst_read',
          subject: sub,
        };
        if (typeof foundDevice === 'string' && foundDevice.trim()) {
          result.target = foundDevice;
          result.device = foundDevice;
        }
        return result;
      }
    }
  }

  return { action: 'observe' };
}
