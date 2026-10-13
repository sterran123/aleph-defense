import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import notesHandler from '../api/notes.js';
import itemHandler from '../api/notes/[id].js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { createNotesHandlers } from '../src/notes-api.mjs';

const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const USER_ID = '11111111-1111-4111-8111-111111111111';

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function makeResponse() {
  const response = {
    headers: new Map(),
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    status(code) {
      this.statusCode = code;
      return { json: payload => { this.body = payload; return payload; } };
    },
  };
  return response;
}

test('stage-six config retains the Supabase Auth verifier contract', () => {
  assert.ok(Number.isInteger(config.step) && config.step >= 5 && config.step <= 12);
  assert.equal(config.serviceId, 'notes');
  assert.equal(config.readPath, '/notes');
  assert.equal(config.identityProvider.issuer, 'https://ufsdwlcxqwasyuhneynz.supabase.co/auth/v1');
  assert.equal(config.identityProvider.audience, 'authenticated');
  assert.equal(config.identityProvider.jwksUrl,
    `${config.identityProvider.issuer}/.well-known/jwks.json`);
});

test('verified Supabase claims, not request-supplied identity, determine the user ID', async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: config.identityProvider.issuer,
    aud: 'authenticated',
    role: 'authenticated',
    sub: USER_ID,
    iat: now,
    exp: now + 3600,
  };
  let claimsToken;
  const verifyLogin = createLoginVerifier({
    config,
    judgeKeySet: () => {},
    supabaseClient: { auth: { getClaims: async token => {
      claimsToken = token;
      return { data: { claims }, error: null };
    } } },
  });
  const token = jwt(claims);
  const identity = await verifyLogin(`Bearer ${token}`);
  assert.deepEqual(identity, { kind: 'student', userId: USER_ID });
  assert.equal(claimsToken, token);

  for (const rejectedClaims of [
    { ...claims, role: 'service_role' },
    { ...claims, aud: 'wrong-service' },
    { ...claims, exp: now - 1 },
  ]) {
    const rejectLogin = createLoginVerifier({
      config,
      judgeKeySet: () => {},
      supabaseClient: { auth: { getClaims: async () => ({ data: { claims: rejectedClaims }, error: null }) } },
    });
    assert.equal(await rejectLogin(`Bearer ${jwt(rejectedClaims)}`), null);
  }
});

test('notes API rejects absent and malformed bearer tokens with JSON 401', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://ufsdwlcxqwasyuhneynz.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'synthetic-test-server-key-not-real';
  try {
    for (const handler of [notesHandler, itemHandler]) {
      for (const authorization of [undefined, 'Bearer invalid.invalid.invalid']) {
        const response = makeResponse();
        await handler({
          method: 'GET',
          headers: authorization ? { authorization } : {},
          query: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
          body: { userId: 'admin', role: 'service_role' },
        }, response);
        assert.equal(response.statusCode, 401);
        assert.deepEqual(response.body, { error: 'UNAUTHORIZED' });
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      }
    }
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecret;
  }
});


