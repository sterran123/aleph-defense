import { createHash, timingSafeEqual } from 'node:crypto';

const clone = value => JSON.parse(JSON.stringify(value));
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

// 사본 파일의 내용 해시를 먼저 대조합니다. 줄바꿈·들여쓰기 차이는 허용하고
// JSON 내용이 다르면 검증 실패로 중단합니다.
export function verifyPolicySnapshot(text, expectedHash) {
  if (typeof text !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedHash ?? '')) {
    throw new Error('검증한 안전 정책 사본과 해시가 필요합니다.');
  }
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { throw new Error('안전 정책 사본 형식이 올바르지 않습니다.'); }
  const actual = digest(JSON.stringify(snapshot));
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expectedHash.toLowerCase()))) {
    throw new Error('안전 정책 사본 검증에 실패했습니다.');
  }
  if (snapshot?.schema !== 'aleph.safe-policy.v1'
      || typeof snapshot.version !== 'string'
      || !/^[0-9a-f]{40}$/.test(snapshot.sourceCommit ?? '')
      || snapshot.service !== 'student-notes'
      || !Array.isArray(snapshot.rules)
      || snapshot.rules.some(rule => typeof rule?.id !== 'string' || typeof rule?.mode !== 'string')) {
    throw new Error('안전 정책 사본 형식이 올바르지 않습니다.');
  }
  return snapshot;
}

export function diffTestPolicy(snapshot, current) {
  const currentRules = current?.services?.[snapshot.service]?.rules;
  if (!Array.isArray(currentRules) || !Array.isArray(current.auditHistory)) {
    throw new Error('현재 시험 정책 형식이 올바르지 않습니다.');
  }
  const before = new Map(currentRules.map(rule => [rule.id, rule]));
  const after = new Map(snapshot.rules.map(rule => [rule.id, rule]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  return {
    version: snapshot.version,
    sourceCommit: snapshot.sourceCommit,
    service: snapshot.service,
    changes: ids.filter(id => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)))
      .map(id => ({ ruleId: id, before: before.get(id) ?? null, after: after.get(id) ?? null })),
  };
}

export function restoreTestPolicy(snapshot, current, confirmedVersion) {
  const plan = diffTestPolicy(snapshot, current);
  if (confirmedVersion !== snapshot.version) throw new Error('복원할 안전 정책 버전을 먼저 확인하세요.');
  const restored = clone(current);
  restored.services[snapshot.service].rules = clone(snapshot.rules);
  restored.services[snapshot.service].restoredFrom = snapshot.version;
  return { restored, plan };
}
