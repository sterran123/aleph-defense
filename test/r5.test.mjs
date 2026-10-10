import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 2,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity supports step two and uses Vercel deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 2,
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

test('stage-two checks record status and counts without returning note bodies', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  const privateSentinel = 'DO_NOT_INCLUDE_NOTE_CONTENT_IN_REPORT';
  try {
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(String(url));
      requested.push(parsed.pathname);
      assert.equal(init.redirect, 'error');
      if (parsed.pathname === '/data.json') return new Response('Not Found', { status: 404 });
      if (parsed.pathname === '/api/notes') {
        return new Response(JSON.stringify({ notes: [
          { title: 'synthetic', content: privateSentinel },
          { title: 'synthetic', content: privateSentinel },
          { title: 'synthetic', content: privateSentinel },
          { title: 'synthetic', content: privateSentinel },
        ] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (parsed.pathname === '/aleph.json') {
        return new Response(JSON.stringify({ schema: 'aleph.defense.deployment.v1', step: 2 }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('<html></html>', { status: 200, headers: { 'x-content-type-options': 'nosniff' } });
    };
    const results = await runAttackChecks(config);
    assert.deepEqual(requested, ['/data.json', '/api/notes', '/aleph.json', '/']);
    assert.equal(results.length, 4);
    assert.match(results[0].observed, /404/u);
    assert.match(results[1].observed, /record count 4/u);
    assert.match(results[2].observed, /step 2/u);
    assert.equal(results[3].observed, 'nosniff');
    assert.doesNotMatch(JSON.stringify(results), new RegExp(privateSentinel, 'u'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
