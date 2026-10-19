// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.

// ---------- 13단계: 로그인 사용자·기기·세션 표시 ----------
// renderIdentity({ me, devices, sessions })
// 각 항목은 { status: 'loading'|'ok'|'error', mode, data?, error? } 입니다.
// DOM은 createElement·textContent만 사용하고, 매 호출마다 새 요소를 만들어
// 돌려주므로 다시 불러오기·오류 때 이전 사용자 값이 화면에 남지 않습니다.

const DEVICE_STATUS = { compliant: '정상', noncompliant: '점검 필요', unknown: '확인 불가' };
const SESSION_STATUS = { active: '사용 중', expired: '만료', revoked: '취소', unknown: '확인 불가' };
const MODE_NOTICE = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };

const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

// 원래 값과 한국어 뜻을 함께 보여 줍니다. 목록에 없는 값은 확인 불가(unknown)로 정리하고
// 받은 원래 값은 뒤에 따로 적습니다.
const labeled = (map, value) => {
  const raw = value === undefined || value === null ? 'unknown' : String(value);
  const known = Object.hasOwn(map, raw);
  const base = `${known ? map[raw] : '확인 불가'}(${known ? raw : 'unknown'})`;
  return !known && raw !== 'unknown' ? `${base} · 받은 값: ${raw}` : base;
};

// 확인 불가 계열 오류와 연결 실패를 구분해 문구를 만듭니다.
const failureText = (error, what) => {
  const code = error && error.code ? String(error.code) : '';
  const message = error && error.message ? String(error.message) : '오류 정보가 없습니다.';
  const unverifiable = code === 'CONTRACT_MISMATCH' || code === 'ENGINE_RESULT_UNVERIFIED';
  return `${what} ${unverifiable ? '확인 불가' : '연결 실패'}: ${message}${code ? ` (${code})` : ''}`;
};

// mode 안내는 ok뿐 아니라 loading·error에서도 함께 보여 줍니다.
const modeNotice = (resource) => {
  const mode = resource && resource.mode ? String(resource.mode) : '';
  const text = MODE_NOTICE[mode];
  if (!text) return null;
  const p = el('p', `${text}(${mode})`);
  p.setAttribute('data-student-mode', mode);
  return p;
};

const statusBlock = (title, resource, renderData) => {
  const section = el('section');
  section.append(el('h3', title));
  const notice = modeNotice(resource);
  if (notice) section.append(notice);
  if (!resource || resource.status === 'loading') {
    section.append(el('p', '불러오는 중'));
    return section;
  }
  if (resource.status === 'error') {
    const p = el('p', failureText(resource.error, title));
    p.setAttribute('data-student-error', 'true');
    section.append(p);
    return section;
  }
  if (resource.status !== 'ok') {
    section.append(el('p', `확인 불가(${resource.status || 'unknown'})`));
    return section;
  }
  renderData(section, resource.data);
  return section;
};

const renderIdentity = ({ me, devices, sessions } = {}) => {
  const root = el('div');
  root.setAttribute('data-student-view', 'identity');

  // 로그인 사용자·현재 기기·현재 세션 (me)
  root.append(statusBlock('로그인 정보', me, (section, data) => {
    const user = data && data.user ? data.user : {};
    const device = data && data.device ? data.device : {};
    const session = data && data.session ? data.session : {};
    const dl = el('dl');
    const row = (name, value) => { dl.append(el('dt', name)); dl.append(el('dd', value)); };
    row('사용자', `${user.label || '(이름 없음)'} (id: ${user.id || '확인 불가'})`);
    row('현재 기기', `${device.label || device.id || '확인 불가'} · ${labeled(DEVICE_STATUS, device.status)}`);
    row('현재 세션', `${session.id || '확인 불가'} · ${labeled(SESSION_STATUS, session.status)}`);
    section.append(dl);
  }));

  // 내 이름으로 등록된 기기 목록 (devices)
  root.append(statusBlock('등록 기기', devices, (section, list) => {
    if (!Array.isArray(list) || list.length === 0) {
      section.append(el('p', '등록된 기기가 없습니다.'));
      return;
    }
    const ul = el('ul');
    for (const d of list) {
      const li = el('li', `${(d && (d.label || d.id)) || '확인 불가'} · ${labeled(DEVICE_STATUS, d && d.status)}`);
      li.setAttribute('data-student-device-id', String((d && d.id) || ''));
      ul.append(li);
    }
    section.append(ul);
  }));

  // 현재 확인된 세션 목록 (sessions)
  root.append(statusBlock('로그인 세션', sessions, (section, list) => {
    if (!Array.isArray(list) || list.length === 0) {
      section.append(el('p', '표시할 세션이 없습니다.'));
      return;
    }
    const ul = el('ul');
    for (const s of list) {
      const li = el('li', `${(s && s.id) || '확인 불가'} · ${labeled(SESSION_STATUS, s && s.status)}`);
      li.setAttribute('data-student-session-id', String((s && s.id) || ''));
      ul.append(li);
    }
    section.append(ul);
  }));

  return root;
};

