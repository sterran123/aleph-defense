import { routeAudit } from '../../src/notes-api.mjs';

export default async function handler(request, response) {
  return routeAudit(request, response);
}
