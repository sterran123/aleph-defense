// Record only status and metadata. Never return tokens, private keys, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 3) throw new Error('3단계 공격 점검은 배포 주소와 step 3이 필요합니다.');
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

  const request = async (pathname, authorization) => {
    try {
      return await fetch(new URL(pathname, app), {
        headers: authorization ? { Authorization: authorization } : undefined,
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
    } catch {
      return null;
    }
  };
  const [staticData, anonymousApi, invalidTokenApi, identityResponse, homepage] = await Promise.all([
    request('/data.json'), request('/api/notes'), request('/api/notes', 'Bearer invalid.invalid.invalid'),
    request('/aleph.json'), request('/'),
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
  const [anonymousJsonError, invalidTokenJsonError] = await Promise.all([
    hasJsonError(anonymousApi), hasJsonError(invalidTokenApi),
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
  return [
    { attackId: 'static_notes_file', expected: '/data.json is absent from the deployed static files',
      observed: `HTTP ${staticData?.status ?? 0}` },
    { attackId: 'anonymous_notes_api', expected: 'No-token API requests return JSON 401 or 403',
      observed: `HTTP ${anonymousApi?.status ?? 0}; JSON error ${anonymousJsonError}` },
    { attackId: 'invalid_bearer_token', expected: 'Malformed bearer tokens return JSON 401 or 403',
      observed: `HTTP ${invalidTokenApi?.status ?? 0}; JSON error ${invalidTokenJsonError}` },
    { attackId: 'deployment_identity', expected: 'The deployment identity reports step 3',
      observed: `step ${identityStep}` },
    { attackId: 'nosniff_header', expected: 'The first-page response includes X-Content-Type-Options: nosniff',
      observed: nosniff },
  ];
}
