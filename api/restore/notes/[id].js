import { createRestoreNoteHandler } from '../../../src/restore-note-api.mjs';
import { getConfiguredNotesHandlers, getConfiguredSupabase } from '../../../src/notes-api.mjs';
import { sessionAuth } from '../../../src/server-session.mjs';
import { deviceApproval } from '../../../src/server-device-approval.mjs';
import config from '../../../aleph.config.json' with { type: 'json' };

const strictRestore = createRestoreNoteHandler({
  config,
  supabaseFactory: () => getConfiguredSupabase(),
  auditRecorder: entry => getConfiguredNotesHandlers()?.recordAudit(entry) ?? null,
  retestRunner: (note, identity, authorization) => getConfiguredNotesHandlers()
    ?.runRetests(identity, authorization, note.id, { title: note.title, content: note.body }) ?? null,
});

export default sessionAuth.wrap(deviceApproval.guard(strictRestore));
