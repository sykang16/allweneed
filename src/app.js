// ───────── 상태 ─────────
const LS_TPL = 'reqai.template.v1', LS_META = 'reqai.meta.v1';
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } };

const S = {
  step: 1,
  sources: [], nextId: 1,
  M: createMasker(),
  ai: { state: 'checking', provider: null, model: '', note: '', sample: null, downloads: null },
  trace: [], importLog: null,
  accessCode: (() => { try { return sessionStorage.getItem('reqai.code') || ''; } catch { return ''; } })(),
  precise: false,
  result: null, history: [], resolved: new Set(),
  tab: 'req', reqFilter: '전체', openReq: null, editReq: null, editBuf: null, delArm: false,
  showOriginal: true, exportRestore: true,
  run: null,
  apply: { kind: 'reply', from: '', date: today(), text: '', previewed: false },
  meta: Object.assign({ docName: '', title: '', dept: '', author: '', date: today(), system: '', version: 'v1.0', due: '' }, lsGet(LS_META) || {}, { date: today() }),
  tplKey: 'std', template: lsGet(LS_TPL) || clone(TEMPLATE_PRESETS.std)
};

function addSource(kind, fields) {
  const s = Object.assign({ id: 'S' + S.nextId++, kind, title: '', author: '', date: today(), text: '' }, fields);
  S.sources.push(s);
  return s;
}
function loadSample() {
  S.sources = []; S.nextId = 1; S.M = createMasker();
  SAMPLE_SOURCES.forEach(s => addSource(s.kind, clone(s)));
  S.result = null; S.history = []; S.resolved = new Set(); S.run = null; S.trace = []; S.importLog = null;
  S.meta.title = ''; S.meta.dept = S.meta.dept || '○○사업부';
}
function sampleIntact() {
  const base = S.sources.filter(s => s.kind !== 'reply');
  return base.length === SAMPLE_SOURCES.length && SAMPLE_SOURCES.every((x, i) => base[i].text.trim() === x.text.trim() && base[i].kind === x.kind);
}
function maskAll(list = S.sources) {
  // 먼저 모든 자료에서 민감정보를 찾아 둔 뒤 가려야, 뒤 자료에서 찾은 이름도 앞 자료에서 가려집니다.
  for (const s of S.sources) findSpans(S.M, `${s.title}\n${s.author}\n${s.text}`);
  for (const s of list) { s.mTitle = maskText(S.M, s.title); s.mAuthor = maskText(S.M, s.author); s.masked = maskText(S.M, s.text); }
  return list;
}
function bindDemo(obj) {
  return JSON.parse(JSON.stringify(obj).replace(/\{\{([^}]+)\}\}/g, (_, name) => {
    for (const it of S.M.items.values()) if (it.on && it.value === name) return it.token;
    return name;
  }));
}
const srcById = id => S.sources.find(s => s.id === id);
const R = t => richText(S.M, t, S.showOriginal);

// ───────── AI 연결 확인 ─────────
// 사내 LLM(serve.py 프록시)이 설정돼 있으면 그것을 먼저 쓰고, 아니면 claude.ai, 둘 다 없으면 예시 모드입니다.
async function detectAI() {
  try {
    if (CFG.llm && CFG.llm.endpoint) {
      S.ai.provider = 'local'; S.ai.model = CFG.llm.model || '';
      const h = await fetch(CFG.llm.health || '/api/health', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ ok: false, error: 'serve.py에 연결하지 못했습니다.' }));
      S.ai.state = h.ok ? 'ready' : 'down';
      S.ai.note = h.ok ? '' : (h.error || 'AI에 연결하지 못했습니다.');
      if (h.model) S.ai.model = h.model;
    } else if (window.claude && typeof window.claude.use === 'function') {
      S.ai.provider = 'claude';
      const [sample, downloads] = await Promise.all([window.claude.use('sample'), window.claude.use('downloads')]);
      S.ai.sample = sample; S.ai.downloads = downloads;
      S.ai.state = typeof sample === 'function' ? 'ready' : 'demo';
    } else S.ai.state = 'demo';
  } catch { S.ai.state = 'demo'; }
  renderBadge();
  if (S.step === 3) render();
}
function renderBadge() {
  const el = $('#ai-badge');
  const st = S.ai.state;
  el.className = 'ai-badge ' + st;
  const local = S.ai.provider === 'local';
  el.innerHTML = st === 'ready' ? (local && S.ai.fallback ? `<i></i>Claude 크레딧 부족 · ${esc(S.ai.fallbackModel || '대체 모델')}로 분석` : local ? `<i></i>${esc(CFG.llm?.label || '사내 LLM')} 연결됨${S.ai.model ? ' · ' + esc(S.ai.model) : ''}` : '<i></i>AI 연결됨')
    : st === 'checking' ? '<i></i>AI 연결 확인 중'
    : st === 'denied' ? '<i></i>AI 사용 안 함 · 예시 모드'
    : st === 'down' ? `<i></i>${esc(CFG.llm?.label || '사내 LLM')} 연결 안 됨 · 예시 모드`
    : '<i></i>예시 모드 · AI 미연결';
  el.title = st === 'ready' ? (local ? `분석은 settings.json에 지정한 ${esc(CFG.llm?.label || '사내 LLM')}로 실행됩니다.` : '분석은 보는 사람의 Claude 계정으로 실행됩니다.')
    : st === 'down' ? S.ai.note + ' 사용자 매뉴얼의 문제 해결을 참고하세요.'
    : 'claude.ai나 사내 LLM에 연결하면 내 자료를 AI로 분석할 수 있습니다. 지금은 예시 결과로 모든 기능을 체험할 수 있습니다.';
}

