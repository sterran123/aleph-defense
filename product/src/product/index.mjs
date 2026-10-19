// ─────────────────────────────────────────────────────────────────────────────
// 학생이 완성하는 업무 코드입니다. 4차(10/19~23)에 D1→D2→D3→D4 순서로 채웁니다.
// 함수 이름과 입력·출력 모양은 공개 계약이라 바꾸면 안 됩니다. 안쪽 구현은 자유입니다.
// 제공 코드(src/platform/)가 로그인 확인과 HTTP 연결을 하고, 이 파일의 함수를 부릅니다.
//
// ctx(요청마다 새로 만들어짐)
//   ctx.projectId  내 학습 프로젝트 ID
//   ctx.actor      { userId, role }  role 은 'member' 또는 'operator' (서버 DB 의 역할 표에서 읽은 값)
//   ctx.store      저장소(get · put · delete · list · transaction) — src/platform/adapters/memory-store.mjs 참고
//   ctx.executor   집행기(apply · release · status · isBlocked) — src/platform/adapters/executor.mjs 참고
//   ctx.clock()    지금 시각(밀리초). Date.now() 대신 이것을 쓰세요(시험이 시계를 바꿉니다).
//   ctx.sleep(ms)  기다리기. setTimeout 대신 이것을 쓰세요.
//   ctx.runId      시험 실행 ID(없으면 null). 시험 중 만든 자료에는 runId 필드를 붙여 두세요.
//
// 오류는 src/platform/errors.mjs 의 ProductError(또는 forbidden() 같은 도우미)로 던집니다.
// 공개 계약 함수는 vendor/defense-product-contracts 에서 가져다 쓰세요. 직접 다시 만들지 않습니다.
// 감사 기록은 'audit' 모음에 남기고, 어떤 경우에도 지우거나 덮어쓰지 않습니다.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import { ProductError, badRequest, forbidden, notFound, conflict, unprocessable } from '../platform/errors.mjs';
import { ExecutorError, BLOCK_ACTIONS } from '../platform/adapters/executor.mjs';
import {
  ContractError,
  canonicalJson,
  POLICY_SCHEMA, POLICY_EFFECTS, validatePolicySnapshot, policyDigest,
  BACKUP_ALLOWED_ITEMS, buildBackup, verifyBackup,
  isOperationKey, operationFingerprint, compareOperation, retryDecision,
} from '../../vendor/defense-product-contracts/index.mjs';

const COLL = {
  policy: 'policy',          // id 'active' → { snapshot, digest }
  versions: 'policy_versions', // id = 판 번호(문자열) → { revision, digest, snapshot, activatedAt, activatedBy, source }
  drafts: 'policy_drafts',
  resources: 'resources',    // id `${zone}/${id}`
  events: 'events',          // id = 사건 id → 받은 사건 그대로
  incidents: 'incidents',    // id = `${rule}:${subject}`
  responses: 'responses',    // id = operationKey
  audit: 'audit',            // 어떤 경우에도 지우지 않음
};

const BURST_WINDOW_MS = 600_000;
const BURST_THRESHOLD = 121;
const EXECUTE_CLAIM_STALE_MS = 60_000;
const WAIT_SLICES = 400; // 동시 승인 대기 상한(25ms × 400)

const isoNow = ctx => new Date(ctx.clock()).toISOString();
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function requireOperator(ctx) {
  if (ctx.actor?.role !== 'operator') throw forbidden('operator_required');
}

function asUnprocessable(error) {
  if (error instanceof ContractError || error?.name === 'ContractError') {
    return unprocessable(error.code || 'contract_invalid', error.detail || '');
  }
  return error;
}

async function auditTx(tx, ctx, action, detail = {}) {
  await tx.put(COLL.audit, `${isoNow(ctx)}#${randomUUID()}`, {
    at: isoNow(ctx), actor: ctx.actor.userId, action, detail, runId: ctx.runId ?? null,
  });
}