function createMemorySupabase(initialRows = []) {
  const tables = {
    vault_notes: structuredClone(initialRows),
    vault_note_backups: [],
  };
  const calls = [];
  const project = (row, columns) => {
    if (!row) return null;
    if (!columns) return structuredClone(row);
    return Object.fromEntries(columns.split(',').map(column => [column, row[column]]));
  };
  const supabase = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `unexpected table ${table}`);
      const rows = tables[table];
      const key = table === 'vault_notes' ? 'id' : 'note_id';
      const query = { mode: 'select', filters: [], values: null, columns: null };
      const matches = row => query.filters.every(([column, value]) => row[column] === value);
      const execute = () => {
        if (query.mode === 'insert') {
          if (rows.some(row => row[key] === query.values[key])) return { data: null, error: { code: '23505' } };
          const extra = table === 'vault_notes'
            ? { sort_order: Math.max(0, ...rows.map(row => row.sort_order ?? 0)) + 1,
              created_at: '2026-10-10T00:00:00.000Z' }
            : { captured_at: '2026-10-10T00:00:00.000Z' };
          const row = { ...extra, ...query.values };
          rows.push(row);
          return { data: project(row, query.columns), error: null };
        }
        const found = rows.filter(matches);
        if (query.mode === 'update') {
          if (found[0]) Object.assign(found[0], query.values);
          return { data: project(found[0], query.columns), error: null };
        }
        if (query.mode === 'delete') {
          if (found[0]) rows.splice(rows.indexOf(found[0]), 1);
          return { data: project(found[0], query.columns), error: null };
        }
        return { data: found.map(row => project(row, query.columns)), error: null };
      };
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); calls.push({ column, value }); return builder; },
        order() { return builder; },
        insert(values) { query.mode = 'insert'; query.values = values; return builder; },
        update(values) { query.mode = 'update'; query.values = values; return builder; },
        delete() { query.mode = 'delete'; return builder; },
        single() { return Promise.resolve(execute()); },
        maybeSingle() {
          const result = execute();
          return Promise.resolve(Array.isArray(result.data)
            ? { ...result, data: result.data[0] ?? null }
            : result);
        },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return builder;
    },
  };
  return { supabase, rows: tables.vault_notes, backups: tables.vault_note_backups, calls };
}

test('collection create and list use only the verified owner ID', async () => {
  const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const { supabase, rows, calls } = createMemorySupabase();
  const verifyLogin = async authorization => ({
    'Bearer A': { kind: 'student', userId: ownerA },
    'Bearer B': { kind: 'student', userId: ownerB },
  })[authorization] ?? null;
  const handlers = createNotesHandlers({ supabase, verifyLogin });

  const createForOwner = async (authorization, title) => {
    const response = makeResponse();
    await handlers.collection({ method: 'POST', headers: { authorization },
      body: { title, body: `${title} synthetic body` } }, response);
    assert.equal(response.statusCode, 201);
    return rows.find(row => row.id === response.body.id);
  };
  const noteA = await createForOwner('Bearer A', 'A synthetic note');
  const noteB = await createForOwner('Bearer B', 'B synthetic note');
  assert.equal(noteA.owner_id, ownerA);
  assert.equal(noteB.owner_id, ownerB);

  const listA = makeResponse();
  await handlers.collection({ method: 'GET', headers: { authorization: 'Bearer A' } }, listA);
  assert.deepEqual(listA.body, [{ id: noteA.id, title: noteA.title, body: noteA.content }]);
  const listB = makeResponse();
  await handlers.collection({ method: 'GET', headers: { authorization: 'Bearer B' } }, listB);
  assert.deepEqual(listB.body, [{ id: noteB.id, title: noteB.title, body: noteB.content }]);
  assert.ok(calls.some(call => call.column === 'owner_id' && call.value === ownerA));
  assert.ok(calls.some(call => call.column === 'owner_id' && call.value === ownerB));

  const spoofedOwner = makeResponse();
  await handlers.collection({ method: 'POST', headers: { authorization: 'Bearer A' },
    body: { title: 'spoof', body: 'synthetic', owner_id: ownerB } }, spoofedOwner);
  assert.equal(spoofedOwner.statusCode, 400);
  assert.equal(rows.length, 2);
});

