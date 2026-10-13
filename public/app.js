// 화면 요소를 ID로 찾습니다.
const $ = id => document.getElementById(id);
let session = null, deviceApproved = false, editId = null, generation = 0, installPrompt = null;
// 처리 결과나 오류를 화면의 상태 문구에 표시합니다.
const message = text => { $('status').textContent = text; };
// 편집 상태를 해제하고 메모 추가 화면으로 되돌립니다.
function resetEditor() {
  editId = null; $('editor').reset(); $('editor-heading').textContent = '가상 메모 추가';
  $('save').textContent = '추가'; $('cancel').hidden = true;
}
// 로그인 쿠키를 함께 보내 서버 메모 API를 호출하고 JSON 오류를 처리합니다.
async function api(path = '', options = {}) {
  if (!session) throw new Error('로그인이 필요합니다.');
  if (!deviceApproved) throw new Error('서버의 기기 승인이 필요합니다.');
  const response = await fetch('/api/notes' + path, {
    ...options, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
  });
  const json = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(json?.error || '요청을 처리할 수 없습니다.');
  return json;
}
// 본인 메모 목록을 불러와 카드를 만들고 오래된 응답은 화면에 반영하지 않습니다.
async function load() {
  const ticket = generation;
  try {
    const rows = await api();
    if (ticket !== generation || !session) return;
    if (!Array.isArray(rows)) throw new Error('메모 형식을 확인하세요.');
    // 각 메모를 텍스트 요소와 수정·삭제 버튼이 있는 카드로 변환합니다.
    $('notes').replaceChildren(...rows.map(note => {
      const li = document.createElement('li'), title = document.createElement('strong'), body = document.createElement('p');
      title.textContent = note.title; body.textContent = note.body; body.className = 'body';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '수정';
      edit.onclick = async () => {
        try {
          const fresh = await api('/' + encodeURIComponent(note.id));
          editId = fresh.id; $('title').value = fresh.title; $('body').value = fresh.body;
          $('editor-heading').textContent = '가상 메모 수정'; $('save').textContent = '수정 저장'; $('cancel').hidden = false;
          $('title').focus();
        } catch (error) { message(error.message); }
      };
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '삭제';
      remove.onclick = async () => {
        if (!confirm('이 가상 메모를 삭제할까요?')) return;
        try { await api('/' + encodeURIComponent(note.id), { method: 'DELETE' }); if (editId === note.id) resetEditor(); await load(); message('삭제했습니다.'); }
        catch (error) { message(error.message); }
      };
      li.append(title, body, edit, remove); return li;
    }));
    message(rows.length ? '내 메모 ' + rows.length + '건' : '내 메모가 없습니다. 가상 메모를 추가하세요.');
  } catch (error) { if (ticket === generation) { $('notes').replaceChildren(); message(error.message); } }
}
// 로그인 상태에 맞춰 입력 화면과 메모 목록을 갱신합니다.
function showSession(next) {
  generation++; session = next; deviceApproved = false; $('notes').replaceChildren(); resetEditor();
  $('login').hidden = !!session; $('account').hidden = !session; $('device').hidden = !session;
  $('editor').hidden = true; $('notes').hidden = true; $('operations').hidden = !session;
  $('refresh-operations').disabled = true;
  $('operations-status').textContent = session
    ? '서버의 기기 승인이 끝나면 작전 기록을 불러옵니다.' : '로그인하면 작전실 상태를 확인합니다.';
  $('operations-summary').replaceChildren(); $('operations-checks').replaceChildren();
  $('account-label').textContent = session ? '로그인한 상태입니다.' : '';
  if (session) void checkDevice(); else message('로그인하면 기기 승인 상태를 확인합니다.');
}

async function checkDevice() {
  const ticket = generation;
  try {
    const response = await fetch('/api/device-approval', { credentials: 'same-origin', cache: 'no-store' });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || '기기 승인 상태를 확인할 수 없습니다.');
    if (ticket !== generation || !session) return;
    deviceApproved = state.approved === true;
    const code = typeof state.requestCode === 'string' ? ` 요청 코드: ${state.requestCode}` : '';
    $('device-status').textContent = deviceApproved ? `서버가 이 기기를 등록 기기로 확인했습니다.${code}`
      : state.status === 'pending' ? `승인 요청을 검토하고 있습니다.${code}` : '이 기기는 아직 승인되지 않았습니다.';
    $('request-device').hidden = deviceApproved || state.status === 'pending';
    $('editor').hidden = !deviceApproved; $('notes').hidden = !deviceApproved;
    $('refresh-operations').disabled = !deviceApproved;
    $('operations-status').textContent = deviceApproved
      ? '승인된 기기의 가린 서버 기록을 불러오는 중입니다.'
      : '기기 승인 전에는 작전 기록과 보호 자료를 표시하지 않습니다.';
    if (deviceApproved) { message('승인된 기기입니다. 내 자료와 작전실 기록을 불러옵니다.'); await Promise.all([load(), loadOperations()]); }
    else { $('notes').replaceChildren(); $('operations-summary').replaceChildren(); $('operations-checks').replaceChildren(); message('승인 전에는 보호 자료를 표시하지 않습니다.'); }
  } catch (error) {
    if (ticket === generation) {
      deviceApproved = false; $('editor').hidden = true; $('notes').hidden = true; $('notes').replaceChildren();
      $('refresh-operations').disabled = true; $('operations-status').textContent = '기기 승인 상태를 확인한 뒤 작전 기록을 표시합니다.';
      $('operations-summary').replaceChildren(); $('operations-checks').replaceChildren(); message(error.message);
    }
  }
}

