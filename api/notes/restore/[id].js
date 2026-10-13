import { routeRestore } from '../../../src/notes-api.mjs';

export default async function handler(request, response) {
  return routeRestore(request, response);
}
