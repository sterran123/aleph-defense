import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RULE_IDS } from './decider.mjs';
import { verifyPolicySnapshot } from './policy-restore.mjs';
import { createLoginVerifier } from './verify-login.mjs';

const CHECKS = Object.freeze([
  ['s01_public_shell', 1, 'normal', 'GET /', 'HTTP 200'],
  ['s01_no_static_notes', 1, 'forbidden', 'GET /data.json', 'HTTP 404 or non-JSON'],
  ['s02_anonymous_notes', 2, 'forbidden', 'GET /api/notes without login', 'HTTP 401'],
  ['s02_direct_database', 2, 'forbidden', 'anon direct database SELECT', 'HTTP 401 or 403'],
  ['s03_login', 3, 'normal', 'student login', 'authenticated session'],
  ['s03_anonymous_notes', 3, 'forbidden', 'GET /api/notes', 'HTTP 401'],
  ['s03_invalid_token', 3, 'forbidden', 'GET /api/notes with forged token', 'HTTP 401'],
  ['s04_own_note_read', 4, 'normal', 'GET /api/notes/:id', 'HTTP 200 for owner'],
  ['s04_other_note_read', 4, 'forbidden', 'GET /api/notes/:id', 'HTTP 403 for non-owner'],
  ['s04_other_note_update', 4, 'forbidden', 'PUT /api/notes/:id', 'HTTP 403 for non-owner'],
  ['s04_other_note_delete', 4, 'forbidden', 'DELETE /api/notes/:id', 'HTTP 403 for non-owner'],
  ['s05_server_list', 5, 'normal', 'GET /api/notes', 'HTTP 200 for signed-in owner'],
  ['s05_anon_direct_read', 5, 'forbidden', 'anon direct database SELECT', 'HTTP 401 or 403'],
  ['s05_browser_key', 5, 'forbidden', 'GET /aleph.json', 'no public database key'],
  ['s06_registered_device', 6, 'normal', 'decide registered request', 'allow'],
  ['s06_unregistered_device', 6, 'forbidden', 'decide unregistered request', 'deny device_not_registered'],
  ['s07_normal_context', 7, 'normal', 'decide normal context', 'allow'],
  ['s07_composite_risk', 7, 'forbidden', 'decide composite risk', 'step_up'],
  ['s07_fresh_step_up', 7, 'normal', 'decide verified step-up', 'allow'],
  ['s08_own_note_zone', 8, 'normal', 'GET /notes/:id', 'allow'],
  ['s08_note_bulk', 8, 'forbidden', 'GET /notes', 'deny resource_not_allowed'],
  ['s08_announcement_read', 8, 'forbidden', 'GET /announcements/:id', 'deny resource_not_allowed'],
  ['s08_announcement_update', 8, 'forbidden', 'PUT /announcements/:id', 'deny resource_not_allowed'],
  ['s08_unknown_route', 8, 'forbidden', 'GET /notes/export', 'deny resource_not_allowed'],
  ['s09_normal_reads', 9, 'normal', '30 GET events', 'observe'],
  ['s09_threshold_reads', 9, 'normal', '120 GET events in 10 minutes', 'observe'],
  ['s09_burst_reads', 9, 'forbidden', '121 GET events in 10 minutes', 'propose_revocation'],
  ['s09_split_subjects', 9, 'normal', '100 GET events per subject', 'observe'],
  ['s10_policy_snapshot', 10, 'normal', 'verify safe policy snapshot', 'verified version'],
  ['s10_policy_diff', 10, 'normal', 'plan test policy restore', 'changes shown before write'],
  ['s10_anonymous_restore', 10, 'forbidden', 'POST /api/restore/notes/:id without login', 'HTTP 401'],
  ['s10_wrong_owner_restore', 10, 'forbidden', 'POST /api/restore/notes/:id', 'HTTP 403'],
  ['s10_missing_backup', 10, 'forbidden', 'POST /api/restore/notes/:id', 'HTTP 503'],
  ['s10_owned_restore', 10, 'normal', 'POST /api/restore/notes/:id', 'one verified note restored'],
  ['s10_audit_preserved', 10, 'normal', 'GET /api/notes/audit', 'audit entries preserved'],
  ['s11_manifest', 11, 'normal', 'GET /manifest.webmanifest', 'HTTP 200'],
  ['s11_pending_hidden', 11, 'forbidden', 'GET /api/notes before approval', 'HTTP 403'],
  ['s11_approved_open', 11, 'normal', 'GET /api/operations on approved device', 'HTTP 200'],
  ['s11_install_not_trust', 11, 'forbidden', 'installed app before approval', 'protected data hidden'],
  ['s11_browser_storage', 11, 'forbidden', 'browser storage inspection', 'no device key or token'],
  ['s11_anonymous_approval', 11, 'forbidden', 'GET /api/device-approval', 'HTTP 401 or 403'],
]);

// 안전 정책 사본의 내용 해시를 다시 검증하고 본문 없는 버전 요약만 만듭니다.
function recoverySummary() {
  try {
    const text = readFileSync(new URL('../backups/step10/safe-policy.json', import.meta.url), 'utf8');
    const hash = readFileSync(new URL('../backups/step10/safe-policy.sha256', import.meta.url), 'utf8').trim();
    const snapshot = verifyPolicySnapshot(text, hash);
    return { status: 'verified_snapshot', version: snapshot.version,
      sourceCommit: snapshot.sourceCommit.slice(0, 12), service: snapshot.service };
  } catch (error) {
    return { status: 'unverified_snapshot', reason: error?.message ?? 'unknown' };
  }
}

