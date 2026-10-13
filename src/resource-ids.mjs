const UUID_PATH = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// Stable server-side identifiers for separate resource zones. The values are
// intentionally distinct from public UI labels and from note record IDs.
export const RESOURCE_IDS = Object.freeze({
  notes: 'notes',
  instructorAnnouncements: 'announcements',
});

const API_ITEM_PATH = new RegExp(`^/api/(notes|announcements)/(${UUID_PATH})$`, 'u');

export function parseApiResourcePath(pathname) {
  if (typeof pathname !== 'string' || pathname !== pathname.trim()) return null;
  if (pathname === '/api/notes') return Object.freeze({ resourceId: RESOURCE_IDS.notes, itemId: null });
  const match = API_ITEM_PATH.exec(pathname);
  if (!match) return null;
  return Object.freeze({
    resourceId: match[1] === 'notes' ? RESOURCE_IDS.notes : RESOURCE_IDS.instructorAnnouncements,
    itemId: match[2],
  });
}

export function resourceIdForApiPath(pathname) {
  return parseApiResourcePath(pathname)?.resourceId ?? null;
}

// Decision-engine paths use the canonical route shape; fixture IDs need not be UUIDs.
const DECISION_ITEM_ID = '[A-Za-z0-9][A-Za-z0-9._~-]{0,255}';
const NOTE_ITEM_PATH = new RegExp(`^/notes/${DECISION_ITEM_ID}$`, 'u');
const ANNOUNCEMENT_ITEM_PATH = new RegExp(`^/announcements/${DECISION_ITEM_ID}$`, 'u');

// Service, method, path, and route must all match; query data never selects a resource or action.
export function resourceIdForDecisionRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  const { service, method, path, route } = request;
  if (service === RESOURCE_IDS.notes) {
    if (method === 'GET' && path === '/notes' && route === 'GET /notes') return RESOURCE_IDS.notes;
    if (method === 'POST' && path === '/notes' && route === 'POST /notes') return RESOURCE_IDS.notes;
    if (['GET', 'PUT', 'DELETE'].includes(method) && NOTE_ITEM_PATH.test(path ?? '')
        && path !== '/notes/export'
        && route === `${method} /notes/:id`) return RESOURCE_IDS.notes;
    return null;
  }
  if (service === RESOURCE_IDS.instructorAnnouncements
      && ['GET', 'PUT', 'DELETE'].includes(method)
      && ANNOUNCEMENT_ITEM_PATH.test(path ?? '')
      && path !== '/announcements/export'
      && route === `${method} /announcements/:id`) {
    return RESOURCE_IDS.instructorAnnouncements;
  }
  return null;
}
