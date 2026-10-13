import { RESOURCE_IDS } from '../../src/resource-ids.mjs';
import { routeResource } from '../../src/notes-api.mjs';

export default async function handler(request, response) {
  return routeResource(RESOURCE_IDS.instructorAnnouncements, 'item', request, response);
}
