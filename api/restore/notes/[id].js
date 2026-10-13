import { createRestoreNoteHandler } from '../../../src/restore-note-api.mjs';
import { getConfiguredNotesHandlers, getConfiguredSupabase } from '../../../src/notes-api.mjs';
import config from '../../../aleph.config.json' with { type: 'json' };

export default async function handler(request, response) {
  const handlers = getConfiguredNotesHandlers();
  return createRestoreNoteHandler({
    config,
    supabaseFactory: () => getConfiguredSupabase(),
    auditRecorder: entry => handlers?.recordAudit(entry) ?? null,
    retestRunner: handlers
      ? (note, identity, authorization) => handlers.runRetests(identity, authorization, note.id,
          { title: note.title, content: note.body })
      : null,
  })(request, response);
}
