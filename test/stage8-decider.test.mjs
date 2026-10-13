import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { RESOURCE_IDS } from '../src/resource-ids.mjs';

const noteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('registered users can reach only the exact notes routes', async () => {
  const { normal } = fixtureRequests();
  const response = await decide(normal);
  assert.equal(response.decision, 'allow');
  assert.equal(response.reasonCode, 'approved');
  assert.ok(response.ruleIds.includes('resource_zone'));
  assert.deepEqual(Object.keys(response).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.ok(RULE_IDS.includes('resource_zone'));
});

test('unknown paths, mismatched routes, and announcement writes fail closed', async () => {
  const { normal } = fixtureRequests();
  const blocked = [
    { ...normal, path: '/notes/export' },
    { ...normal, route: 'GET /notes/export' },
    { ...normal, service: RESOURCE_IDS.instructorAnnouncements, method: 'PUT',
      path: `/announcements/${noteId}`, route: 'PUT /announcements/:id' },
  ];
  for (const request of blocked) {
    const response = await decide(request);
    assert.equal(response.decision, 'deny');
    assert.equal(response.reasonCode, 'step_up_required');
    assert.deepEqual(response.ruleIds, ['resource_zone']);
  }
});

test('the resource policy ignores query values and still preserves device and Stage 7 rules', async () => {
  const { normal, suspicious } = fixtureRequests();
  const withQuery = await decide({ ...normal, queryLength: 15,
    querySha256: 'a'.repeat(64) });
  assert.equal(withQuery.decision, 'allow');
  const unregistered = await decide({ ...normal, deviceRegistered: false });
  assert.equal(unregistered.decision, 'deny');
  assert.equal(unregistered.reasonCode, 'device_not_registered');
  const stepUp = await decide(suspicious);
  assert.equal(stepUp.decision, 'step_up');
  assert.equal(stepUp.reasonCode, 'step_up_required');
  const verified = await decide({ ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } });
  assert.equal(verified.decision, 'allow');
});