// ── D1 정책 ──────────────────────────────────────────────────────────────────
// 규칙 어휘(공통 최소 약속, 늘려도 되지만 이 뜻은 지켜야 함)
//   { id, effect: 'allow'|'deny'|'step_up', priority?: 정수(기본 0),
//     match?: { method?: 'GET'|'POST', zone?: 문자열 또는 '*', owner?: 'self'|'other'|'any', role?: 'member'|'operator' } }
//   - match 의 각 항목은 적혀 있을 때만 비교합니다(없으면 아무 값이나 맞음).
//   - 맞는 규칙 중 priority 가 가장 큰 것을 고르고, 같으면 deny > step_up > allow 순으로 더 엄한 것을 고릅니다.
//   - 맞는 규칙이 없으면 deny(reasonCode 'no_rule')입니다. 정책이 아직 없을 때도 deny 입니다.

const STRICTNESS = { deny: 3, step_up: 2, allow: 1 };
const rulePriority = rule => (Number.isSafeInteger(rule.priority) ? rule.priority : 0);

function ruleMatches(match, request) {
  const m = isObj(match) ? match : {};
  if (m.method !== undefined && m.method !== request.method) return false;
  if (m.zone !== undefined && m.zone !== '*' && m.zone !== request.zone) return false;
  if (m.owner !== undefined && m.owner !== 'any' && m.owner !== request.owner) return false;
  if (m.role !== undefined && m.role !== request.role) return false;
  return true;
}

/** 순수 함수. request: { method, zone, owner: 'self'|'other', role } → { decision, ruleIds, reasonCode } */
export function decide(request, policy) {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const matched = rules.filter(rule => isObj(rule) && POLICY_EFFECTS.includes(rule.effect) && ruleMatches(rule.match, request));
  if (!matched.length) return { decision: 'deny', ruleIds: [], reasonCode: 'no_rule' };
  const top = Math.max(...matched.map(rulePriority));
  const best = matched.filter(rule => rulePriority(rule) === top)
    .sort((a, b) => STRICTNESS[b.effect] - STRICTNESS[a.effect]);
  const chosen = best[0];
  const ruleIds = best.filter(rule => rule.effect === chosen.effect).map(rule => rule.id);
  return { decision: chosen.effect, ruleIds, reasonCode: chosen.id };
}

/** 로그인 사용자 누구나. → { active: 정책 스냅샷 또는 null, digest: 문자열 또는 null } */
export async function getPolicy(ctx) {
  const row = await ctx.store.get(COLL.policy, 'active');
  return { active: row?.snapshot ?? null, digest: row?.digest ?? null };
}

/** operator 만. → { items: [{ revision, digest, activatedAt, activatedBy, source: 'edit'|'rollback'|'restore' }] } 최신 판부터 */
export async function policyHistory(ctx, { limit }) {
  requireOperator(ctx);
  const n = Number.isSafeInteger(limit) && limit > 0 ? limit : 50;
  const items = (await ctx.store.list(COLL.versions))
    .map(row => row.value)
    .sort((a, b) => b.revision - a.revision)
    .slice(0, n)
    .map(({ revision, digest, activatedAt, activatedBy, source }) => ({ revision, digest, activatedAt, activatedBy, source }));
  return { items };
}

/** operator 만. body { snapshot } → 201 { draftId, digest }. 형식 오류는 422(공개 계약 오류 코드), 다른 프로젝트 정책은 422 'policy_project' */
export async function createDraft(ctx, body) {
  requireOperator(ctx);
  const snapshot = body?.snapshot;
  try {
    validatePolicySnapshot(snapshot);
  } catch (error) {
    throw asUnprocessable(error);
  }
  if (snapshot.projectId !== ctx.projectId) throw unprocessable('policy_project', '다른 프로젝트의 정책입니다');
  const digest = policyDigest(snapshot);
  const draftId = `draft-${randomUUID()}`;
  await ctx.store.transaction(async tx => {
    await tx.put(COLL.drafts, draftId, {
      draftId, digest, snapshot, createdBy: ctx.actor.userId, createdAt: isoNow(ctx), runId: ctx.runId ?? null,
    });
    await auditTx(tx, ctx, 'policy_draft_create', { draftId, digest });
  });
  return { draftId, digest };
}

/** operator 만. body { draftId, expectedRevision } → { revision, digest }.
 *  지금 판 번호(정책이 없으면 0)가 expectedRevision 과 다르면 409 'revision_conflict'. 새 판 번호는 지금 판 + 1 입니다. */