// ───────── 렌더링 ─────────
const STEPS = [
  { n: 1, label: '자료 입력' }, { n: 2, label: '민감정보 가리기' }, { n: 3, label: 'AI 분석' }, { n: 4, label: '검토·점검' }, { n: 5, label: '문서 만들기' }
];
function canGo(n) {
  if (n <= 2) return true;
  if (n === 3) return S.sources.some(s => s.text.trim());
  return !!S.result;
}
function render() {
  $('#stepper').innerHTML = STEPS.map(s => `<button class="step ${S.step === s.n ? 'on' : ''} ${s.n < S.step || (s.n > 3 && S.result) ? 'done' : ''}" data-act="go" data-n="${s.n}" ${canGo(s.n) ? '' : 'disabled'} aria-current="${S.step === s.n ? 'step' : 'false'}"><b>${s.n}</b><span>${s.label}</span></button>`).join('<span class="step-line" aria-hidden="true"></span>');
  const v = [null, viewInput, viewMask, viewAnalyze, viewReview, viewExport][S.step];
  $('#main').innerHTML = v();
  afterRender();
}
function afterRender() {
  $$('textarea[data-autosize]').forEach(autosize);
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 640) + 'px'; }
function go(n) { if (!canGo(n)) return; S.step = n; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

const pill = st => `<span class="pill ${STATUS_CLASS[st] || ''}">${esc(st)}</span>`;
const refChip = ref => { const s = srcById(ref); return ref ? `<button class="ref" data-act="src" data-id="${esc(ref)}" title="${esc(s ? s.title : '')}">${esc(ref)}${s ? `<small>${esc(KIND_LABEL[s.kind])}</small>` : ''}</button>` : ''; };
const reqChip = id => id ? `<button class="reqchip" data-act="goreq" data-id="${esc(id)}">${esc(id)}</button>` : '<span class="reqchip all">전체</span>';

// 1단계: 자료 입력
function viewInput() {
  const total = S.sources.reduce((a, s) => a + s.text.length, 0);
  const col = kind => {
    const list = S.sources.filter(s => s.kind === kind || (kind === 'meeting' && s.kind === 'reply'));
    return `<section class="src-col">
      <header><h3>${KIND_LABEL[kind]}</h3><span class="muted">${{ need: '요청 메일·전화 메모·공문', meeting: '회의록·녹취 정리·회신', doc: '규정·매뉴얼·기존 설계서' }[kind]}</span></header>
      ${list.map(s => `<article class="src-card">
        <div class="src-head"><span class="sid">${s.id}</span>${s.kind === 'reply' ? '<span class="tag">회신</span>' : `<select class="kind-sel" data-act="srckind" data-id="${s.id}" aria-label="${s.id} 구분" title="구분 바꾸기">${['need', 'meeting', 'doc'].map(k => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select>`}<input id="t-${s.id}" class="src-title" data-bind="src:${s.id}:title" value="${esc(s.title)}" placeholder="제목" aria-label="${s.id} 제목"><button class="icon-btn" data-act="delsrc" data-id="${s.id}" aria-label="${s.id} 삭제" title="삭제">×</button></div>
        <div class="src-meta"><input id="a-${s.id}" data-bind="src:${s.id}:author" value="${esc(s.author)}" placeholder="작성·요청자 (예: 홍길동 과장, 운영팀)" aria-label="${s.id} 작성자"><input id="d-${s.id}" data-bind="src:${s.id}:date" value="${esc(s.date)}" placeholder="일자" aria-label="${s.id} 일자" class="date"></div>
        <textarea id="x-${s.id}" data-bind="src:${s.id}:text" data-autosize rows="6" placeholder="내용을 붙여 넣으세요" aria-label="${s.id} 내용">${esc(s.text)}</textarea>
        ${s.fileName ? `<div class="muted small">파일에서 읽음: ${esc(s.fileName)}</div>` : ''}
      </article>`).join('') || `<div class="empty">아직 자료가 없습니다.</div>`}
      <div class="src-add">
        <button class="btn ghost" data-act="addsrc" data-kind="${kind}">+ 직접 입력</button>
        <label class="drop" data-kind="${kind}"><input type="file" data-file="${kind}" multiple accept="${ACCEPT}"><span>파일 올리기</span><small>PDF · Word · Excel · PPT · HWPX · TXT</small></label>
      </div>
    </section>`;
  };
  const intact = sampleIntact();
  return `
  <div class="intro">
    <div>
      <h2>흩어진 자료를 넣으면, 빠짐없는 요구사항 정의서가 나옵니다</h2>
      <p>고객 요청, 회의록, 참고 문서를 넣으세요. 민감정보를 먼저 가린 뒤 AI가 요구사항을 뽑고, 출처를 달고, 빠진 것과 서로 다른 의견을 찾아 확인 질문까지 만듭니다.</p>
    </div>
    ${intact ? `<div class="sample-note"><b>예시 자료가 들어 있습니다</b><span>가상의 '가맹점 매출조회 포털 개선' 건입니다. 고객 메일, 회의록, 참고 문서가 하나씩 있습니다.</span><div class="row"><button class="btn primary" data-act="demo-fast">예시 결과 바로 보기</button><button class="btn ghost" data-act="clear">지우고 내 자료 넣기</button></div></div>`
      : `<div class="sample-note"><b>내 자료로 작업 중</b><span>자료는 이 브라우저에만 있고, 창을 닫으면 사라집니다.</span><div class="row"><button class="btn ghost" data-act="sample">예시 자료 다시 불러오기</button></div></div>`}
  </div>
  <div class="bulk">
    <label class="drop bulk-drop" data-kind="auto"><input type="file" data-file="auto" multiple accept="${ACCEPT}"><span>폴더째 끌어다 놓기</span><small>폴더나 여러 파일을 한 번에 놓으면 하위 폴더까지 읽고, 파일·폴더 이름으로 고객 니즈 · 회의 내용 · 참고 문서를 나눕니다. 구분은 카드에서 바꿀 수 있습니다.</small></label>
    <label class="btn folder-btn"><input type="file" data-file="auto" webkitdirectory multiple>폴더 선택</label>
  </div>
  ${importNote()}
  <div class="src-grid">${col('need')}${col('meeting')}${col('doc')}</div>
  <div class="bar"><span class="muted" id="src-count">자료 ${S.sources.length}건 · ${fmtNum(total)}자</span><button class="btn primary" data-act="go" data-n="2" ${canGo(3) ? '' : 'disabled'}>다음: 민감정보 가리기 →</button></div>`;
}

function importNote() {
  const L = S.importLog;
  if (!L) return '';
  const by = ['need', 'meeting', 'doc'].map(k => [k, L.added.filter(a => a.kind === k).length]).filter(x => x[1]);
  return `<div class="notice ${L.failed.length ? 'warn' : 'ok'} import-note">
    <b>${L.from} ${fmtNum(L.added.length)}개를 자료로 넣었습니다.</b> ${by.map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(' · ')}
    ${L.skipped.length ? `<div class="small">건너뜀 ${L.skipped.length}개 (지원하지 않는 형식·숨김·임시 파일): ${esc(L.skipped.slice(0, 6).join(', '))}${L.skipped.length > 6 ? ' 외' : ''}</div>` : ''}
    ${L.failed.length ? `<div class="small">읽지 못함 ${L.failed.length}개: ${L.failed.map(f => `${esc(f.path)} (${esc(f.error)})`).join(', ')}</div>` : ''}
    <button class="icon-btn" data-act="closeimport" aria-label="알림 닫기">×</button>
  </div>`;
}

// 2단계: 마스킹
function viewMask() {
  maskAll();
  const all = s => `${s.title}
${s.author}
${s.text}`;
  const items = [...S.M.items.values()].filter(it => S.sources.some(s => all(s).includes(it.value)));
  const counts = new Map();
  for (const s of S.sources) for (const sp of findSpans(S.M, all(s))) counts.set(sp.item.key, (counts.get(sp.item.key) || 0) + 1);
  const groups = MASK_TYPES.map(t => [t, items.filter(i => i.type === t)]).filter(g => g[1].length);
  const onCount = items.filter(i => i.on).length;
  return `
  <div class="mask-layout">
    <aside class="panel mask-side">
      <h3>찾은 민감정보 <span class="count">${items.length}</span></h3>
      <p class="muted small">체크된 항목은 AI에 보내기 전에 토큰으로 바뀝니다. 원래 값은 이 브라우저에만 남고, 결과 화면과 내려받는 문서에서 다시 채워집니다.</p>
      ${groups.map(([t, list]) => `<div class="mgroup"><h4>${esc(t)}</h4>${list.map(it => `<label class="mrow ${it.on ? '' : 'off'}"><input type="checkbox" data-act="mtoggle" data-key="${esc(it.key)}" ${it.on ? 'checked' : ''}><span class="mval">${esc(it.value)}</span><span class="mtok">${esc(it.token)}</span><span class="mcnt">${counts.get(it.key) || 0}회</span></label>`).join('')}</div>`).join('') || '<div class="empty">자동으로 찾은 항목이 없습니다.</div>'}
      <div class="mgroup">
        <h4>직접 가릴 단어</h4>
        <div class="row"><input id="custom-word" placeholder="예: 기관명, 사업명, 프로젝트 코드" aria-label="가릴 단어"><button class="btn" data-act="addword">추가</button></div>
        <div class="chips">${S.M.custom.map((w, i) => `<span class="chip">${esc(w)}<button data-act="delword" data-i="${i}" aria-label="${esc(w)} 제거">×</button></span>`).join('')}</div>
      </div>
      <p class="muted small">자동 탐지: 이름(직위 앞), 휴대폰·전화, 이메일, 카드·계좌·주민·사업자번호, IP 주소</p>
    </aside>
    <section class="mask-preview">
      <div class="notice"><b>AI에는 아래처럼 가려진 내용만 전송됩니다.</b> 검게 가린 부분은 ${onCount}종, 점선은 가리지 않기로 한 값입니다.</div>
      ${S.sources.filter(s => s.text.trim()).map(s => `<article class="panel prev"><header><span class="sid">${s.id}</span><b>${maskPreviewHTML(S.M, s.title || '(제목 없음)')}</b><span class="muted">${esc(KIND_LABEL[s.kind])}</span></header><div class="prev-meta">${maskPreviewHTML(S.M, s.author || '작성자 미상')} · ${esc(s.date)}</div><pre class="prev-text">${maskPreviewHTML(S.M, s.text)}</pre></article>`).join('')}
    </section>
  </div>
  <div class="bar"><button class="btn ghost" data-act="go" data-n="1">← 자료 입력</button><button class="btn primary" data-act="go" data-n="3">이대로 AI 분석 준비 →</button></div>`;
}

// 3단계: 분석
function viewAnalyze() {
  maskAll();
  const list = S.sources.filter(s => s.text.trim());
  const chars = list.reduce((a, s) => a + s.masked.length, 0);
  const masked = [...S.M.items.values()].filter(i => i.on && list.some(s => `${s.title}
${s.author}
${s.text}`.includes(i.value))).length;
  const ai = S.ai.state, intact = sampleIntact(), run = S.run;
  const busy = run && run.busy;
  let actions = '';
  if (ai === 'ready') actions += `<button class="btn primary big" data-act="analyze" ${busy ? 'disabled' : ''}>AI로 분석 시작</button><label class="check"><input type="checkbox" id="precise" data-act="precise" ${S.precise ? 'checked' : ''}> 정밀 분석 (더 오래 걸림)</label>`;
  if (intact) actions += `<button class="btn ${ai === 'ready' ? 'ghost' : 'primary big'}" data-act="demo" ${busy ? 'disabled' : ''}>예시 분석 결과 불러오기</button>`;
  let note = '';
  if (ai === 'checking') note = '<p class="muted">AI 연결을 확인하고 있습니다…</p>';
  else if (ai !== 'ready' && !intact) note = `<div class="notice warn"><b>지금 화면에서는 AI를 쓸 수 없습니다.</b> ${ai === 'down' ? esc(S.ai.note) + ' settings.json의 llm 설정과 serve.py 실행 창의 메시지를 확인하세요.' : '이 페이지를 claude.ai에 로그인한 상태로 열거나, serve.py로 사내 LLM에 연결하면 내 자료를 분석할 수 있습니다.'} 예시 자료로 돌아가면 미리 분석한 결과로 모든 기능을 체험할 수 있습니다. <button class="btn ghost" data-act="sample">예시 자료 불러오기</button></div>`;
  else if (ai !== 'ready') note = '<p class="muted small">AI가 연결되지 않은 화면입니다. 예시 자료를 미리 분석해 둔 결과로 다음 단계를 모두 체험할 수 있습니다.</p>';
  else if (S.ai.provider === 'local' && CFG.llm?.needCode) note = `<label class="fld code-fld"><span>심사용 접속 코드</span><input id="access-code" type="password" data-bind="code" value="${esc(S.accessCode)}" placeholder="안내받은 코드" autocomplete="off"></label><p class="muted small">AI 분석은 접속 코드를 넣은 경우에만 실행됩니다. 코드 없이도 '예시 분석 결과 불러오기'로 모든 기능을 체험할 수 있습니다.</p>`;
  else if (S.ai.provider === 'local') note = `<p class="muted small">분석은 ${esc(CFG.llm?.label || '사내 LLM')}(${esc(S.ai.model || '설정된 모델')})로 실행됩니다. 가린 내용만 serve.py를 거쳐 전송됩니다.${intact ? ' 예시 자료는 미리 분석한 결과를 바로 불러올 수도 있습니다.' : ''}</p>`;
  else note = `<p class="muted small">분석은 이 페이지를 연 사람의 Claude 계정으로 실행됩니다. 처음 실행할 때 사용 허용 여부를 묻습니다.${intact ? ' 예시 자료는 미리 분석한 결과를 바로 불러올 수도 있습니다.' : ''}</p>`;
  return `
  <div class="analyze">
    <section class="panel send-sum">
      <h3>AI에 보낼 내용</h3>
      <dl class="stats"><div><dt>자료</dt><dd>${list.length}<small>건</small></dd></div><div><dt>글자 수</dt><dd>${fmtNum(chars)}<small>자</small></dd></div><div><dt>가린 민감정보</dt><dd>${masked}<small>종</small></dd></div></dl>
      <ul class="src-mini">${list.map(s => `<li><span class="sid">${s.id}</span>${esc(KIND_LABEL[s.kind])} · ${R(s.mTitle || '(제목 없음)')}</li>`).join('')}</ul>
      <button class="btn ghost small" data-act="go" data-n="2">가린 내용 다시 보기</button>
    </section>
    <section class="panel run-panel">
      <h3>분석 단계</h3>
      <ol class="stages">${stageList().map(st => `<li class="${st.state}"><i></i><div><b>${st.label}</b><span>${st.desc}</span></div></li>`).join('')}</ol>
      <div id="run-box">${S.run && S.run.where !== 'apply' ? runBox() : ''}</div>
      <div class="row wrap">${actions}${busy ? '<button class="btn danger" data-act="stop">멈추기</button>' : ''}</div>
      ${note}
      ${S.result && !busy ? `<div class="bar inner"><span>분석 결과가 있습니다: 요구사항 ${S.result.requirements.length}건</span><button class="btn primary" data-act="go" data-n="4">검토·점검으로 →</button></div>` : ''}
    </section>
  </div>`;
}
function engineLabel() {
  return S.ai.provider === 'local' ? `${CFG.llm?.label || '사내 LLM'} (${S.ai.model || '모델 미지정'}${S.precise && CFG.llm?.modelPrecise ? ', 정밀: ' + CFG.llm.modelPrecise : ''}${CFG.llm?.effort ? ', effort ' + (S.precise ? CFG.llm.effortPrecise : CFG.llm.effort) : ''})` : `Claude (claude.ai, ${S.precise ? '정밀' : '기본'} 등급)`;
}
const STAGE_DEFS = [
  { label: '요구사항 추출·분류', desc: '요청 문장을 찾아 유형을 나누고 출처를 답니다' },
  { label: '회의 내용 분석', desc: 'AS-IS/TO-BE, 수용 여부, 결정·미결·후속 조치' },
  { label: '누락·충돌 점검', desc: '필수 항목 누락, 상충 의견, 모호한 표현' },
  { label: '확인 질문 작성', desc: '누구에게 무엇을 물을지 대상자별로 묶습니다' }
];
function stageList() {
  const st = (S.run && S.run.where !== 'apply' && S.run.stages) || STAGE_DEFS.map(() => (S.result ? 'done' : 'wait'));
  return STAGE_DEFS.map((d, i) => Object.assign({ state: st[i] }, d));
}
function runBox() {
  const r = S.run;
  if (!r) return '';
  if (r.error) return `<div class="notice err">${esc(r.error)}</div>`;
  if (r.busy) return `<div class="live"><span class="spinner" aria-hidden="true"></span><span>${esc(r.msg || 'AI가 자료를 읽고 있습니다')}</span><span class="muted" id="run-meta">${r.chars ? fmtNum(r.chars) + '자 작성 · ' : ''}${Math.round((Date.now() - r.t0) / 1000)}초</span></div>`;
  return r.done ? `<div class="notice ok">${esc(r.done)}</div>` : '';
}
function updateRunBox() { const b = $('#run-box'); if (b) b.innerHTML = runBox(); }

// 4단계: 검토
function viewReview() {
  const r = S.result;
  const c = r.checks;
  const open = (k, l) => l.filter(x => !S.resolved.has(checkKey(k, x))).length;
  const nChecks = open('missing', c.missing) + open('conflicts', c.conflicts) + open('ambiguous', c.ambiguous);
  const tabs = [['req', '요구사항', r.requirements.length], ['meeting', '회의 분석', r.meeting.openIssues.length ? `미결 ${r.meeting.openIssues.length}` : ''], ['checks', '누락·충돌 점검', nChecks], ['mail', '확인 질문 메일', r.questions.length], ['apply', '회신 반영·이력', S.history.length]];
  const body = { req: tabReq, meeting: tabMeeting, checks: tabChecks, mail: tabMail, apply: tabApply }[S.tab]();
  return `
  <div class="review-head">
    <div><span class="eyebrow">${r.isDemo ? '예시 결과 · 미리 분석한 데이터' : 'AI 분석 결과'}</span><h2>${R(r.project.title)}</h2><p class="muted">${R(r.project.summary)}</p></div>
    <div class="review-tools"><label class="switch"><input type="checkbox" data-act="orig" ${S.showOriginal ? 'checked' : ''}><span>가린 값 복원해서 보기</span></label><button class="btn ghost small" data-act="dl" data-f="trace" title="요구사항별 판단 근거, AI 호출 기록, 변경 이력을 Markdown으로 내려받습니다">AI 판단 기록 (.md)</button></div>
  </div>
  <nav class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" aria-selected="${S.tab === k}" class="${S.tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${l}${n !== '' && n !== 0 ? `<span class="count">${n}</span>` : ''}</button>`).join('')}</nav>
  <div class="tab-body">${body}</div>
  <div class="bar"><button class="btn ghost" data-act="go" data-n="3">← 분석</button><button class="btn primary" data-act="go" data-n="5">다음: 문서 만들기 →</button></div>`;
}

function tabReq() {
  const reqs = S.result.requirements;
  const cnt = s => reqs.filter(r => r.status === s).length;
  const total = reqs.length || 1;
  const confirmed = reqs.filter(r => r.confirmed).length;
  const list = S.reqFilter === '전체' ? reqs : reqs.filter(r => r.status === S.reqFilter);
  const catCounts = CATEGORIES.map(k => [k, reqs.filter(r => r.category === k).length]).filter(x => x[1]);
  return `
  <div class="req-summary">
    <div class="sbar" role="img" aria-label="수용 여부 분포">${STATUSES.map(s => cnt(s) ? `<span class="${STATUS_CLASS[s]}" style="flex:${cnt(s)}" title="${s} ${cnt(s)}건"></span>` : '').join('')}</div>
    <div class="filters">${['전체', ...STATUSES].map(s => `<button class="fchip ${S.reqFilter === s ? 'on' : ''} ${STATUS_CLASS[s] || ''}" data-act="filter" data-s="${s}">${s}<b>${s === '전체' ? reqs.length : cnt(s)}</b></button>`).join('')}</div>
    <div class="muted small">${catCounts.map(([k, n]) => `${k} ${n}`).join(' · ')} &nbsp;|&nbsp; 확정 <b>${confirmed}</b>/${reqs.length}</div>
  </div>
  <div class="tbl-wrap"><table class="req-tbl">
    <thead><tr><th>ID</th><th>요구사항명</th><th>유형</th><th>우선</th><th>수용 여부</th><th>출처</th><th>확정</th></tr></thead>
    <tbody>${list.map(r => reqRow(r)).join('') || `<tr><td colspan="7" class="empty">해당하는 요구사항이 없습니다.</td></tr>`}</tbody>
  </table></div>
  <div class="row"><button class="btn ghost" data-act="addreq">+ 요구사항 추가</button><span class="muted small">행을 누르면 상세 내용과 근거 문장을 봅니다. 사람이 확인한 항목은 확정에 체크하세요.</span></div>`;
}
function reqRow(r) {
  const isOpen = S.openReq === r.id;
  const refs = [...new Set(r.sources.map(s => s.ref))];
  const row = `<tr class="rrow ${isOpen ? 'open' : ''} ${r.confirmed ? 'confirmed' : ''}" data-act="openreq" data-id="${r.id}" tabindex="0">
    <td class="mono">${r.id}${r._changed ? `<span class="chg ${r._changed}">${r._changed === 'added' ? '추가' : '변경'}</span>` : ''}</td>
    <td class="ttl">${R(r.title)}${r.confidence === '낮음' ? '<span class="conf c-낮음" title="AI 확신도 낮음: 원 자료로 다시 확인하세요">확인</span>' : ''}</td><td>${esc(r.category)}</td><td class="pri p-${r.priority}">${esc(r.priority)}</td><td>${pill(r.status)}</td>
    <td class="refs">${refs.map(refChip).join('')}</td>
    <td><input type="checkbox" data-act="confirm" data-id="${r.id}" ${r.confirmed ? 'checked' : ''} aria-label="${r.id} 확정"></td></tr>`;
  if (!isOpen) return row;
  return row + `<tr class="detail"><td colspan="7">${S.editReq === r.id ? reqEditor() : reqDetail(r)}</td></tr>`;
}
function reqDetail(r) {
  return `<div class="rdetail">
    <div class="rd-main">
      <p>${R(r.description)}</p>
      <div class="asis-tobe"><div><span class="lbl">AS-IS 현행</span><p>${R(r.asis) || '<span class="muted">자료에 없음</span>'}</p></div><div><span class="lbl">TO-BE 개선</span><p>${R(r.tobe) || '<span class="muted">자료에 없음</span>'}</p></div></div>
      <div><span class="lbl">수용 여부</span> ${pill(r.status)} <span>${R(r.statusReason)}</span></div>
      <div class="small"><span class="lbl">품질속성</span>${esc(r.quality)} <span class="lbl" style="margin-left:12px">긴급도</span>${esc(r.priority)} <span class="lbl" style="margin-left:12px">난이도</span>${esc(r.difficulty)}</div>
      ${whyBox(r)}
      <div><span class="lbl">검수 기준</span><ul class="crit">${r.acceptanceCriteria.map(a => `<li>${R(a)}</li>`).join('') || '<li class="muted">없음</li>'}</ul></div>
    </div>
    <div class="rd-src"><span class="lbl">근거 (출처)</span>${r.sources.map(s => `<blockquote>${refChip(s.ref)}<span class="who">${R(s.who)}</span><q>${R(s.quote)}</q></blockquote>`).join('') || '<p class="muted">출처 없음: 확인이 필요합니다.</p>'}
      <div class="row"><button class="btn small" data-act="editreq" data-id="${r.id}">수정</button></div>
    </div>
  </div>`;
}
function whyBox(r) {
  const w = r.rationale || {};
  if (!w.extract && !w.classify && !w.decide) return '';
  return `<div class="why"><div class="why-head"><span class="lbl">AI 판단 근거</span>${r.confidence ? `<span class="conf c-${r.confidence}">확신도 ${esc(r.confidence)}</span>` : ''}</div>
    <dl>${[['왜 뽑았나', w.extract], ['유형·우선순위', w.classify], ['수용 여부 판단', w.decide]].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${R(v)}</dd>`).join('')}</dl></div>`;
}
function reqEditor() {
  const b = S.editBuf;
  const sel = (f, list) => `<select id="e-${f}" data-bind="req:${f}">${list.map(o => `<option ${b[f] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  const ta = (f, label, v) => `<label class="fld"><span>${label}</span><textarea id="e-${f}" data-bind="req:${f}" data-autosize rows="2">${esc(v)}</textarea></label>`;
  return `<div class="editor">
    <div class="ed-row"><label class="fld grow"><span>요구사항명</span><input id="e-title" data-bind="req:title" value="${esc(b.title)}"></label><label class="fld"><span>유형</span>${sel('category', CATEGORIES)}</label><label class="fld"><span>긴급도</span>${sel('priority', PRIORITIES)}</label><label class="fld"><span>품질속성</span>${sel('quality', QUALITIES)}</label><label class="fld"><span>난이도</span>${sel('difficulty', PRIORITIES)}</label><label class="fld"><span>수용 여부</span>${sel('status', STATUSES)}</label></div>
    ${ta('description', '상세 내용', b.description)}
    <div class="ed-row two">${ta('asis', 'AS-IS (현행)', b.asis)}${ta('tobe', 'TO-BE (개선)', b.tobe)}</div>
    ${ta('statusReason', '수용 여부 사유·조건', b.statusReason)}
    ${ta('acceptanceCriteria', '검수 기준 (한 줄에 하나)', b.acceptanceCriteria.join('\n'))}
    <p class="muted small">[이름-1] 같은 토큰은 그대로 두면 문서에서 원래 값으로 채워집니다.</p>
    <div class="row"><button class="btn primary" data-act="savereq">저장</button><button class="btn ghost" data-act="cancelreq">취소</button><span class="grow"></span><button class="btn danger ghost" data-act="delreq">${S.delArm ? '한 번 더 누르면 삭제됩니다' : '삭제'}</button></div>
  </div>`;
}

function tabMeeting() {
  const r = S.result, m = r.meeting;
  return `<div class="meet">
    <section class="panel"><h3>AS-IS → TO-BE</h3><div class="tbl-wrap"><table class="at-tbl"><thead><tr><th>ID</th><th>요구사항</th><th>AS-IS (현행)</th><th></th><th>TO-BE (개선)</th><th>수용 여부</th></tr></thead><tbody>
      ${r.requirements.map(q => `<tr><td class="mono">${q.id}</td><td>${R(q.title)}</td><td>${R(q.asis) || '<span class="muted">—</span>'}</td><td class="arrow">→</td><td>${R(q.tobe) || '<span class="muted">—</span>'}</td><td>${pill(q.status)}<div class="small muted">${R(q.statusReason)}</div></td></tr>`).join('')}
    </tbody></table></div></section>
    <div class="meet-grid">
      <section class="panel"><h3>결정사항 <span class="count">${m.decisions.length}</span></h3><ul class="dlist">${m.decisions.map(d => `<li>${R(d.text)} ${refChip(d.ref)}</li>`).join('') || '<li class="muted">없음</li>'}</ul></section>
      <section class="panel"><h3>미결사항 <span class="count">${m.openIssues.length}</span></h3><ul class="dlist open">${m.openIssues.map(d => `<li>${R(d.text)}<div class="small muted">담당: ${R(d.owner) || '미지정'} ${refChip(d.ref)}</div></li>`).join('') || '<li class="muted">없음</li>'}</ul></section>
      <section class="panel"><h3>후속 조치 <span class="count">${m.actionItems.length}</span></h3><ul class="dlist act">${m.actionItems.map(a => `<li>${R(a.task)}<div class="small muted">${R(a.owner) || '담당 미지정'} · ${R(a.due) || '기한 미정'}</div></li>`).join('') || '<li class="muted">없음</li>'}</ul></section>
    </div>
  </div>`;
}

function tabChecks() {
  const c = S.result.checks;
  const done = (k, x) => S.resolved.has(checkKey(k, x));
  const card = (k, x, inner) => `<article class="ck ${k} ${done(k, x) ? 'resolved' : ''}">${inner}<label class="check small"><input type="checkbox" data-act="resolve" data-key="${esc(checkKey(k, x))}" ${done(k, x) ? 'checked' : ''}> 해결됨</label></article>`;
  return `<div class="checks">
    <section><h3><span class="dot missing"></span>빠진 항목 <span class="count">${c.missing.length}</span></h3><p class="muted small">요구사항서 필수 항목(예외 처리, 권한, 이력, 성능, 일정, 보관, 지원 환경)과 원 자료를 대조했습니다.</p>
      ${c.missing.map(x => card('missing', x, `<header>${reqChip(x.reqId)}<b>${R(x.item)}</b>${refChip(x.ref)}</header><p>${R(x.detail)}</p>${x.suggestion ? `<p class="sugg"><span>제안</span>${R(x.suggestion)}</p>` : ''}`)).join('') || '<div class="empty">빠진 항목이 없습니다.</div>'}</section>
    <section><h3><span class="dot conflicts"></span>서로 다른 의견 <span class="count">${c.conflicts.length}</span></h3><p class="muted small">이해관계자끼리 입장이 다른 주제입니다. 결정 전까지 해당 요구사항은 미결로 둡니다.</p>
      ${c.conflicts.map(x => card('conflicts', x, `<header>${x.reqIds.map(reqChip).join('')}<b>${R(x.topic)}</b></header><ul class="pos">${x.positions.map(p => `<li><span class="who">${R(p.who)}</span><span>${R(p.stance)}</span>${refChip(p.ref)}</li>`).join('')}</ul>${x.suggestion ? `<p class="sugg"><span>절충안</span>${R(x.suggestion)}</p>` : ''}`)).join('') || '<div class="empty">상충 의견이 없습니다.</div>'}</section>
    <section><h3><span class="dot ambiguous"></span>모호한 표현 <span class="count">${c.ambiguous.length}</span></h3><p class="muted small">검수할 수 없는 표현입니다. 수치나 조건으로 바꾸세요.</p>
      ${c.ambiguous.map(x => card('ambiguous', x, `<header>${reqChip(x.reqId)}<b>"${R(x.phrase)}"</b>${refChip(x.ref)}</header>${x.suggestion ? `<p class="sugg"><span>구체화</span>${R(x.suggestion)}</p>` : ''}`)).join('') || '<div class="empty">모호한 표현이 없습니다.</div>'}</section>
  </div>`;
}

function emailFor(g) {
  const title = S.result.project.title;
  const items = g.items.map((q, k) => `${k + 1}. ${q.q}${q.reqIds.length || q.why ? `\n   (관련: ${[q.reqIds.join(', '), q.why].filter(Boolean).join(' / ')})` : ''}`).join('\n\n');
  return {
    subject: `[확인 요청] ${title} 요구사항 관련 문의 ${g.items.length}건`,
    body: `${g.to}님, 안녕하세요.\n\n'${title}' 요구사항 정의서를 정리하고 있습니다. 아래 사항을 확인해 주시면 정의서에 반영하겠습니다.\n\n${items}\n\n${S.meta.due ? S.meta.due + '까지 ' : ''}회신 부탁드립니다. 주신 답변은 출처와 함께 기록해 두겠습니다.\n\n감사합니다.\n${S.meta.author || '요구사항 담당자'} 드림`
  };
}
function tabMail() {
  const qs = S.result.questions;
  return `<div class="mail">
    <div class="panel mail-opts"><label class="fld"><span>보내는 사람</span><input id="m-author" data-bind="meta:author" data-rerender="1" value="${esc(S.meta.author)}" placeholder="예: 홍길동 과장"></label><label class="fld"><span>회신 기한</span><input id="m-due" data-bind="meta:due" data-rerender="1" value="${esc(S.meta.due)}" placeholder="예: 10/28(화)"></label><p class="muted small">미결·누락·충돌 항목을 물어볼 사람별로 묶었습니다. 복사하면 가린 값이 원래 값으로 채워진 상태로 복사됩니다. 회신을 받으면 <button class="link" data-act="tab" data-k="apply">회신 반영</button> 탭에 붙여 넣으세요.</p></div>
    <div class="mail-grid">${qs.map((g, i) => { const e = emailFor(g); return `<article class="panel mailcard">
      <header><div><span class="lbl">받는 사람</span><b>${R(g.to)}</b><span class="muted"> · ${R(g.role)}</span></div><span class="count">${g.items.length}건</span></header>
      <div class="subj"><span class="lbl">제목</span>${R(e.subject)}</div>
      <pre class="mailbody">${R(e.body)}</pre>
      <div class="row"><button class="btn small" data-act="copymail" data-i="${i}">메일 내용 복사</button><span class="muted small" id="copied-${i}"></span></div>
    </article>`; }).join('') || '<div class="empty">물어볼 사항이 없습니다.</div>'}</div>
  </div>`;
}

function tabApply() {
  const a = S.apply;
  const demoReady = S.result.isDemo && sampleIntact() && !S.sources.some(s => s.kind === 'reply');
  const preview = a.previewed && a.text.trim() ? `<div class="panel prev"><header><b>AI에 보낼 내용</b><span class="muted">새로 찾은 민감정보도 가렸습니다</span></header><pre class="prev-text">${maskPreviewHTML(S.M, a.text)}</pre></div>` : '';
  const busy = S.run && S.run.busy;
  return `<div class="apply">
    <section class="panel">
      <h3>회신·추가 자료 반영</h3>
      <p class="muted small">확인 질문의 회신이나 새로 받은 자료를 넣으면, 바뀌는 요구사항만 고치고 무엇이 바뀌었는지 이력에 남깁니다.</p>
      <div class="seg"><label><input type="radio" name="akind" data-act="akind" value="reply" ${a.kind === 'reply' ? 'checked' : ''}> 확인 회신</label><label><input type="radio" name="akind" data-act="akind" value="doc" ${a.kind === 'doc' ? 'checked' : ''}> 추가 자료</label></div>
      <div class="ed-row"><label class="fld grow"><span>${a.kind === 'reply' ? '회신한 사람' : '자료 제목'}</span><input id="ap-from" data-bind="apply:from" value="${esc(a.from)}" placeholder="${a.kind === 'reply' ? '예: 이서윤 과장' : '예: 2차 회의록'}"></label><label class="fld"><span>일자</span><input id="ap-date" data-bind="apply:date" value="${esc(a.date)}"></label></div>
      <textarea id="ap-text" data-bind="apply:text" data-autosize rows="7" placeholder="회신 메일이나 추가 자료 내용을 붙여 넣으세요">${esc(a.text)}</textarea>
      <div class="row wrap">
        <label class="drop inline" data-kind="apply"><input type="file" data-file="apply" accept=".txt,.md,.csv,.pdf,.docx,.xlsx,.xls,.pptx,.hwpx,.eml"><span>파일에서 읽기</span></label>
        ${demoReady ? '<button class="btn ghost" data-act="demoreply">예시 회신 넣기</button>' : ''}
        <span class="grow"></span>
        <button class="btn" data-act="applyprev" ${a.text.trim() ? '' : 'disabled'}>민감정보 가리고 미리보기</button>
        <button class="btn primary" data-act="applyrun" ${a.text.trim() && !busy ? '' : 'disabled'}>요구사항에 반영</button>
      </div>
      <div id="run-box">${S.run && S.run.where === 'apply' ? runBox() : ''}</div>
      ${preview}
    </section>
    <section class="panel">
      <h3>변경 이력 <span class="count">${S.history.length}</span></h3>
      <ol class="timeline">${[...S.history].reverse().map(h => `<li><div class="t-head"><b>${esc(h.label)}</b><span class="muted small">${esc(h.at)}${h.ref ? ' · ' : ''}</span>${h.ref ? refChip(h.ref) : ''}</div><ul>${h.changes.map(c => `<li><span class="ctype t-${esc(c.type)}">${esc(c.type)}</span>${c.reqId ? reqChip(c.reqId) : ''}<span>${R(c.summary)}</span></li>`).join('')}</ul></li>`).join('') || '<li class="empty">아직 이력이 없습니다.</li>'}</ol>
    </section>
  </div>`;
}

// 5단계: 문서
function docCtx(restore) {
  maskAll();
  return {
    result: S.result, meta: S.meta, template: S.template, sources: S.sources.filter(s => s.text.trim()), history: S.history, resolved: S.resolved,
    tx: t => (restore ? unmask(S.M, t) : String(t ?? '')),
    srcTitle: id => { const s = srcById(id); return s ? KIND_LABEL[s.kind] : ''; }
  };
}
function viewExport() {
  const t = S.template;
  const form = FORM_PRESETS[S.tplKey];
  const metaF = [['docName', '문서 이름', t.docTitle], ['title', '요청 건명', S.result.project.title], ['dept', '요청 부서', '예: ○○사업부'], ['author', '작성자', '예: 홍길동 과장'], ['date', '작성일', today()], ['system', '대상 시스템', '예: 가맹점 매출조회 포털'], ['version', '문서 버전', 'v1.0']]
    .filter(([k]) => !form || form.meta.includes(k));
  const ctx = docCtx(S.exportRestore);
  const moveBtns = (kind, i, len) => `<button class="icon-btn" data-act="mv" data-kind="${kind}" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="위로">↑</button><button class="icon-btn" data-act="mv" data-kind="${kind}" data-i="${i}" data-d="1" ${i < len - 1 ? '' : 'disabled'} aria-label="아래로">↓</button>`;
  const presetBtn = ([k, p]) => `<button class="${S.tplKey === k ? 'on' : ''}" data-act="preset" data-k="${k}">${p.name}</button>`;
  const editor = form
    ? `<h4>양식 구성</h4><p class="muted small">${form.note}</p><ul class="form-spec">${form.spec.map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join('')}</ul>`
    : `<h4>목차</h4>
      <ul class="tpl-list">${t.sections.map((s, i) => `<li class="${s.on ? '' : 'off'}"><input type="checkbox" data-act="tplon" data-kind="sections" data-i="${i}" ${s.on ? 'checked' : ''} aria-label="${esc(s.label)} 포함"><input id="sec-${i}" data-bind="tpl:sections:${i}" data-live="1" value="${esc(s.label)}" aria-label="목차 이름">${moveBtns('sections', i, t.sections.length)}</li>`).join('')}</ul>
      <h4>요구사항 표의 열</h4>
      <ul class="tpl-list">${t.columns.map((c, i) => `<li class="${c.on ? '' : 'off'}"><input type="checkbox" data-act="tplon" data-kind="columns" data-i="${i}" ${c.on ? 'checked' : ''} aria-label="${esc(c.label)} 포함"><input id="col-${i}" data-bind="tpl:columns:${i}" data-live="1" value="${esc(c.label)}" aria-label="열 이름"><select data-act="colkey" data-i="${i}" aria-label="열에 넣을 내용">${Object.entries(COLUMN_DEFS).map(([k, d]) => `<option value="${k}" ${c.key === k ? 'selected' : ''}>${d.label}</option>`).join('')}<option value="blank" ${c.key === 'blank' ? 'selected' : ''}>(빈 칸)</option></select>${moveBtns('columns', i, t.columns.length)}</li>`).join('')}</ul>
      <div class="row"><button class="btn ghost small" data-act="addcol">+ 열 추가</button><button class="btn ghost small" data-act="resettpl">이 양식 처음대로</button></div>`;
  const buttons = form
    ? `<button class="btn primary" data-act="dl" data-f="${form.fmt}">${form.button}</button><button class="btn" data-act="dl" data-f="trace">AI 판단 기록 (.md)</button>`
    : `<button class="btn primary" data-act="dl" data-f="docx">Word로 내려받기</button><button class="btn" data-act="dl" data-f="xlsx">Excel로 내려받기</button><button class="btn" data-act="dl" data-f="md">Markdown으로 내려받기</button><button class="btn" data-act="dl" data-f="trace">AI 판단 기록 (.md)</button>`;
  const help = form ? form.help : 'Excel 파일에는 요구사항, 추적표(요구사항 ↔ 출처), 점검 결과, 확인 질문, 변경 이력 시트가 들어갑니다.';
  return `<div class="export">
    <aside class="panel tpl">
      <h3>양식</h3>
      <div class="seg wrap">${Object.entries(TEMPLATE_PRESETS).map(presetBtn).join('')}${Object.entries(FORM_PRESETS).map(presetBtn).join('')}</div>
      <p class="muted small">${form ? '사내 표준 양식입니다. 내용은 분석 결과로 채우고, 모양은 표준에 맞춰 고정됩니다.' : '부서 양식에 맞게 항목 이름을 바꾸고, 켜고 끄고, 순서를 옮기세요. 바꾼 양식은 이 브라우저에 저장됩니다.'}</p>
      <h4>문서 정보</h4>
      ${metaF.map(([k, l, ph]) => `<label class="fld"><span>${l}</span><input id="meta-${k}" data-bind="meta:${k}" data-live="1" value="${esc(S.meta[k])}" placeholder="${esc(ph)}"></label>`).join('')}
      ${editor}
    </aside>
    <section class="doc-side">
      <div class="panel export-bar">
        <div class="row wrap">${buttons}</div>
        <label class="check small"><input type="checkbox" data-act="exprestore" ${S.exportRestore ? 'checked' : ''}> 가린 값을 원래 값으로 채워서 내보내기 <span class="muted">(끄면 [이름-1]처럼 토큰 상태로 내보냅니다)</span></label>
        <p class="muted small">${help} AI 판단 기록에는 요구사항별로 왜 뽑고 어떻게 판단했는지, AI를 언제 어떤 지시로 불렀는지, 사람이 무엇을 고쳤는지가 남습니다.</p>
      </div>
      <div class="paper pv-${form ? S.tplKey : 'doc'}" id="paper">${paperHTML(ctx)}</div>
    </section>
  </div>`;
}
function paperHTML(ctx) {
  if (S.tplKey === 'pumui') return pumuiToHTML(buildPumuiBlocks(ctx));
  if (S.tplKey === 'spec') return specToHTML(ctx);
  return blocksToHTML(buildDocBlocks(ctx));
}
function refreshPaper() { const p = $('#paper'); if (p) p.innerHTML = paperHTML(docCtx(S.exportRestore)); }

// ───────── 분석 실행 ─────────
const ERR_COPY = {
  not_granted: 'AI 사용을 허용하지 않아 분석할 수 없습니다. 예시 결과로는 계속 체험할 수 있습니다.',
  sampling_disabled: '이 계정에서는 AI를 쓸 수 없습니다.',
  rate_limited: '요청이 많거나 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
  prompt_too_large: '자료가 너무 깁니다. 덜 중요한 자료를 빼거나 나눠서 분석하세요.',
  invalid_json: 'AI 응답을 표로 정리하지 못했습니다. 한 번 더 시도해 주세요.',
  refused: 'AI가 이 자료를 처리하지 않았습니다. 자료 내용을 확인해 주세요.',
  empty_completion: 'AI가 빈 답을 보냈습니다. 자료를 조금 줄여서 다시 시도해 주세요.',
  session_expired: '로그인이 만료되었습니다. claude.ai에 다시 로그인한 뒤 시도하세요.',
  cancelled: '분석을 멈췄습니다.',
  local_down: 'serve.py에 연결하지 못했습니다. serve.py 실행 창이 열려 있는지 확인하세요.',
  local_timeout: 'AI 응답이 너무 늦습니다. settings.json의 timeout_sec를 늘리거나 자료를 줄여 보세요.'
};
const errText = e => ERR_COPY[e?.code] || (e?.code === 'local_error' ? `${CFG.llm?.label || '사내 LLM'} 오류: ${e.message || '알 수 없는 오류'}` : e?.message && !e.code ? e.message : '일시적인 오류로 처리하지 못했습니다. 다시 시도해 주세요.');
const MAX_BYTES = 240000;
let tick = null;

function startRun(where, stages) {
  S.run = { busy: true, where, stages, t0: Date.now(), chars: 0, ctl: new AbortController(), msg: '' };
  clearInterval(tick);
  tick = setInterval(() => { const m = $('#run-meta'); if (m && S.run?.busy) m.textContent = `${S.run.chars ? fmtNum(S.run.chars) + '자 작성 · ' : ''}${Math.round((Date.now() - S.run.t0) / 1000)}초`; }, 1000);
}
function endRun(patch) { clearInterval(tick); Object.assign(S.run, { busy: false }, patch); }
function setStage(i, state, msg) { S.run.stages[i] = state; if (msg) S.run.msg = msg; if (S.step === 3) render(); else updateRunBox(); }

// AI 호출 한 번. 어느 엔진을 쓰든 기록(S.trace)을 남깁니다.
async function askJSON(prompt, step) {
  const inBytes = new TextEncoder().encode(prompt).length;
  const rec = { at: nowStamp(), step, engine: engineLabel(), inBytes, outChars: 0, ms: null, ok: false };
  S.trace.push(rec);
  const t0 = Date.now();
  try {
    const limit = S.ai.provider === 'local' ? (CFG.llm.maxPromptBytes || MAX_BYTES) : MAX_BYTES;
    if (inBytes > limit) throw { code: 'prompt_too_large' };
    S.run.chars = 0;
    const out = S.ai.provider === 'local' ? await askLocal(prompt) : await S.ai.sample.json(prompt, {
      signal: S.run.ctl.signal,
      modelTier: S.precise ? 'complex' : 'default',
      onText: ({ text }) => { S.run.chars = text.length; rec.outChars = text.length; }
    });
    if (!rec.outChars) rec.outChars = S.run.chars || JSON.stringify(out).length;
    if (S.ai.provider === 'local' && S.ai.fallback) rec.engine = `${S.ai.fallbackModel || '대체 모델'} (${S.ai.fallback})`;
    rec.ok = true;
    return out;
  } catch (e) { rec.error = errText(e); throw e; }
  finally { rec.ms = Date.now() - t0; }
}

// 사내 LLM: serve.py의 /api/llm이 settings.json의 주소·모델·키로 대신 호출합니다(키는 브라우저에 오지 않음).
async function askLocal(prompt) {
  let res;
  try {
    res = await fetch(CFG.llm.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access-Code': S.accessCode }, signal: S.run.ctl.signal,
      body: JSON.stringify({ prompt, tier: S.precise ? 'precise' : 'default', json: true })
    });
  } catch (e) { throw e?.name === 'AbortError' ? { code: 'cancelled' } : { code: 'local_down' }; }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw { code: { 413: 'prompt_too_large', 504: 'local_timeout' }[res.status] || 'local_error', message: body.error };
  if (body.fallback) {
    // Claude 크레딧이 부족해 서버가 다른 모델(Gemini)로 대신 처리한 경우
    if (!S.ai.fallback) toast(body.fallback);
    S.ai.fallback = body.fallback; S.ai.fallbackModel = body.model || '';
    renderBadge();
  } else {
    S.ai.fallback = '';
    if (body.model) S.ai.model = body.model;
  }
  const text = String(body.text || '');
  S.run.chars = text.length;
  if (!text.trim()) throw { code: 'empty_completion' };
  return parseJSONLoose(text);
}

