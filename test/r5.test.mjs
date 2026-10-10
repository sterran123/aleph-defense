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

test('stage-three checks confirm unauthenticated API denials without returning note bodies', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  try {
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(String(url));
      requested.push(parsed.pathname);
      assert.equal(init.redirect, 'error');
      if (parsed.pathname === '/data.json') return new Response('Not Found', { status: 404 });
      if (parsed.pathname === '/api/notes') {
        assert.ok(!init.headers || typeof init.headers.Authorization === 'string');
        return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      if (parsed.pathname === '/aleph.json') {
        return new Response(JSON.stringify({ schema: 'aleph.defense.deployment.v1', step: 3 }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('<html></html>', { status: 200, headers: { 'x-content-type-options': 'nosniff' } });
    };
    const results = await runAttackChecks(config);
    assert.deepEqual(requested, ['/data.json', '/api/notes', '/api/notes', '/aleph.json', '/']);
    assert.equal(results.length, 5);
    assert.match(results[0].observed, /404/u);
    assert.match(results[1].observed, /HTTP 401; JSON error true/u);
    assert.match(results[2].observed, /HTTP 401; JSON error true/u);
    assert.match(results[3].observed, /step 3/u);
    assert.equal(results[4].observed, 'nosniff');
    assert.doesNotMatch(JSON.stringify(results), /UNAUTHORIZED/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