export async function activatePolicy(ctx, body) {
  requireOperator(ctx);
  const { draftId, expectedRevision } = body ?? {};
  if (typeof draftId !== 'string' || !draftId) throw badRequest('draft_id_invalid');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw badRequest('expected_revision_invalid');
  return ctx.store.transaction(async tx => {
    const draft = await tx.get(COLL.drafts, draftId);
    if (!draft) throw notFound('draft_not_found');
    const current = (await tx.get(COLL.policy, 'active'))?.snapshot?.revision ?? 0;
    if (current !== expectedRevision) throw conflict('revision_conflict', `현재 판 ${current}`);
    const revision = current + 1;
    const snapshot = { schema: POLICY_SCHEMA, projectId: ctx.projectId, revision, rules: structuredClone(draft.snapshot.rules) };
    const digest = policyDigest(snapshot);
    await tx.put(COLL.policy, 'active', { snapshot, digest });
    await tx.put(COLL.versions, String(revision), {
      revision, digest, snapshot, activatedAt: isoNow(ctx), activatedBy: ctx.actor.userId, source: 'edit',
    });
    await auditTx(tx, ctx, 'policy_activate', { revision, digest, draftId });
    return { revision, digest };
  });
}

/** operator 만. body { toRevision, expectedRevision } → { revision, digest }. 예전 판의 규칙을 새 판 번호로 다시 활성화합니다. */
export async function rollbackPolicy(ctx, body) {
  requireOperator(ctx);
  const { toRevision, expectedRevision } = body ?? {};
  if (!Number.isSafeInteger(toRevision) || toRevision < 1) throw badRequest('to_revision_invalid');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw badRequest('expected_revision_invalid');
  return ctx.store.transaction(async tx => {
    const current = (await tx.get(COLL.policy, 'active'))?.snapshot?.revision ?? 0;
    if (current !== expectedRevision) throw conflict('revision_conflict', `현재 판 ${current}`);
    const past = await tx.get(COLL.versions, String(toRevision));
    if (!past) throw notFound('revision_not_found');
    const revision = current + 1;
    const snapshot = { schema: POLICY_SCHEMA, projectId: ctx.projectId, revision, rules: structuredClone(past.snapshot.rules) };
    const digest = policyDigest(snapshot);
    await tx.put(COLL.policy, 'active', { snapshot, digest });
    await tx.put(COLL.versions, String(revision), {
      revision, digest, snapshot, activatedAt: isoNow(ctx), activatedBy: ctx.actor.userId, source: 'rollback',
    });
    await auditTx(tx, ctx, 'policy_rollback', { revision, toRevision });
    return { revision, digest };
  });
}

// ── 보호 자원 ────────────────────────────────────────────────────────────────
async function evaluateAccess(ctx, { method, zone, resourceRow }) {
  const active = await ctx.store.get(COLL.policy, 'active');
  const policy = active?.snapshot ?? null;
  // 쓰기(POST)는 늘 'self' 로 봅니다. 읽기는 자원 소유자와 요청자가 같을 때만 'self' 입니다.
  const owner = method === 'POST' ? 'self'
    : resourceRow && resourceRow.owner === ctx.actor.userId ? 'self' : 'other';
  const verdict = decide({ method, zone, owner, role: ctx.actor.role }, policy);
  return {
    verdict,
    decision: {
      decision: verdict.decision, ruleIds: verdict.ruleIds,
      revision: policy?.revision ?? null, digest: active?.digest ?? null,
    },
  };
}

function denied(verdict, decision) {
  if (verdict.decision === 'step_up') {
    return { status: 401, body: { error: { code: 'step_up_required', detail: verdict.reasonCode } }, decision };
  }
  return { status: 403, body: { error: { code: 'policy_denied', detail: verdict.reasonCode } }, decision };
}

/** → { status, body, decision: { decision, ruleIds, revision, digest } }
 *  차단된 사용자(집행기 isBlocked(`subject:${userId}`))는 정책과 관계없이 403 'blocked'.
 *  허용 200 { id, zone, data }, 거부 403 'policy_denied', 추가 확인 401 'step_up_required', 없는 자원 404. */
export async function readResource(ctx, { zone, id }) {
  const row = await ctx.store.get(COLL.resources, `${zone}/${id}`);
  const { verdict, decision } = await evaluateAccess(ctx, { method: 'GET', zone, resourceRow: row });
  if (await ctx.executor.isBlocked(`subject:${ctx.actor.userId}`)) {
    return { status: 403, body: { error: { code: 'blocked', detail: '' } }, decision };
  }
  if (verdict.decision !== 'allow') return denied(verdict, decision);
  if (!row) return { status: 404, body: { error: { code: 'not_found', detail: '' } }, decision };
  return { status: 200, body: { id: row.id, zone: row.zone, data: row.data }, decision };
}