function finishAnalysis(res, label, isDemo) {
  res.isDemo = isDemo;
  S.result = res; S.resolved = new Set(); S.openReq = null; S.editReq = null; S.reqFilter = '전체'; S.tab = 'req';
  S.meta.title = '';
  const c = res.checks;
  S.history = [{ at: nowStamp(), label, ref: '', changes: [{ type: '추가', reqId: '', summary: `요구사항 ${res.requirements.length}건 정리, 누락 ${c.missing.length}건 · 상충 ${c.conflicts.length}건 · 모호 ${c.ambiguous.length}건 발견, 확인 질문 ${res.questions.reduce((a, g) => a + g.items.length, 0)}건 작성` }] }];
}

async function runAnalyze() {
  if (S.ai.state !== 'ready') return;
  const list = maskAll(S.sources.filter(s => s.text.trim()));
  const prevTrace = S.trace;
  S.trace = [];
  startRun('analyze', ['run', 'run', 'wait', 'wait']);
  S.run.msg = '자료를 읽고 요구사항을 뽑는 중입니다 (보통 30초~2분)';
  render();
  try {
    const a = await askJSON(promptAnalyze(list), '요구사항 추출·분류·회의 분석');
    const base = normalizeResult(a);
    if (!base.requirements.length) throw { code: 'empty_completion' };
    setStage(0, 'done'); setStage(1, 'done'); S.run.stages[2] = 'run'; S.run.stages[3] = 'run';
    setStage(2, 'run', `요구사항 ${base.requirements.length}건을 원 자료와 대조해 빈틈을 찾는 중입니다`);
    const b = await askJSON(promptCheck(list, base), '누락·충돌 점검·확인 질문');
    const full = normalizeResult(Object.assign({}, a, { checks: b, questions: b.questions }));
    finishAnalysis(full, '최초 분석', false);
    endRun({ stages: ['done', 'done', 'done', 'done'], done: `분석을 마쳤습니다. 요구사항 ${full.requirements.length}건을 찾았습니다.` });
    S.step = 4; render();
  } catch (e) {
    if (S.result) S.trace = prevTrace.concat(S.trace);
    if (e?.code === 'not_granted' || e?.code === 'sampling_disabled') { S.ai.state = 'denied'; renderBadge(); }
    endRun({ stages: S.run.stages.map(s => (s === 'run' ? 'err' : s)), error: errText(e) });
    render();
  }
}

