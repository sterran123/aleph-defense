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

// 원래 값과 한국어 뜻을 함께 보여 줍니다. 목록에 없는 값은 확인 불가로 둡니다.
const labeled = (map, value) => {
  const raw = value === undefined || value === null ? 'unknown' : String(value);
  const known = Object.hasOwn(map, raw);
  return `${known ? map[raw] : '확인 불가'}(${raw})`;
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

export function createStudentView() {
  return {
    renderIdentity,
    renderDecision() { return '학생 구현 대기: 서버의 판정과 이유를 연결하세요.'; },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