/** → 허용이면 201 { id }. 소유자는 ctx.actor.userId 입니다(요청 본문의 owner 는 믿지 않음). */
export async function writeResource(ctx, { zone, body }) {
  const { verdict, decision } = await evaluateAccess(ctx, { method: 'POST', zone, resourceRow: null });
  if (await ctx.executor.isBlocked(`subject:${ctx.actor.userId}`)) {
    return { status: 403, body: { error: { code: 'blocked', detail: '' } }, decision };
  }
  if (verdict.decision !== 'allow') return denied(verdict, decision);
  const data = isObj(body) && 'data' in body ? body.data : body;
  const id = randomUUID();
  await ctx.store.put(COLL.resources, `${zone}/${id}`, {
    id, zone, owner: ctx.actor.userId, data, createdAt: isoNow(ctx), runId: ctx.runId ?? null,
  });
  return { status: 201, body: { id }, decision };
}

// ── D2 사건 ──────────────────────────────────────────────────────────────────
function isCanonicalSafe(value) {
  try { canonicalJson(value); return true; } catch { return false; }
}

function validEvent(ev) {
  return isObj(ev)
    && typeof ev.id === 'string' && ev.id.length > 0 && ev.id.length <= 512
    && typeof ev.at === 'string' && Number.isFinite(Date.parse(ev.at))
    && typeof ev.kind === 'string' && ev.kind.length > 0
    && typeof ev.subject === 'string' && ev.subject.length > 0
    && isCanonicalSafe(ev);
}

// 공통 탐지 규칙 burst_read: 같은 subject 의 kind 'read' 사건 가운데,
// 시각 차이가 600,000ms 미만인 사건이 121건 이상 모이면 incident 하나.
// 같은 subject 에 열린 incident 는 하나만 둡니다.
async function detectBurstRead(tx, ctx, subject) {
  const reads = (await tx.list(COLL.events))
    .map(row => row.value)
    .filter(ev => ev.subject === subject && ev.kind === 'read')
    .sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let best = null;
  for (let i = 0, j = 0; i < reads.length; i += 1) {
    while (j < reads.length && Date.parse(reads[j].at) - Date.parse(reads[i].at) < BURST_WINDOW_MS) j += 1;
    const count = j - i;
    if (count >= BURST_THRESHOLD && (!best || count > best.count)) best = { count, start: i, end: j };
  }
  if (!best) return;
  const incidentId = `burst_read:${subject}`;
  const eventIds = reads.slice(best.start, best.end).map(ev => ev.id);
  const firstAt = reads[best.start].at;
  const lastAt = reads[best.end - 1].at;
  const policyRevision = (await tx.get(COLL.policy, 'active'))?.snapshot?.revision ?? 0;
  const existing = await tx.get(COLL.incidents, incidentId);
  await tx.put(COLL.incidents, incidentId, {
    id: incidentId, rule: 'burst_read', subject, eventIds, firstAt, lastAt, policyRevision,
    createdAt: existing?.createdAt ?? isoNow(ctx), updatedAt: isoNow(ctx), runId: ctx.runId ?? null,
  });
}

/** operator 만. body { events: [{ id, at, kind, subject, ... }] } → { accepted, duplicates, conflicts: [id...] }
 *  같은 id·같은 내용 = 중복(저장 안 함), 같은 id·다른 내용 = 충돌(저장 안 함, conflicts 에 id).
 *  형식이 틀린 사건이 하나라도 있으면 400 'event_invalid' 이고 아무것도 저장하지 않습니다.
 *  저장한 뒤 탐지 규칙을 돌려 사건 묶음(incident)을 만들거나 고칩니다.
 *  공통 탐지 규칙 burst_read: 같은 subject 의 kind 'read' 사건 가운데, 시각 차이가 600,000ms 미만인 사건이 121건 이상 모이면 incident 하나.
 *  (정확히 600초 떨어진 두 사건은 같은 구간이 아닙니다.) 같은 subject 에 열린 incident 는 하나만 둡니다. */