function runDemo(fast) {
  maskAll();
  const done = () => {
    S.trace = [{ at: nowStamp(), step: '요구사항 추출·분류·점검 (예시)', engine: '예시 모드: 미리 분석한 결과', inBytes: 0, outChars: 0, ms: null, ok: true }];
    finishAnalysis(normalizeResult(bindDemo(DEMO_V1)), '최초 분석 (예시)', true);
    S.run = { busy: false, stages: ['done', 'done', 'done', 'done'], done: '미리 분석해 둔 예시 결과를 불러왔습니다.' };
    S.step = 4; render(); window.scrollTo({ top: 0 });
  };
  if (fast) return done();
  startRun('analyze', ['run', 'wait', 'wait', 'wait']);
  S.run.msg = '예시 결과를 불러오는 중입니다';
  render();
  [0, 1, 2, 3].forEach(i => setTimeout(() => {
    if (!S.run?.busy) return;
    S.run.stages[i] = 'done'; if (i < 3) S.run.stages[i + 1] = 'run';
    if (i === 3) { clearInterval(tick); done(); } else render();
  }, 450 * (i + 1)));
}

function markChanges(oldRes, newRes) {
  const oldMap = new Map(oldRes.requirements.map(r => [r.id, r]));
  const computed = [];
  for (const r of newRes.requirements) {
    const o = oldMap.get(r.id);
    if (!o) { r._changed = 'added'; computed.push({ type: '추가', reqId: r.id, summary: `${r.title} 추가` }); continue; }
    const d = diffReq(o, r);
    if (d.length) { r._changed = 'modified'; r.confirmed = false; computed.push({ type: '변경', reqId: r.id, summary: `${d.map(k => REQ_FIELDS[k]).join(', ')} 변경${o.status !== r.status ? ` (수용 여부 ${o.status} → ${r.status})` : ''}` }); }
    else { r._changed = null; r.confirmed = o.confirmed; }
  }
  return computed;
}

