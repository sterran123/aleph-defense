// 제공 플랫폼 파일 무결성(aleph.product.platform-sums.v1).
//
// 학생 키트의 제공 코드(src/platform/·api/·scripts/serve-local.mjs·vendor/)는 학생이 고치지 않는 것이 약속입니다.
// 집행 기록·실행 공간 분리 같은 판정 근거가 이 코드에서 나오기 때문입니다.
// 키트에는 PLATFORM_SHA256SUMS 가 함께 들어 있고, 심판은 제출 커밋의 같은 파일을 해시해 대조합니다.
// 어긋나면 학생 실패가 아니라 "플랫폼 변경"으로 따로 표시하고, 그 실행의 집행 기록 판정은 미검증으로 둡니다.
import { createHash } from 'node:crypto';

export const PLATFORM_SUMS_FILE = 'PLATFORM_SHA256SUMS';
const LINE = /^([0-9a-f]{64}) {2}([A-Za-z0-9._/[\]-]+)$/u;

/** "해시  경로" 줄 목록을 읽습니다. 형식이 틀리거나 경로가 겹치면 null. */
export function parsePlatformSums(text) {
  if (typeof text !== 'string') return null;
  const out = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/u, '');
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m || m[2].startsWith('/') || m[2].split('/').some(seg => seg === '' || seg === '.' || seg === '..') || out.has(m[2])) return null;
    out.set(m[2], m[1]);
  }
  return out.size ? out : null;
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * readFile(path) → Buffer|Uint8Array|null 로 제출 커밋의 파일을 읽어 대조합니다.
 * 결과: { ok, missing:[path], changed:[path] } 또는 { ok:false, code:'sums_invalid' }.
 * 줄바꿈 차이(CRLF)는 바꾸지 않고 그대로 다른 파일로 봅니다. 키트는 .gitattributes 로 LF 를 고정합니다.
 */
export async function verifyPlatformFiles(sumsText, readFile) {
  const sums = parsePlatformSums(sumsText);
  if (!sums) return { ok: false, code: 'sums_invalid', missing: [], changed: [] };
  const missing = [];
  const changed = [];
  for (const [path, hash] of sums) {
    const bytes = await readFile(path);
    if (bytes == null) missing.push(path);
    else if (sha256Bytes(bytes) !== hash) changed.push(path);
  }
  return { ok: missing.length === 0 && changed.length === 0, missing, changed };
}