// 서버가 가린 작전 기록만 카드와 표로 표시하며 미실행 값을 임의로 채우지 않습니다.
const operationCard = (name, value) => {
  const card = document.createElement('div'); card.className = 'operation-card';
  const heading = document.createElement('strong'); heading.textContent = name;
  const content = document.createElement('span'); content.textContent = value;
  card.append(heading, content); return card;
};

async function loadOperations() {
  if (!session || !deviceApproved) return;
  try {
    const requestId = crypto.randomUUID();
    const response = await fetch('/api/operations', { credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-Request-Id': requestId } });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || '작전실 기록을 확인할 수 없습니다.');
    const counts = data.checkCounts;
    if (!counts || counts.total !== data.checks?.length
        || counts.measured + counts.notRun !== counts.total) throw new Error('작전실 수치가 서버 기록과 다릅니다.');
    $('operations-summary').replaceChildren(
      operationCard('판정기 규칙', `${data.policy.count}개 · ${data.policy.ruleIds.join(', ')}`),
      operationCard('탐지 사건', data.detection.status === 'not_run' ? '미실행' : `${data.detection.eventCount}건`),
      operationCard('회수 상태', data.revocation.status === 'not_run' ? '미실행' : data.revocation.status),
      operationCard('복구 버전', `${data.recovery.version} · ${data.recovery.status}`),
      operationCard('점검 수치', `실측 ${counts.measured} · 기대 일치 ${counts.matched ?? '집계'} · 미실행 ${counts.notRun}`),
      operationCard('출처', `학생 코드 + ${data.sources.engine}`),
    );
    $('operations-checks').replaceChildren(...data.checks.map(item => {
      const row = document.createElement('tr');
      const values = [`${item.stage}단계 · ${item.kind === 'normal' ? '정상' : '금지'}`, item.request,
        item.expected, item.actual ?? '미실행', item.requestId ?? '미실행', item.checkedAt ?? '미실행'];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      row.className = item.status === 'measured' ? 'measured' : 'not-run'; return row;
    }));
    $('operations-status').textContent = `서버 기록 ${counts.total}개 중 실측 ${counts.measured}개, 미실행 ${counts.notRun}개입니다.`;
  } catch (error) {
    $('operations-status').textContent = error.message;
    $('operations-summary').replaceChildren(operationCard('작전실', error.message));
    $('operations-checks').replaceChildren();
  }
}
// 양식 제출 시 서버에 요청하고 성공 상태와 오류를 화면에 반영합니다.
$('login').onsubmit = async event => {
  event.preventDefault(); $('login-button').disabled = true;
  try {
    const data = await auth({ action: 'login', email: $('email').value.trim(), password: $('password').value });
    $('password').value = '';
    showSession(data.authenticated);
  } catch (error) { $('password').value = ''; message('로그인 실패: ' + error.message); }
  finally { $('login-button').disabled = false; }
};
$('logout').onclick = async () => {
  try { await auth({ action: 'logout' }); showSession(null); }
  catch (error) { message('로그아웃 실패: ' + error.message); }
};
$('refresh').onclick = () => deviceApproved ? load() : checkDevice(); $('cancel').onclick = resetEditor;
$('refresh-device').onclick = checkDevice;
$('refresh-operations').onclick = loadOperations;
$('go-operations').onclick = () => $('operations').scrollIntoView({ behavior: 'smooth', block: 'start' });
$('request-device').onclick = async () => {
  $('request-device').disabled = true;
  try {
    const response = await fetch('/api/device-approval', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request' }) });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || '승인 요청을 처리할 수 없습니다.');
    await checkDevice();
  } catch (error) { message(error.message); }
  finally { $('request-device').disabled = false; }
};
// 양식 제출 시 서버에 요청하고 성공 상태와 오류를 화면에 반영합니다.
$('editor').onsubmit = async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    await api(editId ? '/' + encodeURIComponent(editId) : '', {
      method: editId ? 'PUT' : 'POST', body: JSON.stringify({ title: $('title').value, body: $('body').value }),
    });
    resetEditor(); await load();
  } catch (error) { message(error.message); } finally { $('save').disabled = false; }
};
// 서버 로그인 API를 호출하고 토큰 없이 인증 상태만 받습니다.
async function auth(body) {
  const response = await fetch('/api/auth', { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '로그인 요청을 처리할 수 없습니다.');
  return data;
}
try {
  showSession((await auth()).authenticated); $('login-button').disabled = false;
} catch { message('로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.'); }

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').hidden = false; });
$('install').onclick = async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $('install').hidden = true; };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
