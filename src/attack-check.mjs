// 제출 격리 환경은 요청 기록을 제공하지 않습니다. 기록으로 대조할 수 없는 점검은
// 성공을 계산하지 않고 observed를 not_run으로만 둡니다. 토큰·개인키·메모 본문은
// 어떤 경우에도 결과에 넣지 않습니다.
export async function runAttackChecks(config) {
  if (!Number.isInteger(config.step) || config.step < 3 || config.step > 12) throw new Error('3~12단계 공격 점검은 배포 주소와 유효한 단계 설정이 필요합니다.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }

  const results = [
    { attackId: 'static_notes_file', expected: '/data.json is absent from the deployed static files',
      observed: 'not_run' },
    { attackId: 'anonymous_notes_api', expected: 'No-token API requests return JSON 401 or 403',
      observed: 'not_run' },
    { attackId: 'invalid_bearer_token', expected: 'Malformed bearer tokens return JSON 401 or 403',
      observed: 'not_run' },
    { attackId: 'anonymous_note_item', expected: 'No-token item reads return JSON 401 or 403',
      observed: 'not_run' },
    { attackId: 'invalid_announcement_write', expected: 'Malformed bearer tokens cannot read announcements and return JSON 401 or 403',
      observed: 'not_run' },
    { attackId: 'deployment_identity', expected: `The deployment identity reports step ${config.step}`,
      observed: 'not_run' },
    { attackId: 'nosniff_header', expected: 'The first-page response includes X-Content-Type-Options: nosniff',
      observed: 'not_run' },
  ];
  if (config.step >= 10) {
    const restoreRoute = typeof config.restoreRoute === 'string' && config.restoreRoute.startsWith('/')
      ? config.restoreRoute : '/api/notes/restore';
    const auditRoute = typeof config.auditRoute === 'string' && config.auditRoute.startsWith('/')
      ? config.auditRoute : '/api/notes/audit';
    results.push(
      { attackId: 'restore_anonymous', expected: `No-token requests to ${restoreRoute} return JSON 401 or 403`,
        observed: 'not_run' },
      { attackId: 'restore_invalid_token', expected: 'Malformed bearer tokens cannot trigger restore and return JSON 401 or 403',
        observed: 'not_run' },
      { attackId: 'audit_anonymous', expected: `No-token requests to ${auditRoute} return JSON 401 or 403`,
        observed: 'not_run' },
      { attackId: 'restore_strict_anonymous', expected: 'Requests to /api/restore/notes/:id without a token return JSON 401 or 403',
        observed: 'not_run' },
      { attackId: 'operations_anonymous', expected: 'GET /api/operations without a token returns JSON 401 or 403',
        observed: 'not_run' },
    );
  }
  if (config.step >= 11) {
    results.push(
      { attackId: 'webapp_manifest', expected: 'GET /manifest.webmanifest returns an installable manifest',
        observed: 'not_run' },
      { attackId: 'device_approval_anonymous', expected: 'No-token device approval requests return JSON 401 or 403',
        observed: 'not_run' },
    );
  }
  return results;
}