export async function ingestEvents(ctx, body) {
  requireOperator(ctx);
  const events = body?.events;
  if (!Array.isArray(events) || events.some(ev => !validEvent(ev))) throw badRequest('event_invalid');
  return ctx.store.transaction(async tx => {
    let accepted = 0;
    let duplicates = 0;
    const conflicts = [];
    const touched = new Set();
    for (const ev of events) {
      const prev = await tx.get(COLL.events, ev.id);
      if (prev === null) {
        await tx.put(COLL.events, ev.id, structuredClone(ev));
        accepted += 1;
        touched.add(ev.subject);
      } else if (canonicalJson(prev) === canonicalJson(ev)) {
        duplicates += 1;
      } else {
        conflicts.push(ev.id);
      }
    }
    for (const subject of touched) await detectBurstRead(tx, ctx, subject);
    await auditTx(tx, ctx, 'events_ingest', { accepted, duplicates, conflicts: conflicts.length });
    return { accepted, duplicates, conflicts };
  });
}

/** operator 만. query { from?, to?, kind?, subject?, limit?, cursor? } → { items, nextCursor } 사건 시각(at) 순, 같으면 id 순 */
export async function queryEvents(ctx, query) {
  requireOperator(ctx);
  const { from, to, kind, subject, limit, cursor } = query ?? {};
  const bound = (name, raw) => {
    if (raw === undefined || raw === null) return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) throw badRequest('query_invalid', name);
    return ms;
  };
  const fromMs = bound('from', from);
  const toMs = bound('to', to);
  let lim = 1000;
  if (limit !== undefined && limit !== null) {
    if (!Number.isSafeInteger(Number(limit))) throw badRequest('query_invalid', 'limit');
    lim = Math.min(1000, Math.max(1, Number(limit)));
  }
  let after = null;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    const m = /^(\d+)~(.+)$/u.exec(String(cursor));
    if (!m) throw badRequest('cursor_invalid');
    after = { ms: Number(m[1]), id: m[2] };
  }
  const keyOf = ev => ({ ms: Date.parse(ev.at), id: ev.id });
  let items = (await ctx.store.list(COLL.events))
    .map(row => row.value)
    .filter(ev => (fromMs === null || Date.parse(ev.at) >= fromMs)
      && (toMs === null || Date.parse(ev.at) <= toMs)
      && (kind === undefined || ev.kind === kind)
      && (subject === undefined || ev.subject === subject))
    .sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (after) items = items.filter(ev => { const k = keyOf(ev); return k.ms > after.ms || (k.ms === after.ms && k.id > after.id); });
  const page = items.slice(0, lim);
  const last = page.at(-1);
  return { items: page, nextCursor: items.length > lim && last ? `${keyOf(last).ms}~${last.id}` : null };
}

const publicIncident = inc => inc && ({
  id: inc.id, rule: inc.rule, subject: inc.subject,
  eventIds: inc.eventIds, firstAt: inc.firstAt, lastAt: inc.lastAt, policyRevision: inc.policyRevision,
});

/** operator 만. → { items: [{ id, rule, subject, eventIds, firstAt, lastAt, policyRevision }] } */
export async function listIncidents(ctx) {
  requireOperator(ctx);
  const items = (await ctx.store.list(COLL.incidents))
    .map(row => publicIncident(row.value))
    .sort((a, b) => (Date.parse(a.firstAt) - Date.parse(b.firstAt)) || (a.id < b.id ? -1 : 1));
  return { items };
}

/** operator 만. 없으면 404 */
export async function getIncident(ctx, id) {
  requireOperator(ctx);
  const inc = await ctx.store.get(COLL.incidents, id);
  if (!inc) throw notFound('incident_not_found');
  return publicIncident(inc);
}

// ── D3 대응 ──────────────────────────────────────────────────────────────────
function responseView(rec) {
  return {
    operationKey: rec.operationKey, incidentId: rec.incidentId, target: rec.target, action: rec.action,
    state: rec.state, approval: rec.approval, attempts: rec.attempts ?? 0,
    executedAt: rec.executedAt ?? null, releasedAt: rec.releasedAt ?? null,
  };
}

/** operator 만. body { operationKey, incidentId, target, action, payload }
 *  → 새 작업 { status: 201, body: { operationKey, state: 'pending', approval: 'waiting' } }
 *  → 같은 키·같은 내용 { status: 200, body: 처음 작업의 지금 상태 }
 *  → 같은 키·다른 내용 409 'operation_conflict'. 키 형식 오류 400. 없는 incident 404.
 *  target 은 'subject:<userId>' 또는 'device:<id>', action 은 'block_subject' 또는 'block_device'. */
