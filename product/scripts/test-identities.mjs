// 제공 코드. 시험 신원 세 개(A·B 일반 사용자, OP 관리 작업자)를 내 프로젝트에 만듭니다.
//
//   로컬 연습:  node scripts/test-identities.mjs --local
//     .data/product.json 에 계정 셋을 만들고 이메일·비밀번호를 이 화면에만 보여 줍니다(내 PC 연습용).
//
//   심판 등록(기본 경로, Supabase):  node scripts/test-identities.mjs --supabase --register
//     내 Supabase 프로젝트에 계정 셋을 만들고, 자격을 플랫폼 보호 저장소로 한 번만 보냅니다.
//     서비스 키는 이 PC 에서만 쓰고 플랫폼으로 보내지 않습니다. 비밀번호는 화면·파일·저장소에 남기지 않습니다.
//     ※ 플랫폼 등록 경로는 운영진이 준비 중입니다. 준비되기 전에는 계정을 만들지 않고 멈춥니다.
//
//   지우기:  --remove 를 함께 주면 같은 계정을 지웁니다.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createFileStore } from '../src/platform/adapters/file-store.mjs';
import { createLocalAuth } from '../src/platform/adapters/local-auth.mjs';

const has = f => process.argv.includes(`--${f}`);
const NAMES = [['A', 'member'], ['B', 'member'], ['OP', 'operator']];
const projectId = process.env.PRODUCT_PROJECT_ID || 'local-project';
const slug = projectId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40) || 'project';
// 플랫폼 보호 저장소가 받는 합성 계정 형식(aleph-test-…@example.invalid)과 맞춥니다.
const emailOf = name => `aleph-test-${name.toLowerCase()}-${slug}@example.invalid`;
const newPassword = () => randomBytes(18).toString('base64url');

async function local() {
  mkdirSync('.data', { recursive: true });
  if (!existsSync('.data/secret')) writeFileSync('.data/secret', randomBytes(32).toString('base64url'), { mode: 0o600 });
  const store = createFileStore('.data/product.json');
  const auth = createLocalAuth({ store, secret: process.env.PRODUCT_TOKEN_SECRET || readFileSync('.data/secret', 'utf8').trim() });
  for (const [name, role] of NAMES) {
    const email = emailOf(name);
    const old = await store.get('auth_users', email);
    if (old) { await auth.removeUser(email); await store.delete('roles', old.userId); }
    if (has('remove')) { console.log(`지움: ${email}`); continue; }
    const password = newPassword();
    const { userId } = await auth.createUser(email, password);
    if (role === 'operator') await store.put('roles', userId, { role });
    console.log(`${name.padEnd(2)} ${role.padEnd(8)} ${email}  ${password}`);
  }
  if (!has('remove')) console.log('위 비밀번호는 내 PC 연습용입니다. 어디에도 붙여 넣거나 올리지 마세요.');
}

async function supabase() {
  const register = process.env.ALEPH_IDENTITY_REGISTER_URL;
  if (!has('register') || !register) {
    console.error('플랫폼 등록 경로(ALEPH_IDENTITY_REGISTER_URL)가 아직 준비되지 않아 계정을 만들지 않았습니다. 운영진 안내를 기다려 주세요.');
    process.exit(2);
  }
  console.error('등록 절차는 운영진 안내(product-v6 문서 §시험 신원)에 따라 연결됩니다.');
  process.exit(2);
}

if (has('local')) await local();
else if (has('supabase')) await supabase();
else { console.error('사용법: --local 또는 --supabase --register (지우기는 --remove 추가)'); process.exit(1); }
