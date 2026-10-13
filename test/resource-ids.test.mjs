import assert from 'node:assert/strict';
import { test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { RESOURCE_IDS, parseApiResourcePath, resourceIdForApiPath,
  resourceIdForDecisionRequest } from '../src/resource-ids.mjs';

const noteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('memo and instructor announcements have distinct resource IDs', () => {
  assert.equal(RESOURCE_IDS.notes, 'notes');
  assert.equal(RESOURCE_IDS.instructorAnnouncements, 'announcements');
  assert.notEqual(RESOURCE_IDS.notes, RESOURCE_IDS.instructorAnnouncements);
  assert.deepEqual(config.resourceIds, {
    notes: RESOURCE_IDS.notes,
    instructorAnnouncements: RESOURCE_IDS.instructorAnnouncements,
  });
});

test('the server can map only exact resource paths to an ID', () => {
  assert.equal(resourceIdForApiPath('/api/notes'), RESOURCE_IDS.notes);
  assert.equal(resourceIdForApiPath(`/api/notes/${noteId}`), RESOURCE_IDS.notes);
  assert.equal(resourceIdForApiPath(`/api/announcements/${noteId}`), RESOURCE_IDS.instructorAnnouncements);
  assert.equal(resourceIdForApiPath('/api/notes/export'), null);
  assert.equal(resourceIdForApiPath('/api/announcements/export'), null);
  assert.equal(resourceIdForApiPath('/api/unknown/resource'), null);
  assert.deepEqual(parseApiResourcePath('/api/notes'), { resourceId: RESOURCE_IDS.notes, itemId: null });
  assert.deepEqual(parseApiResourcePath(`/api/notes/${noteId}`), { resourceId: RESOURCE_IDS.notes, itemId: noteId });
  assert.deepEqual(parseApiResourcePath(`/api/announcements/${noteId}`), {
    resourceId: RESOURCE_IDS.instructorAnnouncements, itemId: noteId,
  });
  assert.equal(parseApiResourcePath('/API/notes/export'), null);
});


test('engine routes map only exact resource, method, path, and route combinations', async () => {
  const request = {
    service: RESOURCE_IDS.notes,
    method: 'GET',
    path: '/notes/demo',
    route: 'GET /notes/:id',
  };
  assert.equal(resourceIdForDecisionRequest(request), RESOURCE_IDS.notes);
  assert.equal(resourceIdForDecisionRequest({ ...request, method: 'PUT', route: 'GET /notes/:id' }), null);
  assert.equal(resourceIdForDecisionRequest({ ...request, path: '/notes/export' }), null);
  assert.equal(resourceIdForDecisionRequest({ ...request, path: '/notes/demo/export' }), null);
  assert.equal(resourceIdForDecisionRequest({ ...request, path: '/notes/export', route: 'GET /notes/export' }), null);
  assert.equal(resourceIdForDecisionRequest({ ...request, query: { action: 'export' } }), RESOURCE_IDS.notes);
  assert.equal(resourceIdForDecisionRequest({
    service: RESOURCE_IDS.instructorAnnouncements,
    method: 'PUT', path: `/announcements/${noteId}`, route: 'PUT /announcements/:id',
  }), RESOURCE_IDS.instructorAnnouncements);
});