// ---------- 14단계: 업무 앱 접속 판정 표시 ----------
// renderDecision({ status, mode, data?, error?, appId })
// data: { appId, decision: 'allow'|'deny'|'challenge'|'unknown', reason, checkedAt }
const DECISION_LABEL = { allow: '접근 허용', deny: '접근 거부', challenge: '추가 인증 또는 확인 필요', unknown: '판정 확인 불가' };
const DECISION_NOTE = {
  allow: '정책상 접근 허용 판정이며 실제 앱 접속 성공을 뜻하지 않습니다.',
  deny: '정책상 접근 거부 판정입니다.',
  challenge: '추가 확인이 필요한 판정입니다. 이 앱이 확인 절차를 대신하지 않습니다.',
  unknown: '판정을 확인할 수 없습니다. 접근이 허용된 것이 아닙니다.',
};

const renderDecision = (input = {}) => {
  const { status } = input || {};
  const root = el('div');
  root.setAttribute('data-student-view', 'decision');
  const notice = modeNotice(input);
  if (notice) root.append(notice);

  if (status === 'idle' || status === undefined || status === null) {
    root.append(el('p', '업무 앱을 하나 골라 접속을 요청하세요.'));
    return root;
  }
  if (status === 'loading') {
    root.append(el('p', '판정 확인 중…'));
    return root;
  }
  if (status === 'error') {
    const p = el('p', `요청 실패: ${(input.error && input.error.message) || '오류 정보가 없습니다.'}`);
    p.setAttribute('data-student-error', 'true');
    root.append(p);
    root.append(el('p', '요청이 실패한 것이며 접근 거부 판정이 아닙니다.'));
    return root;
  }
  if (status !== 'ok') {
    root.append(el('p', `판정 확인 불가(${status || 'unknown'})`));
    return root;
  }

  const data = input.data || {};
  const raw = data.decision === undefined || data.decision === null ? 'unknown' : String(data.decision);
  const known = Object.hasOwn(DECISION_LABEL, raw);
  const shown = known ? raw : 'unknown';
  const appId = data.appId || input.appId || '확인 불가';

  const result = el('p', `${DECISION_LABEL[shown]}(${shown})`);
  result.setAttribute('data-student-decision', shown);
  root.append(result);
  if (!known && raw !== 'unknown') {
    root.append(el('p', `목록에 없는 판정값을 받았습니다(받은 값: ${raw}). 확인 불가로 처리합니다.`));
  }
  root.append(el('p', `업무 앱: ${appId}`));
  root.append(el('p', `이유: ${data.reason || '확인 불가'}`));
  root.append(el('p', `판정 시각: ${data.checkedAt || '확인 불가'}`));
  root.append(el('p', DECISION_NOTE[shown]));
  return root;
};

// ---------- 15단계: 내 접속 기록과 XDR 경보 ----------
// renderEvents({ status, mode, data?, error? })
// 기록: { id, kind, at, appId, summary, evidence:[{id,text}], rules:[{id,text}],
//         state:{access,session,device}, supportedActions }
// 걸러 보기는 받은 배열 안에서만 하고, 서버에 다시 묻지 않습니다.
const EVENT_KIND = { access: '접속 기록', xdr: 'XDR 경보' };
const ACCESS_LABEL = { allowed: '허용됨', denied: '거부됨', unknown: '확인 불가' };
const accessLabel = (v) => labeled(ACCESS_LABEL, v);
const kindLabel = (v) => labeled(EVENT_KIND, v);

// 선택 상자 값과 표시 상태는 같은 뷰 안에 둡니다.
const makeEventFilter = (labelText, options, current, onPick) => {
  const wrap = el('label');
  const select = el('select');
  select.setAttribute('aria-label', labelText);
  const add = (value, text) => {
    const opt = el('option', text);
    opt.value = value;
    if (value === current) opt.selected = true;
    select.append(opt);
  };
  add('all', '전체');
  for (const v of options) add(v, v);
  select.addEventListener('change', () => onPick(select.value));
  wrap.append(el('span', `${labelText} `));
  wrap.append(select);
  return wrap;
};

const renderEventDetail = (ev) => {
  const detail = el('div');
  detail.setAttribute('data-student-event-detail', String(ev.id));
  detail.append(el('h4', `사건 상세: ${ev.id}`));
  const dl = el('dl');
  const row = (name, value) => { dl.append(el('dt', name)); dl.append(el('dd', value)); };
  row('사건 ID', ev.id);
  row('종류', kindLabel(ev.kind));
  row('시각', ev.at || '확인 불가');
  row('앱', ev.appId ? String(ev.appId) : '앱 확인 불가(없음)');
  row('요약', ev.summary || '(요약 없음)');
  const state = ev.state || {};
  row('접속 상태', accessLabel(state.access));
  row('세션 상태', labeled(SESSION_STATUS, state.session));
  row('기기 상태', labeled(DEVICE_STATUS, state.device));
  detail.append(dl);
  const evidence = Array.isArray(ev.evidence) ? ev.evidence : [];
  detail.append(el('h5', '근거'));
  if (!evidence.length) detail.append(el('p', '표시할 근거가 없습니다.'));
  else {
    const ul = el('ul');
    for (const item of evidence) ul.append(el('li', `${item && item.id ? item.id : '확인 불가'}: ${item && item.text ? item.text : '(내용 없음)'}`));
    detail.append(ul);
  }
  const rules = Array.isArray(ev.rules) ? ev.rules : [];
  detail.append(el('h5', '적용 규칙'));
  if (!rules.length) detail.append(el('p', '표시할 규칙이 없습니다.'));
  else {
    const ul = el('ul');
    for (const item of rules) ul.append(el('li', `${item && item.id ? item.id : '확인 불가'}: ${item && item.text ? item.text : '(내용 없음)'}`));
    detail.append(ul);
  }
  return detail;
};

