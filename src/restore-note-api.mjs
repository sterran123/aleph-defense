import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

// 검증된 비공개 가상 메모 사본은 서버 환경 변수에만 둡니다.
// 심판이 주입한 사본의 전체 해시와 본문 해시를 둘 다 대조합니다.
export function loadVerifiedNoteBackup(env = process.env) {
  const raw = env.RESTORE_NOTE_BACKUP_JSON;
  const expected = env.RESTORE_NOTE_BACKUP_SHA256;
  if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/iu.test(expected ?? '')) {
    throw new Error('검증한 비공개 메모 사본이 없습니다.');
  }
  const actual = sha256(raw);
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected.toLowerCase()))) {
    throw new Error('비공개 메모 사본 검증에 실패했습니다.');
  }
  const backup = JSON.parse(raw);
  const note = backup?.note;
  if (backup?.schema !== 'aleph.private-note-backup.v1'
      || !UUID.test(note?.id ?? '') || !UUID.test(note?.ownerId ?? '')
      || typeof note?.title !== 'string' || !note.title.trim() || note.title.length > 200
      || typeof note?.body !== 'string' || !note.body.trim() || note.body.length > 10000
      || !/^[0-9a-f]{64}$/iu.test(note?.contentSha256 ?? '')
      || sha256(note.body) !== note.contentSha256.toLowerCase()) {
    throw new Error('비공개 메모 사본 내용 검증에 실패했습니다.');
  }
  return note;
}

// POST /api/restore/notes/:id — 복구 내용과 권한은 요청 본문에서 받지 않습니다.
// 응답에는 본문 대신 ID·소유자 확인 여부·본문 해시만 남깁니다.
export function createRestoreNoteHandler({ config, env = process.env,
  verifierFactory = createLoginVerifier,
  supabaseFactory = null, backupLoader = loadVerifiedNoteBackup,
  auditRecorder = null, retestRunner = null } = {}) {
  let verify;
  let supabase;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const error = (status, message) => res.status(status).json({ error: message });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return error(405, '허용되지 않은 요청입니다.'); }
    if (!req.headers?.authorization) return error(401, '로그인이 필요합니다.');
    try {
      verify ??= verifierFactory({ config, supabaseSecretKey: env.SUPABASE_SECRET_KEY });
      const identity = await verify(req.headers.authorization);
      if (!identity || !UUID.test(identity.userId ?? '')) return error(401, '로그인 정보가 유효하지 않습니다.');
      const id = req.query?.id;
      if (!UUID.test(id ?? '') || Object.keys(req.query ?? {}).some(key => key !== 'id')) {
        return error(400, '복구 대상 메모 ID를 경로로 지정하세요.');
      }
      if (req.body && (typeof req.body !== 'object' || Object.keys(req.body).length)) {
        return error(400, '복구 내용과 권한은 요청 본문에서 받지 않습니다.');
      }
      let note;
      try { note = backupLoader(env); } catch { return error(503, '검증한 비공개 메모 사본을 확인할 수 없습니다.'); }
      if (note.id !== id) return error(404, '지정한 복구 대상이 사본에 없습니다.');
      if (note.ownerId !== identity.userId) return error(403, '사본 소유자만 복구할 수 있습니다.');

      if (supabaseFactory) supabase ??= supabaseFactory(env);
      else supabase ??= createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY,
        { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
      if (!supabase) return error(503, '메모 한 건을 복구할 수 없습니다.');

      const { data: existing, error: readError } = await supabase.from('vault_notes')
        .select('id,owner_id,content').eq('id', note.id);
      if (readError || !Array.isArray(existing) || existing.length > 1) throw new Error();
      if (existing.length && existing[0].owner_id !== note.ownerId) {
        return error(403, '저장된 메모 소유자가 사본과 다릅니다.');
      }
      if (existing.length && sha256(existing[0].content ?? '') === note.contentSha256.toLowerCase()) {
        return res.status(200).json({ id: note.id, ownerVerified: true, contentSha256: note.contentSha256, restored: false });
      }
      const { data: rows, error: writeError } = existing.length
        ? await supabase.from('vault_notes')
            .update({ title: note.title, content: note.body })
            .eq('id', note.id).eq('owner_id', note.ownerId)
            .select('id,owner_id,content')
        : await supabase.from('vault_notes')
            .insert({ id: note.id, owner_id: note.ownerId, title: note.title, content: note.body })
            .select('id,owner_id,content');
      if (writeError || !Array.isArray(rows) || rows.length !== 1 || rows[0].id !== note.id
          || rows[0].owner_id !== note.ownerId
          || sha256(rows[0].content ?? '') !== note.contentSha256.toLowerCase()) throw new Error();

      let audit = null;
      try { audit = await auditRecorder?.({ action: 'note.restore', noteId: note.id, ownerId: note.ownerId }) ?? null; } catch {}
      let retests = null;
      try { retests = await retestRunner?.(note, identity, req.headers.authorization) ?? null; } catch {}
      return res.status(200).json({ id: note.id, ownerVerified: true,
        contentSha256: note.contentSha256, restored: true,
        ...(audit || retests ? { restore: { audit, retests } } : {}) });
    } catch { return error(503, '메모 한 건을 복구할 수 없습니다.'); }
  };
}
