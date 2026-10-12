const BLOCK_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'unsigned_service_from_temp_path', techniques: ['T1543'], confidence: 0.96,
    signals: [/서명 없는.{0,40}서비스/iu, /(?:임시 폴더|\\Temp\\)/iu],
  }),
  Object.freeze({
    id: 'unknown_task_outside_hours', techniques: ['T1053'], confidence: 0.95,
    signals: [/처음 보는 예약 작업/iu, /임시 폴더/iu, /수업 시간 밖/iu],
  }),
  Object.freeze({
    id: 'unlisted_startup_program', techniques: ['T1543'], confidence: 0.92,
    signals: [/시작 폴더/iu, /목록에 없는 프로그램/iu],
  }),
  Object.freeze({
    id: 'repeated_unsigned_service_registration', techniques: ['T1543'], confidence: 0.95,
    signals: [/서명 없는 서비스 등록/iu, /연속.{0,12}\d+건/iu],
  }),
  Object.freeze({
    id: 'random_task_from_temp_path', techniques: ['T1053'], confidence: 0.94,
    signals: [/예약 작업 이름이 임의 문자열/iu, /임시 폴더/iu],
  }),
  Object.freeze({
    id: 'unsigned_service_binary_change', techniques: ['T1543'], confidence: 0.96,
    signals: [/서비스 실행 파일이 바뀌었고 서명이 없습니다/iu],
  }),
  Object.freeze({
    id: 'paired_startup_and_task_path', techniques: ['T1543', 'T1053'], confidence: 0.97,
    signals: [/시작 프로그램과 예약 작업이 같은 임시 파일/iu],
  }),
  Object.freeze({
    id: 'unknown_service_survives_restart', techniques: ['T1543'], confidence: 0.95,
    signals: [/평소 목록에 없는 서비스/iu, /다시 켜도 남도록 등록/iu],
  }),
]);
const REVIEW_CONFIDENCE = 0.62;
const SAFE_ROUTINE = /평소\s*시각|기존 수업 도구 서비스|서명된 채로|읽기만|정의 업데이트.{0,30}평소 저장소|기존 예약 작업.{0,30}자료 복사|로그인했습니다|로그아웃했습니다|자료실 화면이 열렸습니다/iu;
const WEAK_PERSISTENCE = /서비스|예약 작업|시작 폴더|시작 항목|임시 폴더|실행 파일|서명|시작 프로그램/iu;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function hasAnyTechnique(alert, techniques) {
  return Array.isArray(alert?.rule?.mitre)
    && alert.rule.mitre.some((item) => techniques.includes(item));
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
  const evidence = `${description}\n${textOf(data.path)}\n${textOf(data.serviceName)}\n${textOf(data.taskName)}`;
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const agentName = textOf(alert?.agent?.name);
  const techniques = Array.isArray(alert?.rule?.mitre) ? alert.rule.mitre : [];
  const relevant = hasAnyTechnique(alert, ['T1543', 'T1053']);

  if (!agentName || !relevant) return result('record', 0.05, 'insufficient_evidence');

  const strong = BLOCK_PATTERNS.find((pattern) => level >= 10
    && pattern.techniques.some((technique) => techniques.includes(technique))
    && pattern.signals.every((signal) => signal.test(evidence)));
  if (strong) return result('block', strong.confidence, strong.id);

  if (SAFE_ROUTINE.test(evidence)) return result('record', 0.05, 'known_routine_activity');

  if (level >= 5 && WEAK_PERSISTENCE.test(evidence)) {
    return result('alert', REVIEW_CONFIDENCE, 'weak_persistence_change_review');
  }

  return result('record', 0.05, 'insufficient_evidence');
}