export async function createResponse(ctx, body) {
  requireOperator(ctx);
  const { operationKey, incidentId, target, action, payload = null } = body ?? {};
  if (!isOperationKey(operationKey)) throw badRequest('operation_key');
  if (typeof incidentId !== 'string' || !incidentId) throw badRequest('operation_shape', 'incidentId');
  const kind = typeof target === 'string' ? /^(subject|device):.{1,251}$/u.exec(target)?.[1] : null;
  if (!kind) throw badRequest('operation_shape', 'target');
  const want = { subject: 'block_subject', device: 'block_device' }[kind];
  if (!BLOCK_ACTIONS.includes(action) || action !== want) throw badRequest('operation_shape', 'action');
  let fingerprint;
  try {
    fingerprint = operationFingerprint({ projectId: ctx.projectId, target, action, payload });
  } catch (error) {
    if (error instanceof ContractError || error?.name === 'ContractError') throw badRequest('operation_shape', error.detail || error.code);
    throw error;
  }
  return ctx.store.transaction(async tx => {
    const stored = await tx.get(COLL.responses, operationKey);
    const cmp = compareOperation(
      stored ? { key: operationKey, fingerprint: stored.fingerprint } : null,
      { key: operationKey, fingerprint },
    );
    if (cmp === 'conflict') throw conflict('operation_conflict');
    if (cmp === 'same') return { status: 200, body: responseView(stored) };
    if (!(await tx.get(COLL.incidents, incidentId))) throw notFound('incident_not_found');
    const rec = {
      operationKey, fingerprint, incidentId, target, action, payload,
      state: 'pending', approval: 'waiting', executing: false, executingSince: null,
      attempts: 0, executedAt: null, releasedAt: null,
      createdBy: ctx.actor.userId, createdAt: isoNow(ctx), runId: ctx.runId ?? null,
    };
    await tx.put(COLL.responses, operationKey, rec);
    await auditTx(tx, ctx, 'response_create', { operationKey, target, action });
    return { status: 201, body: { operationKey, state: 'pending', approval: 'waiting' } };
  });
}

// 집행기 호출 공통: 응답을 못 받았으면 status() 로 먼저 확인하고, 공개 계약 retryDecision 으로 재시도를 정합니다.
// outcome: 'done' | 'give_up' | 'hold'. attempts 는 실제로 apply/release 를 부른 횟수.
async function runWithRetry(ctx, { opKey, target, call, doneWhen }) {
  const started = ctx.clock();
  let attempts = 0;
  for (;;) {
    let status = null;
    let uncertain = false;
    let retryAfterMs = null;
    let done = false;
    try {
      await call();
      attempts += 1;
      done = true;
    } catch (error) {
      if (!(error instanceof ExecutorError) && error?.name !== 'ExecutorError') throw error;
      attempts += 1;
      status = error.status;
      uncertain = error.uncertain === true;
      retryAfterMs = error.retryAfterMs ?? null;
      if (uncertain) {
        let known = 'unknown';
        try { known = await ctx.executor.status(opKey); } catch { /* 상태 조회 실패는 unknown 으로 둡니다 */ }
        if (known === doneWhen) done = true;
      }
    }
    if (done) return { outcome: 'done', attempts };
    const verdict = retryDecision({
      status, uncertain, attempt: attempts,
      elapsedMs: Math.max(0, ctx.clock() - started), budgetMs: 10_000, retryAfterMs,
    });
    if (!verdict.retry) return { outcome: verdict.outcome, attempts };
    await ctx.sleep(verdict.delayMs);
  }
}

// 다른 요청이 집행 중일 때 끝나기를 잠깐 기다립니다.
async function waitForSettlement(ctx, key) {
  for (let i = 0; i < WAIT_SLICES; i += 1) {
    const rec = await ctx.store.get(COLL.responses, key);
    if (!rec) throw notFound('response_not_found');
    if (!rec.executing) return rec;
    await ctx.sleep(25);
  }
  return ctx.store.get(COLL.responses, key);
}

