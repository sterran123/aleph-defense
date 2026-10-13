import { routeRestore } from '../../src/notes-api.mjs';
import { sessionAuth } from '../../src/server-session.mjs';
import { deviceApproval } from '../../src/server-device-approval.mjs';

export default sessionAuth.wrap(deviceApproval.guard(routeRestore));