async function runApply() {
  const a = S.apply;
  if (!a.text.trim()) return;
  const isDemoReply = S.result.isDemo && a.text.trim() === SAMPLE_REPLY.text.trim();
  if (!isDemoReply && S.ai.state !== 'ready') {
    S.run = { busy: false, where: 'apply', error: S.result.isDemo ? '지금은 AI가 연결되지 않아 예시 회신만 반영할 수 있습니다. "예시 회신 넣기"를 눌러 보세요.' : 'AI가 연결되지 않아 반영할 수 없습니다.' };
    return render();
  }
  const src = addSource(a.kind === 'reply' ? 'reply' : 'doc', { title: a.kind === 'reply' ? `확인 회신: ${a.from || '회신'}` : (a.from || '추가 자료'), author: a.kind === 'reply' ? a.from : '', date: a.date, text: a.text.trim() });
  maskAll([src]);
  const old = S.result;
  const label = a.kind === 'reply' ? '회신 반영' : '추가 자료 반영';
  if (isDemoReply) {
    startRun('apply', ['run']); S.run.msg = '예시 회신을 반영하는 중입니다'; render();
    setTimeout(() => {
      const v2 = bindDemo(JSON.parse(JSON.stringify(buildDemoV2()).replaceAll('"S4"', `"${src.id}"`)));
      const next = normalizeResult(v2); next.isDemo = true;
      S.trace.push({ at: nowStamp(), step: `${src.id} 반영 (예시)`, engine: '예시 모드: 미리 분석한 결과', inBytes: 0, outChars: 0, ms: null, ok: true });
      markChanges(old, next);
      commitApply(next, v2.changes, label, src.id);
      endRun({ done: `${src.id} 회신을 반영했습니다. 바뀐 요구사항에 표시가 붙었습니다.` });
      render();
    }, 900);
    return;
  }
  startRun('apply', ['run']); S.run.msg = '새 자료를 기존 요구사항과 비교하는 중입니다'; render();
  try {
    const u = await askJSON(promptUpdate(old, [src]), `${src.id} 반영(변경 판단)`);
    const next = normalizeResult(Object.assign({ checks: {} }, u));
    if (!next.requirements.length) throw { code: 'empty_completion' };
    S.run.msg = '바뀐 요구사항을 다시 점검하는 중입니다'; updateRunBox();
    const list = maskAll(S.sources.filter(s => s.text.trim()));
    const b = await askJSON(promptCheck(list, next), `${src.id} 반영 후 재점검`);
    const full = normalizeResult(Object.assign({}, u, { checks: b, questions: b.questions }));
    const computed = markChanges(old, full);
    const changes = arr(u.changes).map(c => ({ type: str(c.type) || '변경', reqId: str(c.reqId), summary: str(c.summary) })).filter(c => c.summary);
    commitApply(full, changes.length ? changes : computed, label, src.id);
    endRun({ done: `${src.id}를 반영했습니다. 바뀐 요구사항 ${full.requirements.filter(r => r._changed).length}건에 표시가 붙었습니다.` });
  } catch (e) {
    S.sources = S.sources.filter(s => s !== src); S.nextId--;
    if (e?.code === 'not_granted') { S.ai.state = 'denied'; renderBadge(); }
    endRun({ error: errText(e) });
  }
  render();
}
function commitApply(next, changes, label, ref) {
  next.isDemo = S.result.isDemo;
  S.result = next;
  S.history.push({ at: nowStamp(), label, ref, changes: changes.map(c => ({ type: c.type, reqId: c.reqId || '', summary: c.summary })) });
  S.apply = { kind: 'reply', from: '', date: today(), text: '', previewed: false };
}