const renderEvents = (input, ui, onChange) => {
  const { status } = input || {};
  const root = el('div');
  root.setAttribute('data-student-view', 'events');
  const notice = modeNotice(input);
  if (notice) root.append(notice);

  if (status === 'loading') {
    root.append(el('p', '기록을 불러오는 중…'));
    return root;
  }
  if (status === 'error') {
    const code = input.error && input.error.code ? String(input.error.code) : '';
    const msg = (input.error && input.error.message) || '오류 정보가 없습니다.';
    const p = el('p', code === 'CONTRACT_MISMATCH'
      ? `기록 확인 불가: ${msg} (${code})`
      : `기록을 불러오지 못했습니다: ${msg}${code ? ` (${code})` : ''}`);
    p.setAttribute('data-student-error', 'true');
    root.append(p);
    return root;
  }
  if (status !== 'ok') {
    root.append(el('p', `기록 확인 불가(${status || 'unknown'})`));
    return root;
  }

  const data = Array.isArray(input.data) ? input.data : [];
  // 새 자료(내용이 바뀐 목록)가 오면 열려 있던 상세를 닫고 필터를 다시 맞춥니다.
  const fp = data.map(e => `${e && e.id}:${e && e.at}`).join('|');
  if (fp !== ui.eventsFp) { ui.eventsFp = fp; ui.openDetail = null; }

  if (data.length === 0) {
    root.append(el('p', '표시할 기록이 없습니다.'));
    return root;
  }

  const kinds = [...new Set(data.map(e => e && e.kind).filter(v => v !== undefined && v !== null && v !== ''))].map(String);
  const apps = [...new Set(data.map(e => e && e.appId).filter(v => v !== undefined && v !== null && v !== ''))].map(String);
  const accesses = [...new Set(data.map(e => e && e.state && e.state.access).filter(v => v !== undefined && v !== null && v !== ''))].map(String);
  for (const [key, options] of [['kind', kinds], ['app', apps], ['access', accesses]]) {
    if (ui.filter[key] !== 'all' && !options.includes(ui.filter[key])) ui.filter[key] = 'all';
  }

  const bar = el('div');
  bar.append(makeEventFilter('기록 종류', kinds, ui.filter.kind, v => { ui.filter.kind = v; onChange(); }));
  bar.append(makeEventFilter('업무 앱', apps, ui.filter.app, v => { ui.filter.app = v; onChange(); }));
  bar.append(makeEventFilter('접속 상태', accesses, ui.filter.access, v => { ui.filter.access = v; onChange(); }));
  root.append(bar);

  const shown = data
    .filter(e => e && (ui.filter.kind === 'all' || String(e.kind) === ui.filter.kind))
    .filter(e => (ui.filter.app === 'all' || String(e.appId || '') === ui.filter.app))
    .filter(e => (ui.filter.access === 'all' || String(e.state && e.state.access) === ui.filter.access))
    .slice()
    .sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0));

  if (shown.length === 0) {
    root.append(el('p', '조건에 맞는 기록이 없습니다.'));
    return root;
  }

  const ul = el('ul');
  for (const ev of shown) {
    const li = el('li');
    li.setAttribute('data-student-event-id', String(ev.id));
    const line = el('p', `${ev.at || '확인 불가'} · ${kindLabel(ev.kind)} · 앱 ${ev.appId ? String(ev.appId) : '확인 불가(없음)'} · ${ev.summary || '(요약 없음)'}`);
    li.append(line);
    const btn = el('button', `${ev.id} 상세`);
    btn.type = 'button';
    btn.setAttribute('aria-label', `${ev.id} 상세`);
    btn.addEventListener('click', () => { ui.openDetail = ui.openDetail === ev.id ? null : ev.id; onChange(); });
    li.append(btn);
    if (ui.openDetail === ev.id) li.append(renderEventDetail(ev));
    ul.append(li);
  }
  root.append(ul);
  root.append(el('p', `총 ${shown.length}건 표시 (받은 ${data.length}건 중)`));
  return root;
};

export function createStudentView({ onChange } = {}) {
  const ui = { filter: { kind: 'all', app: 'all', access: 'all' }, openDetail: null, eventsFp: null };
  const rerender = () => { if (typeof onChange === 'function') onChange(); };
  return {
    renderIdentity,
    renderDecision,
    renderEvents(input) { return renderEvents(input, ui, rerender); },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