test('item routes deny cross-owner reads, updates, and deletes while allowing each owner CRUD', async () => {
  const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const noteAId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const noteBId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const { supabase, rows, calls } = createMemorySupabase([
    { id: noteAId, owner_id: ownerA, title: 'A note', content: 'synthetic A body', sort_order: 1 },
    { id: noteBId, owner_id: ownerB, title: 'B note', content: 'synthetic B body', sort_order: 2 },
  ]);
  const verifyLogin = async authorization => ({
    'Bearer A': { kind: 'student', userId: ownerA },
    'Bearer B': { kind: 'student', userId: ownerB },
  })[authorization] ?? null;
  const handlers = createNotesHandlers({ supabase, verifyLogin });

  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = makeResponse();
    await handlers.item({ method, headers: { authorization: 'Bearer B' }, query: { id: noteAId },
      body: method === 'PUT' ? { title: 'B unauthorized edit', body: 'synthetic forbidden' } : undefined }, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: 'NOTE_NOT_FOUND' });
  }
  assert.equal(rows.find(row => row.id === noteAId).owner_id, ownerA);
  assert.equal(rows.find(row => row.id === noteAId).title, 'A note');
  assert.ok(calls.some(call => call.column === 'owner_id' && call.value === ownerB));

  const spoofedUpdate = makeResponse();
  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer A' }, query: { id: noteAId },
    body: { title: 'spoof', body: 'synthetic forbidden', owner_id: ownerB } }, spoofedUpdate);
  assert.equal(spoofedUpdate.statusCode, 400);
  assert.equal(rows.find(row => row.id === noteAId).owner_id, ownerA);

  const readA = makeResponse();
  await handlers.item({ method: 'GET', headers: { authorization: 'Bearer A' }, query: { id: noteAId } }, readA);
  assert.equal(readA.statusCode, 200);
  assert.deepEqual(readA.body, { id: noteAId, title: 'A note', body: 'synthetic A body' });
  const updateA = makeResponse();
  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer A' }, query: { id: noteAId },
    body: { title: 'A updated note', body: 'synthetic A updated body' } }, updateA);
  assert.equal(updateA.statusCode, 200);
  assert.equal(rows.find(row => row.id === noteAId).owner_id, ownerA);
  assert.equal(updateA.body.title, 'A updated note');
  const deleteA = makeResponse();
  await handlers.item({ method: 'DELETE', headers: { authorization: 'Bearer A' }, query: { id: noteAId } }, deleteA);
  assert.equal(deleteA.statusCode, 200);
  const deletedReadA = makeResponse();
  await handlers.item({ method: 'GET', headers: { authorization: 'Bearer A' }, query: { id: noteAId } }, deletedReadA);
  assert.equal(deletedReadA.statusCode, 404);

  const readB = makeResponse();
  await handlers.item({ method: 'GET', headers: { authorization: 'Bearer B' }, query: { id: noteBId } }, readB);
  assert.equal(readB.statusCode, 200);
  assert.deepEqual(readB.body, { id: noteBId, title: 'B note', body: 'synthetic B body' });
  const updateB = makeResponse();
  await handlers.item({ method: 'PUT', headers: { authorization: 'Bearer B' }, query: { id: noteBId },
    body: { title: 'B updated note', body: 'synthetic B updated body' } }, updateB);
  assert.equal(updateB.statusCode, 200);
  assert.equal(rows.find(row => row.id === noteBId).owner_id, ownerB);
  const deleteB = makeResponse();
  await handlers.item({ method: 'DELETE', headers: { authorization: 'Bearer B' }, query: { id: noteBId } }, deleteB);
  assert.equal(deleteB.statusCode, 200);
});


test('browser auth UI uses the Supabase SDK and sends bearer tokens without a server key', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const buildScript = await readFile(new URL('../scripts/build-public.mjs', import.meta.url), 'utf8');
  const ignoreRules = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(html, /@supabase\/supabase-js@2\.117\.2/u);
  assert.match(html, /signInWithPassword/u);
  assert.match(html, /supabase\.auth\.signOut/u);
  assert.match(html, /Authorization: `Bearer \$\{activeSession\.access_token\}`/u);
  assert.match(html, /\/api\/notes\/\$\{encodeURIComponent\(note\.id\)\}/u);
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY|sb_secret_/u);
  assert.match(buildScript, /SUPABASE_PUBLISHABLE_KEY/u);
  assert.match(buildScript, /auth-config\.json/u);
  assert.match(ignoreRules, /public\/auth-config\.json/u);
});
