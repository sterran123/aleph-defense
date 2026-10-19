// 학습 백업 형식 계약(aleph.product.backup.v1).
//
// {
//   "format": "aleph.product.backup.v1",
//   "manifest": {
//     "projectId": "<학습 프로젝트 ID>",
//     "createdAt": "<ISO 시각, 선택 · 판정에 쓰지 않는 메타데이터>",
//     "items": [ { "name": "policy.json", "sha256": "sha256:<hex>", "bytes": <UTF-8 바이트 수> }, ... ]
//   },
//   "payload": { "policy.json": "<공개 직렬화 문자열>", "selected-events.json": "<공개 직렬화 문자열>" }
// }
//
// - payload 의 각 값은 항목 내용을 공개 직렬화 규칙(canonical-json)으로 만든 문자열입니다.
//   sha256·bytes 는 그 문자열의 UTF-8 바이트에 대해 계산합니다.
// - 허용 항목은 policy.json, selected-events.json 두 가지뿐이며 적어도 하나는 있어야 합니다.
// - verifyBackup 은 전체를 검사한 뒤에만 ok:true 를 돌려줍니다. 앱은 ok:true 를 받은 뒤에 반영을 시작해야 합니다.
// - 감사 이력·인증값·권한·RLS 로 보이는 키가 어디에든 있으면 거부합니다(복원 대상이 아님).
// - 해시는 내용 무결성 비교일 뿐 작성자 인증이나 복원 권한을 보증하지 않습니다. 권한 검사는 앱 서버가 따로 합니다.
import { ContractError, ERROR_CODES as E } from './errors.mjs';
import { canonicalJson, sha256Text, utf8Length } from './canonical-json.mjs';
import { validatePolicySnapshot } from './policy.mjs';

export const BACKUP_FORMAT = 'aleph.product.backup.v1';
export const BACKUP_ALLOWED_ITEMS = Object.freeze(['policy.json', 'selected-events.json']);
export const BACKUP_LIMITS = Object.freeze({
  maxTotalBytes: 1_048_576, // 백업 전체(JSON 텍스트) 1 MiB
  maxItemBytes: 524_288, // 항목 하나 512 KiB
  maxEvents: 5_000,
  maxEventIdLength: 128,
});

// 키 이름을 소문자로 바꾸고 _ - 공백을 뺀 뒤 이 목록과 같으면 금지 내용으로 봅니다.
export const BACKUP_FORBIDDEN_KEYS = Object.freeze([
  'audit', 'auditlog', 'auditlogs', 'audittrail', 'auditevents',
  'password', 'passwordhash', 'passwd', 'secret', 'clientsecret', 'jwtsecret',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'sessiontoken', 'apikey', 'credentials',
  'servicerole', 'servicerolekey', 'jwt', 'privatekey',
  'rls', 'rlspolicy', 'rlspolicies', 'grant', 'grants', 'privileges', 'authusers', 'userroles',
]);

const SHA = /^sha256:[0-9a-f]{64}$/u;
const MANIFEST_KEYS = ['projectId', 'createdAt', 'items'];
const ITEM_KEYS = ['name', 'sha256', 'bytes'];

