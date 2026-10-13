import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 3,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
  identityProvider: {
    issuer: 'https://student.supabase.co/auth/v1',
    audience: 'authenticated',
    jwksUrl: 'https://student.supabase.co/auth/v1/.well-known/jwks.json',
  },
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity supports step three and uses Vercel deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 3,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
  assert.throws(() => deploymentIdentity(env, { ...config, step: 0 }));
});

test('deployment checks leave unverifiable probes as not_run', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  try {
    globalThis.fetch = async (url) => {
      requested.push(new URL(String(url)).pathname);
      return new Response('{}', { status: 200 });
    };
    const results = await runAttackChecks(config);
    // 격리 환경은 요청 기록을 제공하지 않으므로 점검은 요청을 보내지 않고
    // 모두 not_run으로 남습니다.
    assert.deepEqual(requested, []);
    assert.equal(results.length, 7);
    assert.equal(results[3].attackId, 'anonymous_note_item');
    assert.equal(results[4].attackId, 'invalid_announcement_write');
    for (const result of results) {
      assert.equal(result.observed, 'not_run');
      assert.ok(result.expected.length > 0);
    }
    assert.doesNotMatch(JSON.stringify(results), /UNAUTHORIZED/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
