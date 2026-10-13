// Record only status and metadata. Never return tokens, private keys, or note bodies.
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

  const request = async (pathname, authorization, method = 'GET') => {
    try {
      return await fetch(new URL(pathname, app), {
        method,
        headers: authorization ? { Authorization: authorization } : undefined,
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
    } catch {
      return null;
    }
  };
  const sampleItemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const [staticData, anonymousApi, invalidTokenApi, identityResponse, homepage,
    anonymousNoteItem, invalidAnnouncementWrite] = await Promise.all([
    request('/data.json'), request('/api/notes'), request('/api/notes', 'Bearer invalid.invalid.invalid'),
    request('/aleph.json'), request('/'), request(`/api/notes/${sampleItemId}`),
    request(`/api/announcements/${sampleItemId}`, 'Bearer invalid.invalid.invalid', 'PUT'),
  ]);
  const hasJsonError = async (response) => {
    if (!response || ![401, 403].includes(response.status)
        || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return false;
    try {
      const payload = await response.json();
      return typeof payload?.error === 'string' && payload.error.length > 0;
    } catch {
      return false;
    }
  };
  const [anonymousJsonError, invalidTokenJsonError, anonymousItemJsonError, announcementWriteJsonError] = await Promise.all([
    hasJsonError(anonymousApi), hasJsonError(invalidTokenApi),
    hasJsonError(anonymousNoteItem), hasJsonError(invalidAnnouncementWrite),
  ]);
  let identityStep = 'unavailable';
  if (identityResponse?.ok) {
    try {
      const identity = await identityResponse.json();
      if (identity?.schema === 'aleph.defense.deployment.v1') identityStep = identity.step;
    } catch {
      identityStep = 'invalid';
    }
  }
  const nosniff = homepage?.headers.get('x-content-type-options')?.toLowerCase() || 'missing';
  const results = [
    { attackId: 'static_notes_file', expected: '/data.json is absent from the deployed static files',
      observed: `HTTP ${staticData?.status ?? 0}` },
    { attackId: 'anonymous_notes_api', expected: 'No-token API requests return JSON 401 or 403',
      observed: `HTTP ${anonymousApi?.status ?? 0}; JSON error ${anonymousJsonError}` },
    { attackId: 'invalid_bearer_token', expected: 'Malformed bearer tokens return JSON 401 or 403',
      observed: `HTTP ${invalidTokenApi?.status ?? 0}; JSON error ${invalidTokenJsonError}` },
    { attackId: 'anonymous_note_item', expected: 'No-token item reads return JSON 401 or 403',
      observed: `HTTP ${anonymousNoteItem?.status ?? 0}; JSON error ${anonymousItemJsonError}` },
    { attackId: 'invalid_announcement_write', expected: 'Malformed bearer tokens cannot change announcements and return JSON 401 or 403',
      observed: `HTTP ${invalidAnnouncementWrite?.status ?? 0}; JSON error ${announcementWriteJsonError}` },
    { attackId: 'deployment_identity', expected: `The deployment identity reports step ${config.step}`,
      observed: `step ${identityStep}` },
    { attackId: 'nosniff_header', expected: 'The first-page response includes X-Content-Type-Options: nosniff',
      observed: nosniff },
  ];
  if (config.step >= 10) {
    const restoreRoute = typeof config.restoreRoute === 'string' && config.restoreRoute.startsWith('/')
      ? config.restoreRoute : '/api/notes/restore';
    const auditRoute = typeof config.auditRoute === 'string' && config.auditRoute.startsWith('/')
      ? config.auditRoute : '/api/notes/audit';
    const strictRoute = '/api/restore/notes/00000000-0000-4000-8000-000000000001';
    const [anonymousRestore, invalidTokenRestore, anonymousAudit, anonymousStrict, anonymousOps] = await Promise.all([
      request(restoreRoute, null, 'POST'), request(restoreRoute, 'Bearer invalid.invalid.invalid', 'POST'),
      request(auditRoute), request(strictRoute, null, 'POST'), request('/api/operations'),
    ]);
    const [anonymousRestoreJsonError, invalidRestoreJsonError, anonymousAuditJsonError,
      anonymousStrictJsonError, anonymousOpsJsonError] = await Promise.all([
      hasJsonError(anonymousRestore), hasJsonError(invalidTokenRestore), hasJsonError(anonymousAudit),
      hasJsonError(anonymousStrict), hasJsonError(anonymousOps),
    ]);
    results.push(
      { attackId: 'restore_anonymous', expected: 'No-token restore requests return JSON 401 or 403',
        observed: `HTTP ${anonymousRestore?.status ?? 0}; JSON error ${anonymousRestoreJsonError}` },
      { attackId: 'restore_invalid_token', expected: 'Malformed bearer tokens cannot trigger restore and return JSON 401 or 403',
        observed: `HTTP ${invalidTokenRestore?.status ?? 0}; JSON error ${invalidRestoreJsonError}` },
      { attackId: 'audit_anonymous', expected: 'No-token audit log reads return JSON 401 or 403',
        observed: `HTTP ${anonymousAudit?.status ?? 0}; JSON error ${anonymousAuditJsonError}` },
      { attackId: 'restore_strict_anonymous', expected: 'POST /api/restore/notes/:id without a token returns JSON 401 or 403',
        observed: `HTTP ${anonymousStrict?.status ?? 0}; JSON error ${anonymousStrictJsonError}` },
      { attackId: 'operations_anonymous', expected: 'GET /api/operations without a token returns JSON 401 or 403',
        observed: `HTTP ${anonymousOps?.status ?? 0}; JSON error ${anonymousOpsJsonError}` },
    );
  }
  return results;
}