function normKey(k) { return k.toLowerCase().replace(/[\s_-]/gu, ''); }
function fail(code, detail) { throw new ContractError(code, detail); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function scanForbidden(value, path) {
  if (Array.isArray(value)) { value.forEach((v, i) => scanForbidden(v, `${path}[${i}]`)); return; }
  if (!isObj(value)) return;
  for (const [k, v] of Object.entries(value)) {
    if (BACKUP_FORBIDDEN_KEYS.includes(normKey(k))) fail(E.BACKUP_FORBIDDEN_CONTENT, `${path}.${k}`);
    scanForbidden(v, `${path}.${k}`);
  }
}

function validateEvents(events) {
  if (!Array.isArray(events)) fail(E.BACKUP_ITEM_INVALID, 'selected-events.json: array required');
  if (events.length > BACKUP_LIMITS.maxEvents) fail(E.BACKUP_TOO_LARGE, 'selected-events.json: too many events');
  const ids = new Set();
  events.forEach((ev, i) => {
    if (!isObj(ev)) fail(E.BACKUP_ITEM_INVALID, `selected-events.json[${i}]: object required`);
    if (typeof ev.id !== 'string' || ev.id.length === 0 || ev.id.length > BACKUP_LIMITS.maxEventIdLength) fail(E.BACKUP_ITEM_INVALID, `selected-events.json[${i}].id`);
    if (typeof ev.at !== 'string' || !Number.isFinite(Date.parse(ev.at))) fail(E.BACKUP_ITEM_INVALID, `selected-events.json[${i}].at`);
    if (ids.has(ev.id)) fail(E.BACKUP_ITEM_INVALID, `selected-events.json: duplicate id ${ev.id}`);
    ids.add(ev.id);
  });
}

function validateItemContent(name, value, projectId) {
  scanForbidden(value, name);
  if (name === 'policy.json') {
    try { validatePolicySnapshot(value); } catch (error) { fail(E.BACKUP_ITEM_INVALID, `policy.json: ${error.code || error.message}`); }
    if (value.projectId !== projectId) fail(E.BACKUP_PROJECT, 'policy.json projectId');
  } else if (name === 'selected-events.json') {
    validateEvents(value);
  }
}

/**
 * 백업 객체를 만듭니다. items 는 { 'policy.json': 정책 객체, 'selected-events.json': 사건 배열 } 꼴입니다.
 * 만든 결과는 verifyBackup 을 통과하는지 확인한 뒤 돌려줍니다.
 */
export function buildBackup({ projectId, items, createdAt } = {}) {
  if (!isObj(items)) fail(E.BACKUP_SHAPE, 'items object required');
  const names = Object.keys(items).sort();
  const manifestItems = [];
  const payload = {};
  for (const name of names) {
    const text = canonicalJson(items[name]);
    payload[name] = text;
    manifestItems.push({ name, sha256: sha256Text(text), bytes: utf8Length(text) });
  }
  const manifest = { projectId, items: manifestItems };
  if (createdAt !== undefined) manifest.createdAt = createdAt;
  const backup = { format: BACKUP_FORMAT, manifest, payload };
  const check = verifyBackup(backup, { projectId });
  if (!check.ok) fail(check.code, check.detail);
  return backup;
}

/**
 * 백업을 전부 검사합니다. input 은 객체 또는 JSON 문자열입니다.
 * 성공: { ok: true, projectId, items: { 이름: 파싱한 내용 } }
 * 실패: { ok: false, code, detail } — 반영 전에 멈춰야 합니다.
 */
export function verifyBackup(input, { projectId } = {}) {
  try {
    return { ok: true, ...verifyOrThrow(input, projectId) };
  } catch (error) {
    if (error instanceof ContractError) return { ok: false, code: error.code, detail: error.detail };
    return { ok: false, code: E.BACKUP_SHAPE, detail: String(error?.message || error).slice(0, 200) };
  }
}

function verifyOrThrow(input, expectedProjectId) {
  let backup = input;
  if (typeof input === 'string') {
    if (utf8Length(input) > BACKUP_LIMITS.maxTotalBytes) fail(E.BACKUP_TOO_LARGE, 'total');
    try { backup = JSON.parse(input); } catch { fail(E.BACKUP_PARSE, 'invalid JSON'); }
  } else {
    let text;
    try { text = JSON.stringify(input); } catch { fail(E.BACKUP_SHAPE, 'not serializable'); }
    if (text === undefined) fail(E.BACKUP_SHAPE, 'object required');
    if (utf8Length(text) > BACKUP_LIMITS.maxTotalBytes) fail(E.BACKUP_TOO_LARGE, 'total');
  }
  if (!isObj(backup)) fail(E.BACKUP_SHAPE, 'object required');
  for (const k of Object.keys(backup)) if (!['format', 'manifest', 'payload'].includes(k)) fail(E.BACKUP_SHAPE, `unknown top-level ${k}`);
  if (backup.format !== BACKUP_FORMAT) fail(E.BACKUP_FORMAT, String(backup.format));
  const { manifest, payload } = backup;
  if (!isObj(manifest) || !isObj(payload)) fail(E.BACKUP_SHAPE, 'manifest/payload');
  for (const k of Object.keys(manifest)) if (!MANIFEST_KEYS.includes(k)) fail(E.BACKUP_SHAPE, `unknown manifest.${k}`);
  if (manifest.createdAt !== undefined && typeof manifest.createdAt !== 'string') fail(E.BACKUP_SHAPE, 'manifest.createdAt');
  if (typeof manifest.projectId !== 'string' || manifest.projectId.length === 0) fail(E.BACKUP_PROJECT, 'manifest.projectId');
  if (expectedProjectId === undefined || manifest.projectId !== expectedProjectId) fail(E.BACKUP_PROJECT, 'project mismatch');
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) fail(E.BACKUP_ITEM_MISSING, 'manifest.items');

  const seen = new Set();
  for (const item of manifest.items) {
    if (!isObj(item)) fail(E.BACKUP_SHAPE, 'manifest item');
    for (const k of Object.keys(item)) if (!ITEM_KEYS.includes(k)) fail(E.BACKUP_SHAPE, `unknown item field ${k}`);
    if (!BACKUP_ALLOWED_ITEMS.includes(item.name)) fail(E.BACKUP_ITEM_UNKNOWN, String(item.name));
    if (seen.has(item.name)) fail(E.BACKUP_ITEM_DUPLICATE, item.name);
    seen.add(item.name);
    if (typeof item.sha256 !== 'string' || !SHA.test(item.sha256)) fail(E.BACKUP_SHAPE, `${item.name}.sha256`);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0) fail(E.BACKUP_SHAPE, `${item.name}.bytes`);
  }
  for (const name of Object.keys(payload)) {
    if (!BACKUP_ALLOWED_ITEMS.includes(name)) fail(E.BACKUP_ITEM_UNKNOWN, name);
    if (!seen.has(name)) fail(E.BACKUP_ITEM_MISSING, `manifest lacks ${name}`);
  }

  const items = {};
  for (const item of manifest.items) {
    const text = payload[item.name];
    if (typeof text !== 'string') fail(E.BACKUP_ITEM_MISSING, `payload lacks ${item.name}`);
    const bytes = utf8Length(text);
    if (bytes > BACKUP_LIMITS.maxItemBytes) fail(E.BACKUP_TOO_LARGE, item.name);
    if (bytes !== item.bytes) fail(E.BACKUP_LENGTH_MISMATCH, item.name);
    if (sha256Text(text) !== item.sha256) fail(E.BACKUP_HASH_MISMATCH, item.name);
    let value;
    try { value = JSON.parse(text); } catch { fail(E.BACKUP_ITEM_INVALID, `${item.name}: invalid JSON`); }
    let canon;
    try { canon = canonicalJson(value); } catch (error) { fail(E.BACKUP_ITEM_INVALID, `${item.name}: ${error.code}`); }
    if (canon !== text) fail(E.BACKUP_ITEM_INVALID, `${item.name}: not canonical`);
    validateItemContent(item.name, value, manifest.projectId);
    items[item.name] = value;
  }
  return { projectId: manifest.projectId, items };
}
