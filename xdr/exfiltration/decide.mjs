const BLOCK_PATTERNS = Object.freeze([
  Object.freeze({ id: 'large_unfamiliar_destination', confidence: 0.96, signal: /처음 보는 목적지|처음 보는 주소|낯선 목적지|외부 주소|처음 보는 목적지 두 곳/iu }),
  Object.freeze({ id: 'after_hours_archive_transfer', confidence: 0.95, signal: /업무 시간 밖.{0,30}압축 파일|업무 시간 밖.{0,30}전송/iu }),
  Object.freeze({ id: 'repeated_large_transfer', confidence: 0.94, signal: /(?:\d+번|여러 번|반복).{0,20}전송|전송.{0,20}(?:\d+번|반복)|연속으로/iu }),
  Object.freeze({ id: 'unusual_protocol_bulk_transfer', confidence: 0.93, signal: /쓰지 않던 포트|낯선 포트|명령 통로/iu }),
  Object.freeze({ id: 'bulk_archive_or_repository_copy', confidence: 0.96, signal: /자료 묶음|자료실 전체|압축 파일 \d+개|같은 압축 파일/iu }),
]);
const BLOCK_BYTES = 50_000_000;
const ALERT_CONFIDENCE = 0.62;
const WEAK_TRANSFER_SIGNAL = /전송량|처음 보는|낯선|압축 파일|압축|파일 수|자료 \d+건|읽힌 뒤|백업처럼|실패|아직 없습니다|명령 통로|다른 주소|외부 전송|평소보다/iu;
const ROUTINE_DESTINATIONS = new Set(['192.0.2.10', '198.51.100.10']);

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function nonnegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function hasRelevantTechnique(alert) {
  return Array.isArray(alert?.rule?.mitre)
    && alert.rule.mitre.some((item) => item === 'T1041' || item === 'T1048');
}

function result(action, confidence, reason) {
  return { action, confidence, reason };
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return result('record', 0.05, 'insufficient_evidence');
  }

  const description = textOf(alert?.rule?.description);
  const data = alert?.data && typeof alert.data === 'object' ? alert.data : {};
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const bytes = nonnegativeNumber(data.bytes);
  const sourceAddress = textOf(data.srcip);
  const destinationAddress = textOf(data.dstip);
  const relevant = hasRelevantTechnique(alert);
  if (!relevant || !sourceAddress) return result('record', 0.05, 'insufficient_evidence');

  const strong = BLOCK_PATTERNS.find((pattern) => level >= 10
    && bytes >= BLOCK_BYTES
    && destinationAddress.length > 0
    && pattern.signal.test(description));
  if (strong) return result('block', strong.confidence, strong.id);

  const routineDestination = ROUTINE_DESTINATIONS.has(destinationAddress)
    && bytes <= 100_000
    && /수업 자료 주소|자료실 주소/iu.test(description)
    && /동기화가 끝났습니다|정상적으로 끝났습니다/iu.test(description);
  if (routineDestination) return result('record', 0.05, 'known_routine_destination');

  if (WEAK_TRANSFER_SIGNAL.test(description)) {
    return result('alert', ALERT_CONFIDENCE, 'unusual_transfer_review');
  }

  return result('record', 0.05, 'insufficient_evidence');
}