/** operator 만. 승인 뒤에만 집행합니다. 한 작업은 딱 한 번만 실제로 집행돼야 합니다.
 *  집행기 오류는 공개 계약 retryDecision 규칙으로 다시 시도하고, 응답을 못 받았으면 status() 로 먼저 확인합니다.
 *  → { operationKey, state: 'succeeded'|'failed'|'pending', approval: 'approved', attempts } (pending = 보류, 완료 아님) */
export async function approveResponse(ctx, key) {
  requireOperator(ctx);
  if (!isOperationKey(key)) throw notFound('response_not_found');
  const claim = await ctx.store.transaction(async tx => {
    const rec = await tx.get(COLL.responses, key);
    if (!rec) throw notFound('response_not_found');
    if (rec.approval === 'rejected') throw conflict('operation_state', 'rejected');
    if (rec.approval === 'approved') {
      const running = rec.executing && (ctx.clock() - (rec.executingSince ?? 0)) < EXECUTE_CLAIM_STALE_MS;
      if (running) return 'wait';
      if (rec.state !== 'pending') return 'settled'; // 이미 끝난 작업은 그대로 돌려줍니다
    }
    await tx.put(COLL.responses, key, {
      ...rec, approval: 'approved', approvedBy: ctx.actor.userId, approvedAt: rec.approvedAt ?? isoNow(ctx),
      executing: true, executingSince: ctx.clock(),
    });
    if (rec.approval !== 'approved') await auditTx(tx, ctx, 'response_approve', { operationKey: key });
    return 'claimed';
  });
  if (claim === 'wait') return responseView(await waitForSettlement(ctx, key));
  if (claim === 'settled') return responseView(await ctx.store.get(COLL.responses, key));

  const rec = await ctx.store.get(COLL.responses, key);
  const { outcome, attempts } = await runWithRetry(ctx, {
    opKey: key, target: rec.target,
    call: () => ctx.executor.apply({ operationKey: key, target: rec.target, action: rec.action }),
    doneWhen: 'applied',
  });
  const totalAttempts = (rec.attempts ?? 0) + attempts;
  return ctx.store.transaction(async tx => {
    const cur = await tx.get(COLL.responses, key);
    if (!cur) throw notFound('response_not_found');
    const state = outcome === 'done' ? 'succeeded' : outcome === 'give_up' ? 'failed' : 'pending';
    const next = {
      ...cur, state, attempts: totalAttempts, executing: false, executingSince: null,
      executedAt: state === 'succeeded' ? isoNow(ctx) : cur.executedAt,
    };
    await tx.put(COLL.responses, key, next);
    await auditTx(tx, ctx, 'response_execute', { operationKey: key, state, attempts: totalAttempts });
    return responseView(next);
  });
}

/** operator 만. 승인 전 작업만 거절할 수 있습니다(이미 승인됐으면 409). */
export async function rejectResponse(ctx, key) {
  requireOperator(ctx);
  if (!isOperationKey(key)) throw notFound('response_not_found');
  return ctx.store.transaction(async tx => {
    const rec = await tx.get(COLL.responses, key);
    if (!rec) throw notFound('response_not_found');
    if (rec.approval !== 'waiting') throw conflict('operation_state', rec.approval);
    const next = { ...rec, approval: 'rejected', rejectedBy: ctx.actor.userId, rejectedAt: isoNow(ctx) };
    await tx.put(COLL.responses, key, next);
    await auditTx(tx, ctx, 'response_reject', { operationKey: key });
    return responseView(next);
  });
}

/** operator 만. 집행된 차단을 풉니다. 해제도 기록에 남깁니다. → { operationKey, state: 'released' } */
export async function releaseResponse(ctx, key) {
  requireOperator(ctx);
  if (!isOperationKey(key)) throw notFound('response_not_found');
  const rec = await ctx.store.get(COLL.responses, key);
  if (!rec) throw notFound('response_not_found');
  if (rec.state !== 'succeeded') throw conflict('operation_state', rec.state);
  const { outcome } = await runWithRetry(ctx, {
    opKey: key, target: rec.target,
    call: () => ctx.executor.release({ operationKey: key, target: rec.target }),
    doneWhen: 'released',
  });
  if (outcome !== 'done') throw new ProductError(503, 'executor_unavailable');
  const next = await ctx.store.transaction(async tx => {
    const cur = await tx.get(COLL.responses, key);
    if (!cur || cur.state !== 'succeeded') throw conflict('operation_state', cur?.state);
    const merged = { ...cur, state: 'released', releasedAt: isoNow(ctx) };
    await tx.put(COLL.responses, key, merged);
    await auditTx(tx, ctx, 'response_release', { operationKey: key });
    return merged;
  });
  return responseView(next);
}

