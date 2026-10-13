import { RESOURCE_IDS } from '../../src/resource-ids.mjs';
import { routeResource } from '../../src/notes-api.mjs';
import { sessionAuth } from '../../src/server-session.mjs';
import { deviceApproval } from '../../src/server-device-approval.mjs';

export default sessionAuth.wrap(deviceApproval.guard(
  (request, response) => routeResource(RESOURCE_IDS.instructorAnnouncements, 'item', request, response)));
