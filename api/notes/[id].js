import { routeNotes } from '../../src/notes-api.mjs';

export default async function handler(request, response) {
  return routeNotes('item', request, response);
}