// ───────── 파일 저장 ─────────
async function saveFile(filename, data) {
  const dl = S.ai.downloads;
  if (dl) {
    try { await dl.save({ filename, data }); toast(`${filename} 저장을 요청했습니다.`); return; }
    catch (e) { if (e?.code === 'declined') return; if (!['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e?.code)) { toast('파일을 저장하지 못했습니다. 다시 시도해 주세요.'); return; } }
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`${filename}을 내려받았습니다.`);
}
async function doExport(fmt) {
  const ctx = docCtx(S.exportRestore);
  const base = (unmask(S.M, S.meta.title || S.result.project.title) || '요구사항').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
  const name = `${base}_${S.template.docTitle.replace(/\s/g, '')}_${today().replace(/-/g, '')}`;
  try {
    toast('파일을 만드는 중입니다…');
    if (fmt === 'md') return saveFile(name + '.md', blocksToMarkdown(buildDocBlocks(ctx)));
    if (fmt === 'docx') return saveFile(name + '.docx', await blocksToDocx(buildDocBlocks(ctx)));
    if (fmt === 'xlsx') return saveFile(name + '.xlsx', await buildXlsx(ctx));
    if (fmt === 'hwpx') return saveFile(`${base}_품의문_${today().replace(/-/g, '')}.hwpx`, await buildPumuiHwpx(ctx));
    if (fmt === 'spec') return saveFile(`${base}_요구사항명세서_${today().replace(/-/g, '')}.xlsx`, await buildSpecXlsx(ctx));
    if (fmt === 'trace') return saveFile(`${base}_AI판단기록_${today().replace(/-/g, '')}.md`, buildTraceMarkdown(traceCtx(ctx)));
  } catch (e) { toast(e.message || '파일을 만들지 못했습니다.'); }
}

function traceCtx(ctx) {
  const used = [...S.M.items.values()].filter(it => S.sources.some(s => `${s.title}\n${s.author}\n${s.text}`.includes(it.value)));
  const maskStats = MASK_TYPES.map(type => ({ type, on: used.filter(i => i.type === type && i.on).length, off: used.filter(i => i.type === type && !i.on).length })).filter(m => m.on || m.off);
  const cut = t => t.split(/\n\n(?:자료|요구사항 목록|기존 데이터)\n/)[0];
  const demo = S.result.isDemo ? ' (예시 모드에서는 호출하지 않았고, AI 모드에서 쓰는 지시문입니다)' : '';
  const prompts = [
    { name: `1. 요구사항 추출·분류·회의 분석${demo}`, text: cut(promptAnalyze([])) },
    { name: `2. 누락·충돌 점검·확인 질문${demo}`, text: cut(promptCheck([], { requirements: [] })) },
    { name: `3. 회신·추가 자료 반영${demo}`, text: cut(promptUpdate({ project: {}, requirements: [], meeting: {} }, [])) }
  ];
  return Object.assign({}, ctx, { calls: S.trace, maskStats, prompts, engine: S.ai.provider ? engineLabel() : 'AI', restored: S.exportRestore });
}

// ───────── 알림·모달 ─────────
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}
function openSource(id, quote) {
  const s = srcById(id); if (!s) return;
  maskAll([s]);
  let body = R(s.masked);
  $('#modal-body').innerHTML = `<header class="m-head"><span class="sid">${s.id}</span><div><b>${R(s.mTitle)}</b><div class="muted small">${esc(KIND_LABEL[s.kind])} · ${R(s.mAuthor)} · ${esc(s.date)}</div></div></header><pre class="prev-text">${body}</pre><p class="muted small">${S.showOriginal ? '가린 값을 복원해서 보여 주고 있습니다. AI에는 토큰 상태로 전송되었습니다.' : 'AI에 전송된 상태(토큰)로 보여 주고 있습니다.'}</p>`;
  $('#modal').hidden = false;
  $('#modal-close').focus();
}

// ───────── 이벤트 ─────────
const ACCEPT = '.txt,.md,.csv,.tsv,.pdf,.docx,.xlsx,.xls,.xlsm,.pptx,.hwpx,.hwp,.eml,.json,.log';
const READABLE = new Set(ACCEPT.split(',').map(x => x.slice(1)));
const MAX_FILE_MB = 30;

// 끌어다 놓은 항목을 하위 폴더까지 펼쳐 {file, path} 목록으로 만듭니다.
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files].map(f => ({ file: f, path: f.name }));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), path: prefix + entry.name });
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (let batch; (batch = await new Promise((res, rej) => reader.readEntries(res, rej))).length;) for (const e of batch) await walk(e, prefix + entry.name + '/');
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}
const fromInput = files => [...files].map(f => ({ file: f, path: f.webkitRelativePath || f.name }));