// 가린 작전 요약과 실행 여부가 분리된 점검 표를 반환합니다. 실제로 보내지 않은
// 요청은 not_run으로 남기고 결과를 꾸미지 않습니다.
export function createOperationsHandler({ config, env = process.env,
  fetchImpl = (...args) => fetch(...args), now = () => new Date(),
  verifierFactory = createLoginVerifier } = {}) {
  let verify;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '허용되지 않은 요청입니다.' });
    }
    if (Object.keys(req.query ?? {}).length) return res.status(400).json({ error: '쿼리 없이 요청하세요.' });
    try {
      verify ??= verifierFactory({ config, supabaseSecretKey: env.SUPABASE_SECRET_KEY });
      const identity = await verify(req.headers?.authorization);
      if (!identity?.userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
      const checkedAt = now().toISOString();
      const observations = [
        { checkId: 's01_public_shell', path: '/', requestId: randomUUID() },
        { checkId: 's01_no_static_notes', path: '/data.json', requestId: randomUUID() },
        { checkId: 's03_anonymous_notes', path: '/api/notes', requestId: randomUUID() },
        { checkId: 's02_anonymous_notes', path: '/api/notes', requestId: randomUUID() },
        { checkId: 's10_anonymous_restore', path: '/api/restore/notes/00000000-0000-4000-8000-000000000001', requestId: randomUUID(), method: 'POST' },
        { checkId: 's11_manifest', path: '/manifest.webmanifest', requestId: randomUUID() },
        { checkId: 's11_anonymous_approval', path: '/api/device-approval', requestId: randomUUID() },
      ];
      for (const observation of observations) {
        try {
          const response = await fetchImpl(new URL(observation.path, config.publicAppUrl).href, {
            method: observation.method ?? 'GET', redirect: 'error',
            headers: { 'X-Request-Id': observation.requestId },
            signal: AbortSignal.timeout(10000),
          });
          observation.status = response.status;
          if (observation.checkId === 's01_public_shell') {
            observation.actual = `HTTP ${response.status}`;
            observation.matched = response.status === 200;
          } else if (observation.checkId === 's01_no_static_notes') {
            const type = response.headers?.get?.('content-type') ?? '';
            observation.actual = `HTTP ${response.status} · content-type ${type || 'none'}`;
            observation.matched = response.status === 404
              || (response.status !== 200 && !type.toLowerCase().includes('application/json'));
          } else if (observation.checkId === 's10_anonymous_restore') {
            observation.actual = `HTTP ${response.status} · anonymous restore response body redacted`;
            observation.matched = response.status === 401;
          } else if (observation.checkId === 's11_manifest') {
            const type = response.headers?.get?.('content-type') ?? '';
            observation.actual = `HTTP ${response.status} · content-type ${type || 'none'}`;
            observation.matched = response.status === 200;
          } else if (observation.checkId === 's11_anonymous_approval') {
            observation.actual = `HTTP ${response.status} · anonymous approval response body redacted`;
            observation.matched = response.status === 401 || response.status === 403;
          } else {
            observation.actual = `HTTP ${response.status} · anonymous response body redacted`;
            observation.matched = response.status === 401 || response.status === 403;
          }
        } catch {
          observation.status = null;
          observation.actual = 'request failed';
          observation.matched = false;
        }
      }
      const checks = CHECKS.map(([checkId, stage, kind, request, expected]) => ({
        checkId, stage, kind, request, expected, status: 'not_run', actual: null,
        requestId: null, checkedAt: null,
      }));
      for (const observation of observations) Object.assign(
        checks.find(item => item.checkId === observation.checkId),
        { status: 'measured', actual: observation.actual, requestId: observation.requestId,
          checkedAt, matched: observation.matched },
      );
      const measured = checks.filter(item => item.status === 'measured');
      const matched = measured.filter(item => item.matched === true);
      return res.status(200).json({
        schema: 'aleph.operations.v1',
        checkedCommit: env.VERCEL_GIT_COMMIT_SHA?.toLowerCase() ?? 'local',
        generatedAt: checkedAt,
        sources: { student: ['src/decider.mjs', 'src/detect.mjs', 'src/policy-restore.mjs'],
          engine: 'ALEPH SDP engine', engineRuntimeEvidence: 'not_run' },
        policy: { ruleIds: [...RULE_IDS], count: RULE_IDS.length },
        detection: { status: 'not_run', eventCount: null, reason: 'verified engine events were not supplied' },
        revocation: { status: 'not_run', proposed: null, completed: null, reason: 'engine revocation result was not supplied' },
        recovery: recoverySummary(),
        checkCounts: { total: checks.length, measured: measured.length,
          matched: matched.length, notRun: checks.length - measured.length },
        checks: checks.map(({ matched: _matched, ...item }) => item),
      });
    } catch {
      return res.status(503).json({ error: '작전 기록을 확인할 수 없습니다.' });
    }
  };
}