/** operator 만. → { operationKey, state, approval, attempts, executedAt, releasedAt } */
export async function getResponse(ctx, key) {
  requireOperator(ctx);
  if (!isOperationKey(key)) throw notFound('response_not_found');
  const rec = await ctx.store.get(COLL.responses, key);
  if (!rec) throw notFound('response_not_found');
  return responseView(rec);
}

// ── D4 백업·복구 ─────────────────────────────────────────────────────────────
/** operator 만. body { items?: ['policy.json','selected-events.json'] } → aleph.product.backup.v1 문서(공개 계약 buildBackup) */
export async function createBackup(ctx, body) {
  requireOperator(ctx);
  let names = body?.items;
  if (names === undefined || names === null) names = [...BACKUP_ALLOWED_ITEMS];
  if (!Array.isArray(names) || names.length === 0 || names.some(n => !BACKUP_ALLOWED_ITEMS.includes(n))) {
    throw badRequest('backup_items_invalid');
  }
  const items = {};
  if (names.includes('policy.json')) {
    const active = await ctx.store.get(COLL.policy, 'active');
    if (!active) throw notFound('policy_not_found');
    items['policy.json'] = active.snapshot;
  }
  if (names.includes('selected-events.json')) {
    items['selected-events.json'] = (await ctx.store.list(COLL.events))
      .map(row => row.value)
      .sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id < b.id ? -1 : 1));
  }
  let backup;
  try {
    backup = buildBackup({ projectId: ctx.projectId, items, createdAt: isoNow(ctx) });
  } catch (error) {
    throw asUnprocessable(error);
  }
  await ctx.store.transaction(async tx => {
    await auditTx(tx, ctx, 'backup_create', { items: names });
  });
  return backup;
}

/** operator 만. body { backup } → { revision, restored: [...] }
 *  공개 계약 verifyBackup 이 실패하면 422(그 오류 코드)이고 아무것도 바꾸지 않습니다.
 *  정책은 예전 판 번호로 되감지 않고 새 판 번호(source 'restore')로 반영합니다.
 *  같은 id 의 사건이 이미 다른 내용으로 있으면 422 'restore_conflict' 이고 아무것도 바꾸지 않습니다.
 *  감사 기록은 복원 대상이 아니며 그대로 남습니다. */
export async function restoreBackup(ctx, body) {
  requireOperator(ctx);
  const check = verifyBackup(body?.backup, { projectId: ctx.projectId });
  if (!check.ok) throw unprocessable(check.code, check.detail);
  const items = check.items;
  return ctx.store.transaction(async tx => {
    const restored = [];
    // 반영 전에 사건 충돌부터 확인합니다. 어긋나면 아무것도 바꾸지 않습니다.
    const incoming = items['selected-events.json'] ?? [];
    for (const ev of incoming) {
      const prev = await tx.get(COLL.events, ev.id);
      if (prev !== null && canonicalJson(prev) !== canonicalJson(ev)) throw unprocessable('restore_conflict', ev.id);
    }
    let revision = (await tx.get(COLL.policy, 'active'))?.snapshot?.revision ?? 0;
    if (items['policy.json']) {
      revision += 1;
      const snapshot = {
        schema: POLICY_SCHEMA, projectId: ctx.projectId, revision,
        rules: structuredClone(items['policy.json'].rules),
      };
      const digest = policyDigest(snapshot);
      await tx.put(COLL.policy, 'active', { snapshot, digest });
      await tx.put(COLL.versions, String(revision), {
        revision, digest, snapshot, activatedAt: isoNow(ctx), activatedBy: ctx.actor.userId, source: 'restore',
      });
      restored.push('policy.json');
    }
    if ('selected-events.json' in items) {
      for (const ev of incoming) {
        if ((await tx.get(COLL.events, ev.id)) === null) await tx.put(COLL.events, ev.id, structuredClone(ev));
      }
      restored.push('selected-events.json');
    }
    await auditTx(tx, ctx, 'restore', { revision, restored });
    return { revision, restored };
  });
}