// 파일·폴더 이름으로 자료 구분을 추정합니다. 회의 → 고객 요청 → 나머지는 참고 문서 순서로 봅니다.
function guessKind(path) {
  if (/회의|미팅|녹취|협의|회신|minutes|meeting/i.test(path)) return 'meeting';
  if (/요청|요구|니즈|문의|민원|건의|VOC|메일|mail|request|\.eml$/i.test(path)) return 'need';
  return 'doc';
}

async function addFiles(kind, items) {
  const isFolder = items.some(x => x.path.includes('/'));
  const log = { from: isFolder ? '폴더에서 파일' : '파일', added: [], skipped: [], failed: [] };
  const todo = items.filter(({ file, path }) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const hidden = path.split('/').some(seg => /^[.~]|^Thumbs\.db$|^desktop\.ini$/i.test(seg));
    if (hidden || !file.name.includes('.') || !READABLE.has(ext)) { log.skipped.push(path); return false; }
    if (file.size > MAX_FILE_MB * 1024 * 1024) { log.failed.push({ path, error: `${MAX_FILE_MB}MB 초과` }); return false; }
    return true;
  }).sort((a, b) => a.path.localeCompare(b.path, 'ko'));
  for (const [i, { file, path }] of todo.entries()) {
    toast(todo.length > 1 ? `(${i + 1}/${todo.length}) ${path} 읽는 중…` : `${file.name} 읽는 중…`);
    try {
      const text = await extractText(file);
      if (!text.trim()) throw new Error('글자가 없습니다');
      const title = path.replace(/\.[^.]+$/, '');
      const k = kind === 'auto' ? guessKind(path) : kind;
      if (k === 'apply') { S.apply.text = (S.apply.text ? S.apply.text + '\n\n' : '') + (todo.length > 1 ? `[${path}]\n` : '') + text; if (!S.apply.from) S.apply.from = title; }
      else addSource(k, { title, text, fileName: path });
      log.added.push({ path, kind: k });
    } catch (e) { log.failed.push({ path, error: /[가-힣]/.test(e.message || '') ? e.message : '파일이 손상됐거나 형식이 맞지 않습니다' }); }
  }
  if (kind !== 'apply' && (items.length > 1 || kind === 'auto')) S.importLog = log;
  // 빈 자리 카드(직접 입력용)는 파일이 들어오면 치웁니다.
  if (kind !== 'apply' && log.added.length) S.sources = S.sources.filter(s => s.text.trim() || s.title.trim() || s.fileName);
  const n = log.added.length, bad = log.failed[0];
  toast(n ? `${fmtNum(n)}개 파일을 읽었습니다.${log.failed.length ? ` ${log.failed.length}개는 읽지 못했습니다.` : ''}` : bad ? `${bad.path}: ${bad.error}` : '읽을 수 있는 파일이 없습니다.');
  render();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act, d = el.dataset;
  const r = S.result;
  switch (act) {
    case 'go': go(+d.n); break;
    case 'demo-fast': runDemo(true); break;
    case 'clear': S.sources = []; S.nextId = 1; S.M = createMasker(); S.result = null; S.history = []; S.run = null; S.trace = []; S.importLog = null; addSource('need'); addSource('meeting'); addSource('doc'); render(); break;
    case 'sample': loadSample(); S.step = 1; render(); break;
    case 'addsrc': addSource(d.kind); render(); break;
    case 'delsrc': S.sources = S.sources.filter(s => s.id !== d.id); render(); break;
    case 'mtoggle': { const it = S.M.items.get(d.key); if (it) it.on = el.checked; render(); break; }
    case 'addword': { const inp = $('#custom-word'); const w = inp.value.trim(); if (w && !S.M.custom.includes(w)) S.M.custom.push(w); render(); break; }
    case 'delword': S.M.custom.splice(+d.i, 1); render(); break;
    case 'analyze': runAnalyze(); break;
    case 'demo': runDemo(false); break;
    case 'stop': S.run?.ctl?.abort(); break;
    case 'precise': S.precise = el.checked; break;
    case 'tab': S.tab = d.k; S.editReq = null; render(); break;
    case 'orig': S.showOriginal = el.checked; render(); break;
    case 'filter': S.reqFilter = d.s; render(); break;
    case 'openreq': if (e.target.closest('input,button,a')) break; S.openReq = S.openReq === d.id ? null : d.id; S.editReq = null; render(); break;
    case 'confirm': { const q = r.requirements.find(x => x.id === d.id); if (q) q.confirmed = el.checked; render(); break; }
    case 'goreq': S.tab = 'req'; S.reqFilter = '전체'; S.openReq = d.id; S.editReq = null; render(); setTimeout(() => $(`tr[data-id="${CSS.escape(d.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30); break;
    case 'src': openSource(d.id); break;
    case 'editreq': { const q = r.requirements.find(x => x.id === d.id); S.editReq = d.id; S.editBuf = clone(q); S.delArm = false; render(); break; }
    case 'cancelreq': S.editReq = null; S.delArm = false; render(); break;
    case 'savereq': {
      const i = r.requirements.findIndex(x => x.id === S.editReq);
      const b = S.editBuf;
      if (typeof b.acceptanceCriteria === 'string') b.acceptanceCriteria = b.acceptanceCriteria.split('\n').map(s => s.trim()).filter(Boolean);
      if (i < 0) break;
      const old = r.requirements[i], diff = diffReq(old, b);
      if (old._new) { delete b._new; S.history.push({ at: nowStamp(), label: '직접 수정', changes: [{ type: '추가', reqId: b.id, summary: `${b.title} 직접 추가` }] }); b._changed = 'added'; }
      else if (diff.length) { S.history.push({ at: nowStamp(), label: '직접 수정', changes: [{ type: '변경', reqId: b.id, summary: `담당자가 ${diff.map(k => REQ_FIELDS[k]).join(', ')} 수정${old.status !== b.status ? ` (수용 여부 ${old.status} → ${b.status})` : ''}` }] }); b._changed = 'modified'; }
      r.requirements[i] = b; S.editReq = null; render(); break;
    }
    case 'delreq': {
      if (!S.delArm) { S.delArm = true; render(); break; }
      const q = r.requirements.find(x => x.id === S.editReq);
      r.requirements = r.requirements.filter(x => x.id !== S.editReq);
      if (q && !q._new) S.history.push({ at: nowStamp(), label: '직접 수정', changes: [{ type: '삭제', reqId: q.id, summary: `${q.title} 삭제` }] });
      S.editReq = null; S.openReq = null; S.delArm = false; render(); break;
    }
    case 'addreq': {
      const max = r.requirements.reduce((m, x) => Math.max(m, +(x.id.match(/\d+/)?.[0] || 0)), 0);
      const q = normalizeReq({ id: `REQ-${String(max + 1).padStart(3, '0')}`, title: '새 요구사항', status: '미결' }, 0);
      q._new = true;
      r.requirements.push(q); S.reqFilter = '전체'; S.openReq = q.id; S.editReq = q.id; S.editBuf = clone(q); render(); break;
    }
    case 'resolve': if (el.checked) S.resolved.add(d.key); else S.resolved.delete(d.key); render(); break;
    case 'copymail': {
      const g = r.questions[+d.i], m = emailFor(g);
      const text = unmask(S.M, `제목: ${m.subject}\n\n${m.body}`);
      const note = $(`#copied-${d.i}`);
      navigator.clipboard?.writeText(text).then(() => { if (note) note.textContent = '복사했습니다. 메일 프로그램에 붙여 넣으세요.'; }, () => { if (note) note.textContent = '복사가 막혀 있습니다. 내용을 직접 선택해 복사하세요.'; });
      break;
    }
    case 'akind': S.apply.kind = el.value; render(); break;
    case 'demoreply': S.apply = { kind: 'reply', from: SAMPLE_REPLY.from, date: SAMPLE_REPLY.date, text: SAMPLE_REPLY.text, previewed: true }; render(); break;
    case 'applyprev': S.apply.previewed = true; render(); break;
    case 'applyrun': runApply(); break;
    case 'preset': S.tplKey = d.k; if (TEMPLATE_PRESETS[d.k]) { S.template = clone(TEMPLATE_PRESETS[d.k]); lsSet(LS_TPL, S.template); } render(); break;
    case 'resettpl': S.template = clone(TEMPLATE_PRESETS[S.tplKey] || TEMPLATE_PRESETS.std); lsSet(LS_TPL, S.template); render(); break;
    case 'tplon': S.template[d.kind][+d.i].on = el.checked; lsSet(LS_TPL, S.template); render(); break;
    case 'mv': { const L = S.template[d.kind], i = +d.i, j = i + +d.d; [L[i], L[j]] = [L[j], L[i]]; lsSet(LS_TPL, S.template); render(); break; }
    case 'addcol': S.template.columns.push({ key: 'blank', label: '비고', on: true }); lsSet(LS_TPL, S.template); render(); break;
    case 'exprestore': S.exportRestore = el.checked; refreshPaper(); break;
    case 'dl': doExport(d.f); break;
    case 'closeimport': S.importLog = null; render(); break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('input[type=file][data-file]')) { addFiles(el.dataset.file, fromInput(el.files)); el.value = ''; }
  if (el.matches('select[data-act=srckind]')) { const src = srcById(el.dataset.id); if (src) src.kind = el.value; render(); }
  if (el.matches('select[data-act=colkey]')) { const c = S.template.columns[+el.dataset.i]; c.key = el.value; c.label = COLUMN_DEFS[el.value]?.label || '비고'; lsSet(LS_TPL, S.template); render(); }
  if (el.matches('[data-rerender]')) render();
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('textarea[data-autosize]')) autosize(el);
  const b = el.dataset.bind;
  if (!b) return;
  const [kind, a, f] = b.split(':');
  if (kind === 'src') {
    const s = srcById(a); if (s) s[f] = el.value;
    const c = $('#src-count'); if (c) c.textContent = `자료 ${S.sources.length}건 · ${fmtNum(S.sources.reduce((x, s) => x + s.text.length, 0))}자`;
  } else if (kind === 'meta') { S.meta[a] = el.value; lsSet(LS_META, { dept: S.meta.dept, author: S.meta.author, system: S.meta.system }); if (el.dataset.live) refreshPaper(); }
  else if (kind === 'req') S.editBuf[a] = el.value;
  else if (kind === 'code') { S.accessCode = el.value.trim(); try { sessionStorage.setItem('reqai.code', S.accessCode); } catch { /* 저장 불가 */ } }
  else if (kind === 'apply') { S.apply[a] = el.value; const btns = $$('[data-act=applyprev],[data-act=applyrun]'); btns.forEach(x => { x.disabled = !S.apply.text.trim(); }); }
  else if (kind === 'tpl') { S.template[a][+f].label = el.value; lsSet(LS_TPL, S.template); refreshPaper(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) { $('#modal').hidden = true; return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.rrow')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && e.target.id === 'custom-word') { e.preventDefault(); $('[data-act=addword]').click(); }
});
// 영역 밖에 놓아도 브라우저가 파일을 열어 작업이 날아가지 않게 막고, 1단계에서는 자동 분류로 받습니다.
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); const z = e.target.closest('.drop'); $$('.drop.over').forEach(x => { if (x !== z) x.classList.remove('over'); }); if (z) z.classList.add('over'); });
document.addEventListener('dragleave', e => { const z = e.target.closest('.drop'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const z = e.target.closest('.drop');
  $$('.drop.over').forEach(x => x.classList.remove('over'));
  const kind = z ? z.dataset.kind : S.step === 1 ? 'auto' : S.step === 4 && S.tab === 'apply' ? 'apply' : null;
  if (!kind) { toast('자료는 1단계 자료 입력 화면에 끌어다 놓으세요.'); return; }
  addFiles(kind, await filesFromDrop(e.dataTransfer));
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.id === 'modal-close') $('#modal').hidden = true; });

// ───────── 시작 ─────────
loadSample();
render();
renderBadge();
detectAI();
