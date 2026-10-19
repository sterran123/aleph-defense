// 공개 직렬화 규칙(aleph.canonical-json.v1).
// - 허용 값: 문자열, 불리언, null, 유한한 수, 배열, 평범한 객체.
// - 거부: undefined, 함수, 심볼(값·키 모두), bigint, NaN·Infinity, 순환 참조, Date·Map 같은 평범하지 않은 객체,
//   배열의 번호가 아닌 속성, 배열·객체의 getter·setter 속성(읽기 전에 거부), 배열의 빈칸·물려받은 원소,
//   짝이 맞지 않는 서로게이트가 든 문자열, 깊이 64 초과.
// - 객체 키는 JavaScript 기본 정렬(UTF-16 코드 단위 순)로 정렬하고, 배열 순서는 그대로 둡니다.
// - 공백·BOM·끝 줄바꿈을 넣지 않습니다. 문자열·수의 표기는 JSON.stringify 와 같습니다.
// 올바른 입력에서는 services/xdr/src/rules.mjs 의 stableStringify 와 같은 문자열을 냅니다.
// 다른 점은 undefined 필드를 조용히 빼지 않고 거부한다는 것입니다.
import { createHash } from 'node:crypto';
import { ContractError, ERROR_CODES as E } from './errors.mjs';

export const CANONICAL_JSON_VERSION = 'aleph.canonical-json.v1';
const MAX_DEPTH = 64;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function encodeString(s, path) {
  if (LONE_SURROGATE.test(s)) throw new ContractError(E.JSON_INVALID_STRING, path);
  return JSON.stringify(s);
}

function encode(value, path, depth, seen) {
  if (depth > MAX_DEPTH) throw new ContractError(E.JSON_TOO_DEEP, path);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return encodeString(value, path);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new ContractError(E.JSON_NON_FINITE_NUMBER, path);
      return JSON.stringify(value);
    case 'object': break;
    default: throw new ContractError(E.JSON_UNSUPPORTED_TYPE, `${path} (${typeof value})`);
  }
  if (seen.has(value)) throw new ContractError(E.JSON_CYCLE, path);
  seen.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length) throw new ContractError(E.JSON_UNSUPPORTED_TYPE, `${path} (symbol key)`);
    if (Array.isArray(value)) {
      const extra = Object.keys(value).filter(k => !/^(0|[1-9][0-9]*)$/u.test(k) || Number(k) >= value.length);
      if (extra.length) throw new ContractError(E.JSON_UNSUPPORTED_TYPE, `${path} (array extra property)`);
      const parts = [];
      for (let i = 0; i < value.length; i += 1) {
        const desc = Object.getOwnPropertyDescriptor(value, i);
        if (!desc) throw new ContractError(E.JSON_UNSUPPORTED_TYPE, `${path}[${i}] (hole)`);
        if (!('value' in desc)) throw new ContractError(E.JSON_UNSUPPORTED_TYPE, `${path}[${i}] (accessor)`);
        parts.push(encode(desc.value, `${path}[${i}]`, depth + 1, seen));
      }
      return `[${parts.join(',')}]`;
    }
    if (!isPlainObject(value)) throw new ContractError(E.JSON_UNSUPPORTED_TYPE, `${path} (non-plain object)`);
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      const desc = Object.getOwnPropertyDescriptor(value, k);
      if (!('value' in desc)) throw new ContractError(E.JSON_UNSUPPORTED_TYPE, `${path}.${k} (accessor)`);
    }
    const parts = keys.map(k => `${encodeString(k, `${path}.<key>`)}:${encode(Object.getOwnPropertyDescriptor(value, k).value, `${path}.${k}`, depth + 1, seen)}`);
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/** 공개 규칙으로 직렬화한 문자열을 돌려줍니다. 규칙에 맞지 않으면 ContractError 를 던집니다. */
export function canonicalJson(value) {
  return encode(value, '$', 0, new Set());
}

/** canonicalJson 결과의 UTF-8 바이트에 대한 SHA-256 을 'sha256:<64자리 소문자 16진수>' 로 돌려줍니다. */
export function canonicalDigest(value) {
  return sha256Text(canonicalJson(value));
}

export function sha256Text(text) {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

export function utf8Length(text) {
  return Buffer.byteLength(text, 'utf8');
}
