// ───────── 공통 유틸 ─────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowStamp = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtNum = n => Number(n || 0).toLocaleString('ko-KR');

const CATEGORIES = ['기능', '비기능', '법·제도', '운영', '인터페이스', '데이터'];
const STATUSES = ['수용', '조건부 수용', '불가', '미결'];
const PRIORITIES = ['상', '중', '하'];
const STATUS_CLASS = { '수용': 'ok', '조건부 수용': 'cond', '불가': 'no', '미결': 'open' };
const CONFIDENCE = ['높음', '보통', '낮음'];
// 요구사항명세서의 품질속성: ISO/IEC 25010 품질 특성
const QUALITIES = ['기능적합성', '성능효율성', '호환성', '사용성', '신뢰성', '보안성', '유지보수성', '이식성', '해당 없음'];
const QUALITY_BY_CATEGORY = { '기능': '기능적합성', '비기능': '성능효율성', '법·제도': '보안성', '운영': '유지보수성', '인터페이스': '호환성', '데이터': '신뢰성' };

// ───────── 민감정보 마스킹 ─────────
// 우선순위 순서대로 찾고, 앞에서 찾은 구간과 겹치면 버립니다.
const TITLES = '대리|차장|과장|부장|팀장|주임|사원|선임|책임|수석|이사|본부장|실장|변호사|매니저|위원|원장|국장|님';
const NAME_STOP = new Set(['담당자', '대표자', '관리자', '사용자', '이용자', '고객님', '요청자', '작성자', '참석자', '책임자', '협회장', '부서장', '운영팀', '개발팀', '사업팀']);
const MASK_RULES = [
  { type: '주민번호', re: /\b\d{6}-?[1-4]\d{6}\b/g },
  { type: '카드번호', re: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b|\b\d{16}\b/g },
  { type: '이메일', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: '휴대폰', re: /\b01[016789]-?\d{3,4}-?\d{4}\b/g },
  { type: '전화번호', re: /\b0(?:2|[3-6][1-5]|70)-\d{3,4}-\d{4}\b/g },
  { type: '사업자번호', re: /\b\d{3}-\d{2}-\d{5}\b/g },
  { type: '계좌번호', re: /\b\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,3})?\b/g, ok: v => { const n = v.replace(/\D/g, '').length; return n >= 10 && n <= 16; } },
  { type: 'IP주소', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ok: v => v.split('.').every(x => +x <= 255) },
  { type: '이름', re: new RegExp(`(?<![가-힣])[가-힣]{3}(?=\\s?(?:${TITLES}))`, 'g'), ok: v => !NAME_STOP.has(v) }
];
const MASK_TYPES = ['지정어', ...MASK_RULES.map(r => r.type)];
const TOKEN_RE = /\[([가-힣A-Za-z]+)-(\d+)\]/g;

function createMasker() {
  return { items: new Map(), byToken: new Map(), counters: {}, custom: [] };
}

function maskKey(type, value) { return type + '\u0001' + value; }

function ensureItem(M, type, value) {
  const key = maskKey(type, value);
  let it = M.items.get(key);
  if (!it) {
    M.counters[type] = (M.counters[type] || 0) + 1;
    it = { key, type, value, token: `[${type}-${M.counters[type]}]`, on: true };
    M.items.set(key, it);
    M.byToken.set(it.token, it);
  }
  return it;
}

// 텍스트에서 민감정보 구간을 찾습니다. 토큰은 이때 처음 번호가 붙고 이후 고정됩니다.
function findSpans(M, text) {
  const spans = [];
  const taken = (s, e) => spans.some(x => s < x.end && e > x.start);
  for (const w of M.custom) {
    if (!w) continue;
    let i = 0;
    while ((i = text.indexOf(w, i)) !== -1) {
      if (!taken(i, i + w.length)) spans.push({ start: i, end: i + w.length, type: '지정어', value: w });
      i += w.length;
    }
  }
  for (const rule of MASK_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      const v = m[0];
      if (rule.ok && !rule.ok(v)) continue;
      if (!taken(m.index, m.index + v.length)) spans.push({ start: m.index, end: m.index + v.length, type: rule.type, value: v });
    }
  }
  for (const s of spans) s.item = ensureItem(M, s.type, s.value);
  // 한 번 찾은 값은 다른 곳에서 단서 없이 나와도 가립니다(예: 메일 머리글의 'From: 홍길동').
  for (const it of M.items.values()) {
    if (it.type === '지정어' || !it.value) continue;
    let i = 0;
    while ((i = text.indexOf(it.value, i)) !== -1) {
      const e = i + it.value.length;
      const inWord = it.type === '이름' && /[가-힣]/.test(text[i - 1] || '');
      if (!inWord && !taken(i, e)) spans.push({ start: i, end: e, type: it.type, value: it.value, item: it });
      i = e;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

function maskText(M, text) {
  const spans = findSpans(M, text);
  let out = '', pos = 0;
  for (const s of spans) {
    out += text.slice(pos, s.start) + (s.item.on ? s.item.token : s.value);
    pos = s.end;
  }
  return out + text.slice(pos);
}

function maskPreviewHTML(M, text) {
  const spans = findSpans(M, text);
  let out = '', pos = 0;
  for (const s of spans) {
    out += esc(text.slice(pos, s.start));
    out += s.item.on
      ? `<span class="redact" title="${esc(s.item.type)}: AI에 보내지 않음">${esc(s.item.token)}</span>`
      : `<span class="unmasked" title="가리지 않음: 원문 그대로 전송">${esc(s.value)}</span>`;
    pos = s.end;
  }
  return out + esc(text.slice(pos));
}

// 결과 문장의 토큰을 원래 값으로 되돌립니다. 이 브라우저 안에서만 일어납니다.
function unmask(M, text) {
  return String(text ?? '').replace(TOKEN_RE, t => { const it = M.byToken.get(t); return it ? it.value : t; });
}

// 화면 표시용: 토큰을 칩으로 바꾸거나(가림 표시) 원래 값으로 강조(복원 표시)합니다.
function richText(M, text, showOriginal) {
  return esc(text).replace(TOKEN_RE, t => {
    const it = M.byToken.get(t);
    if (!it) return t;
    return showOriginal
      ? `<span class="restored" title="${esc(it.token)} · 이 브라우저에서만 복원">${esc(it.value)}</span>`
      : `<span class="tok">${esc(it.token)}</span>`;
  });
}

// ───────── 실행 설정 ─────────
// serve.py로 실행하면 /config.js가 window.REQAI_CONFIG를 채웁니다(settings.json 내용 중 브라우저에 필요한 부분만).
// claude.ai나 파일로 바로 열면 비어 있고, 이때는 CDN 라이브러리와 claude.ai AI(또는 예시 모드)를 씁니다.
const APP_VERSION = '1.1.0';
const CFG = Object.assign({ llm: null, libBase: '' }, window.REQAI_CONFIG || {});

// ───────── 파일에서 글자 뽑기 ─────────
// libBase가 있으면(폐쇄망) vendor 폴더의 같은 파일을 씁니다. fetch_vendor.py가 이 목록대로 내려받습니다.
const LIB_FILES = {
  pdf: 'pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'mammoth/1.6.0/mammoth.browser.min.js',
  jszip: 'jszip/3.10.1/jszip.min.js',
  xlsx: 'xlsx/0.18.5/xlsx.full.min.js'
};
const CDN = Object.fromEntries(Object.entries(LIB_FILES).map(([k, f]) => [k, CFG.libBase ? CFG.libBase + f.split('/').pop() : 'https://cdnjs.cloudflare.com/ajax/libs/' + f]));
const scriptCache = {};
function loadScript(url) {
  if (!scriptCache[url]) {
    scriptCache[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete scriptCache[url]; reject(new Error(CFG.libBase ? `라이브러리 파일(${url})이 없습니다. fetch_vendor.py로 vendor 폴더를 채우세요.` : '라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
      document.head.appendChild(s);
    });
  }
  return scriptCache[url];
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
}
function xmlToText(xml, paraTag) {
  return decodeXml(xml.replace(new RegExp(`</${paraTag}>`, 'g'), '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}

async function extractText(file) {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop();
  if (['txt', 'md', 'csv', 'json', 'eml', 'log', 'tsv'].includes(ext)) return (await file.text()).trim();
  if (ext === 'pdf') {
    await loadScript(CDN.pdf);
    await loadScript(CDN.pdfWorker); // 워커를 메인 스레드에서 돌립니다(외부 워커 차단 환경 대응)
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      let line = '', lastY = null;
      const lines = [];
      for (const it of tc.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
        line += it.str; lastY = y;
        if (it.hasEOL) { lines.push(line); line = ''; lastY = null; }
      }
      if (line) lines.push(line);
      pages.push(`[${p}쪽]\n` + lines.join('\n'));
    }
    const text = pages.join('\n\n').trim();
    if (text.replace(/\[\d+쪽\]/g, '').trim().length < 10) throw new Error('PDF에서 글자를 찾지 못했습니다. 스캔 이미지 PDF는 지원하지 않습니다.');
    return text;
  }
  if (ext === 'docx') {
    await loadScript(CDN.mammoth);
    const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value.trim();
  }
  if (['xlsx', 'xls', 'xlsm'].includes(ext)) {
    await loadScript(CDN.xlsx);
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map(n => `[시트: ${n}]\n` + window.XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join('\n\n').trim();
  }
  if (ext === 'pptx') {
    await loadScript(CDN.jszip);
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const slides = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const out = [];
    for (const [i, f] of slides.entries()) out.push(`[슬라이드 ${i + 1}]\n` + xmlToText(await zip.file(f).async('string'), 'a:p'));
    return out.join('\n\n').trim();
  }
  if (ext === 'hwpx') {
    await loadScript(CDN.jszip);
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const secs = Object.keys(zip.files).filter(f => /^Contents\/section\d+\.xml$/i.test(f)).sort();
    const out = [];
    for (const f of secs) out.push(xmlToText(await zip.file(f).async('string'), 'hp:p'));
    return out.join('\n\n').trim();
  }
  if (ext === 'hwp') throw new Error('HWP 파일은 바로 읽을 수 없습니다. 한글에서 HWPX나 PDF로 저장한 뒤 올려 주세요.');
  if (['doc', 'ppt'].includes(ext)) throw new Error(`.${ext} 형식은 지원하지 않습니다. .${ext}x 형식으로 저장한 뒤 올려 주세요.`);
  throw new Error(`.${ext} 형식은 지원하지 않습니다.`);
}

// ───────── AI 프롬프트 ─────────
const KIND_LABEL = { need: '고객 니즈', meeting: '회의 내용', doc: '참고 문서', reply: '확인 회신' };

function sourcesBlock(list) {
  return list.map(s => `=== [${s.id}] ${KIND_LABEL[s.kind]} | 제목: ${s.mTitle || '(없음)'} | 작성·요청자: ${s.mAuthor || '(미상)'} | 일자: ${s.date || '(미상)'}\n${s.masked}`).join('\n\n');
}

const COMMON_RULES = `- 자료에 있는 내용만 쓰고 추측하지 마세요. 근거가 없으면 빈 문자열로 두세요.
- 자료 속 [이름-1], [휴대폰-2] 같은 대괄호 토큰은 민감정보를 가린 표시입니다. 풀거나 바꾸지 말고 그대로 옮겨 쓰세요.
- 모든 문장은 한국어 개조식(~함, ~필요)으로 간결하게 씁니다.`;

function promptAnalyze(list) {
  return `당신은 SW 개발·유지보수 요구사항 분석 전문가입니다. 아래 자료(고객 니즈, 이해관계자 회의 내용, 참고 문서)를 빠짐없이 읽고 요구사항 정의서의 기초 데이터를 만드세요.

규칙
${COMMON_RULES}
- 고객이 요청한 내용은 하나도 빠뜨리지 말고 요구사항으로 만드세요. 회의에서 나온 제약·전제 조건, 법·제도 검토 사항, 일정 요구도 요구사항이나 미결사항으로 남기세요.
- 요구사항 하나에는 요구 하나만 담으세요. id는 REQ-001부터 차례로 붙입니다.
- category는 ${CATEGORIES.join(', ')} 중 하나입니다.
- status는 ${STATUSES.join(', ')} 중 하나입니다. 회의 결정이 있으면 따르고, 결정이 없거나 의견이 갈리면 미결입니다. 조건부 수용이면 조건을, 불가면 이유를 statusReason에 쓰세요.
- priority는 긴급도로 상, 중, 하 중 하나입니다.
- quality는 품질속성(ISO/IEC 25010)으로 ${QUALITIES.join(', ')} 중 하나입니다. 기능 요구는 대개 기능적합성이고, 응답 속도는 성능효율성, 권한·마스킹·로그는 보안성, 화면·모바일은 사용성처럼 고릅니다.
- difficulty는 구현 난이도로 상, 중, 하 중 하나입니다. 개발 담당 의견, 외부 연동·규격 변경 여부, 영향 범위로 판단하고 근거가 없으면 중입니다.
- asis는 현재 상태, tobe는 개선 목표입니다. 참고 문서와 회의 발언에서 찾으세요.
- sources에는 근거 자료 ID(S1 등), 발언자나 작성자(who), 근거 문장의 짧은 원문 인용(quote)을 씁니다. 요구사항마다 1개 이상, 관련 자료가 여럿이면 모두 씁니다.
- acceptanceCriteria는 검수할 수 있는 문장으로 1~3개 씁니다.
- rationale에는 판단 과정을 남깁니다. extract는 이 요구사항을 왜 뽑았는지(어느 자료의 어떤 요청·발언에서 나왔는지, 여러 발언을 묶거나 나눴다면 그 이유), classify는 유형과 우선순위를 그렇게 정한 이유, decide는 수용 여부를 그렇게 판단한 근거(회의 결정, 담당자 의견, 참고 문서)입니다. 각각 1~2문장으로 씁니다.
- confidence는 판단 확신도로 높음, 보통, 낮음 중 하나입니다. 자료에 명시적 결정이 있으면 높음, 발언에서 추론했으면 보통, 근거가 약하면 낮음입니다.
- meeting에는 회의에서 정해진 결정사항, 결정되지 않은 미결사항(담당자 포함), 후속 조치(담당자, 기한)를 나눠 씁니다.

출력: 다음 형식의 JSON 객체 하나만 답하세요.
{"project":{"title":"요청 건 이름(20자 이내)","summary":"요청 개요 2~3문장","background":"배경·목적 1~2문장"},
"requirements":[{"id":"REQ-001","title":"","category":"기능","description":"","asis":"","tobe":"","priority":"상","quality":"기능적합성","difficulty":"중","status":"수용","statusReason":"","acceptanceCriteria":[""],"sources":[{"ref":"S1","who":"","quote":""}],"rationale":{"extract":"","classify":"","decide":""},"confidence":"높음"}],
"meeting":{"decisions":[{"text":"","ref":"S2"}],"openIssues":[{"text":"","owner":"","ref":"S2"}],"actionItems":[{"task":"","owner":"","due":"","ref":"S2"}]}}

자료
${sourcesBlock(list)}`;
}

function promptCheck(list, base) {
  const reqs = base.requirements.map(r => ({ id: r.id, title: r.title, category: r.category, description: r.description, status: r.status, statusReason: r.statusReason, acceptanceCriteria: r.acceptanceCriteria }));
  return `당신은 요구사항 품질 검토자입니다. 원 자료와 정리된 요구사항 목록을 대조해 빈틈을 찾고, 누구에게 무엇을 물어야 하는지 정리하세요.

점검 항목
1. missing: 요구사항서에 있어야 하는데 빠진 내용. 예외 처리, 권한, 로그·이력, 성능 기준, 적용 일정, 데이터 보관, 지원 환경, 검수 기준을 차례로 확인하세요. 원 자료에 단서가 있는데 요구사항에 반영되지 않은 내용도 포함합니다. reqId는 관련 요구사항 ID(전체에 해당하면 빈 문자열), item은 점검 항목 이름, detail은 무엇이 빠졌는지, suggestion은 채울 내용 예시입니다.
2. conflicts: 이해관계자끼리 의견이 다른 주제. 각 입장(who, stance, ref)을 모두 쓰고 절충안(suggestion)을 제안하세요.
3. ambiguous: "빠르게", "적절히", "한눈에"처럼 검수할 수 없는 표현. 원문 표현(phrase)과 수치·조건으로 바꾼 예시(suggestion).
4. questions: 미결·누락·충돌을 풀려면 누구에게 무엇을 물어야 하는지 대상자별로 묶으세요. to는 자료에 나온 이름과 직위 그대로(토큰 포함), role은 소속이나 역할입니다. 질문은 상대가 바로 답할 수 있게 구체적으로 쓰고, 가능하면 선택지나 제안안을 함께 주세요. why는 묻는 이유입니다.

규칙
${COMMON_RULES}

출력: 다음 형식의 JSON 객체 하나만 답하세요.
{"missing":[{"reqId":"REQ-001","item":"","detail":"","suggestion":"","ref":"S1"}],
"conflicts":[{"topic":"","reqIds":["REQ-001"],"positions":[{"who":"","stance":"","ref":"S2"}],"suggestion":""}],
"ambiguous":[{"phrase":"","reqId":"REQ-001","ref":"S1","suggestion":""}],
"questions":[{"to":"","role":"","items":[{"q":"","reqIds":["REQ-001"],"why":""}]}]}

요구사항 목록
${JSON.stringify(reqs)}

원 자료
${sourcesBlock(list)}`;
}

function promptUpdate(result, fresh) {
  const keep = { project: result.project, requirements: result.requirements.map(stripReq), meeting: result.meeting };
  return `당신은 요구사항 정의서 관리자입니다. 기존 요구사항 데이터에 새로 받은 자료(확인 질문 회신 또는 추가 자료)를 반영하세요.

규칙
${COMMON_RULES}
- 새 자료 때문에 바뀌는 요구사항만 고치세요. 나머지는 글자 하나 바꾸지 말고 그대로 두세요.
- 새 요구가 있으면 기존 마지막 번호 다음 ID로 추가합니다. 기존 ID는 바꾸지 않습니다.
- 철회된 요구사항은 지우지 말고 status를 "불가"로 바꾸고 이유를 쓰세요.
- 바뀌거나 추가된 요구사항의 sources에 새 자료 ID와 근거 문장을 넣으세요.
- 바뀌거나 추가된 요구사항은 rationale(extract, classify, decide)과 confidence(높음, 보통, 낮음)도 새 자료에 맞게 고치고, decide에 무엇 때문에 판단이 바뀌었는지 쓰세요.
- meeting의 결정사항·미결사항·후속 조치도 새 자료에 맞게 고치세요. 해결된 미결사항은 빼고 결정사항에 넣습니다.
- changes에는 바뀐 것만 씁니다. type은 추가, 변경, 해결 중 하나이고, summary는 무엇이 어떻게 바뀌었는지 한 문장으로 씁니다(예: "수용 여부 미결 → 조건부 수용: 6개월 경과 이력 분리 보관 조건").

출력: 다음 형식의 JSON 객체 하나만 답하세요. requirements에는 바뀌지 않은 것까지 전체 목록을 넣습니다.
{"project":{...},"requirements":[...],"meeting":{...},"changes":[{"type":"변경","reqId":"REQ-001","summary":""}]}

기존 데이터
${JSON.stringify(keep)}

새 자료
${sourcesBlock(fresh)}`;
}

function stripReq(r) {
  const { confirmed, _changed, ...rest } = r;
  return rest;
}

// ───────── AI 응답 정리 ─────────
// 사내 LLM은 JSON 앞뒤에 설명이나 ```json 울타리를 붙이기도 합니다. 가장 바깥 { } 를 찾아 읽습니다.
function parseJSONLoose(text) {
  const t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try { return JSON.parse(t); } catch { /* 아래에서 다시 시도 */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* 계속 */ } }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 실패 */ } }
  throw { code: 'invalid_json' };
}

const str = v => (v == null ? '' : typeof v === 'string' ? v.trim() : String(v));
const arr = v => (Array.isArray(v) ? v : v ? [v] : []);
const pick = (v, list, dflt) => { const s = str(v); return list.includes(s) ? s : (list.find(x => s.includes(x)) || dflt); };

function normalizeReq(r, i) {
  return {
    id: str(r.id) || `REQ-${String(i + 1).padStart(3, '0')}`,
    title: str(r.title) || '(제목 없음)',
    category: pick(r.category, CATEGORIES, '기능'),
    priority: pick(r.priority, PRIORITIES, '중'),
    quality: pick(r.quality, QUALITIES, QUALITY_BY_CATEGORY[pick(r.category, CATEGORIES, '기능')]),
    difficulty: pick(r.difficulty, PRIORITIES, '중'),
    status: STATUSES.includes(str(r.status)) ? str(r.status) : (/조건/.test(str(r.status)) ? '조건부 수용' : pick(r.status, STATUSES, '미결')),
    description: str(r.description), asis: str(r.asis), tobe: str(r.tobe), statusReason: str(r.statusReason),
    acceptanceCriteria: arr(r.acceptanceCriteria).map(str).filter(Boolean),
    sources: arr(r.sources).map(s => ({ ref: str(s.ref), who: str(s.who), quote: str(s.quote) })),
    rationale: { extract: str(r.rationale?.extract), classify: str(r.rationale?.classify), decide: str(r.rationale?.decide) },
    confidence: pick(r.confidence, CONFIDENCE, ''),
    confirmed: !!r.confirmed
  };
}

function normalizeResult(raw) {
  const r = raw || {};
  const checks = r.checks || {};
  const m = r.meeting || {};
  return {
    project: { title: str(r.project?.title) || '요구사항 정의', summary: str(r.project?.summary), background: str(r.project?.background) },
    requirements: arr(r.requirements).map(normalizeReq),
    meeting: {
      decisions: arr(m.decisions).map(d => ({ text: str(d.text ?? d), ref: str(d.ref) })),
      openIssues: arr(m.openIssues).map(d => ({ text: str(d.text ?? d), owner: str(d.owner), ref: str(d.ref) })),
      actionItems: arr(m.actionItems).map(d => ({ task: str(d.task ?? d), owner: str(d.owner), due: str(d.due), ref: str(d.ref) }))
    },
    checks: {
      missing: arr(checks.missing ?? r.missing).map(x => ({ reqId: str(x.reqId), item: str(x.item), detail: str(x.detail), suggestion: str(x.suggestion), ref: str(x.ref) })),
      conflicts: arr(checks.conflicts ?? r.conflicts).map(x => ({ topic: str(x.topic), reqIds: arr(x.reqIds).map(str), positions: arr(x.positions).map(p => ({ who: str(p.who), stance: str(p.stance), ref: str(p.ref) })), suggestion: str(x.suggestion) })),
      ambiguous: arr(checks.ambiguous ?? r.ambiguous).map(x => ({ phrase: str(x.phrase), reqId: str(x.reqId), ref: str(x.ref), suggestion: str(x.suggestion) }))
    },
    questions: arr(r.questions ?? checks.questions).map(g => ({ to: str(g.to), role: str(g.role), items: arr(g.items).map(q => ({ q: str(q.q ?? q), reqIds: arr(q.reqIds).map(str), why: str(q.why) })) })).filter(g => g.items.length)
  };
}

function checkKey(kind, x) {
  if (kind === 'missing') return `m|${x.reqId}|${x.item}|${x.detail.slice(0, 30)}`;
  if (kind === 'conflicts') return `c|${x.topic}`;
  return `a|${x.phrase}|${x.reqId}`;
}

// 두 결과의 요구사항을 비교해 바뀐 항목 표시를 붙입니다.
const REQ_FIELDS = { title: '요구사항명', category: '유형', priority: '우선순위', quality: '품질속성', difficulty: '난이도', status: '수용 여부', statusReason: '사유', description: '상세 내용', asis: 'AS-IS', tobe: 'TO-BE', acceptanceCriteria: '검수 기준', sources: '출처' };
function diffReq(a, b) {
  return Object.keys(REQ_FIELDS).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

// ───────── 문서 모델 (미리보기·Word·Markdown 공용) ─────────
const COLUMN_DEFS = {
  id: { label: 'ID', get: r => r.id },
  title: { label: '요구사항명', get: r => r.title },
  category: { label: '유형', get: r => r.category },
  description: { label: '상세 내용', get: r => r.description },
  asis: { label: 'AS-IS (현행)', get: r => r.asis },
  tobe: { label: 'TO-BE (개선)', get: r => r.tobe },
  priority: { label: '우선순위', get: r => r.priority },
  quality: { label: '품질속성', get: r => r.quality },
  difficulty: { label: '난이도', get: r => r.difficulty },
  status: { label: '수용 여부', get: r => r.status },
  statusReason: { label: '사유·조건', get: r => r.statusReason },
  sources: { label: '출처', get: (r, ctx) => r.sources.map(s => `${s.ref}${ctx.srcTitle(s.ref) ? ' ' + ctx.srcTitle(s.ref) : ''}${s.who ? ' / ' + s.who : ''}`).join('\n') },
  acceptance: { label: '검수 기준', get: r => r.acceptanceCriteria.map(a => '- ' + a).join('\n') },
  confirmed: { label: '확정', get: r => (r.confirmed ? '확정' : '검토 중') }
};
const SECTION_DEFS = {
  overview: '요청 개요',
  reqTable: '요구사항 목록',
  reqDetail: '요구사항 상세',
  decisions: '회의 결정사항',
  open: '미결사항 및 후속 조치',
  checks: '누락·충돌 점검 결과',
  sourcesList: '참고 자료 목록',
  history: '변경 이력'
};

const TEMPLATE_PRESETS = {
  std: {
    name: '개발요청서 (표준)', docTitle: '개발 요청서',
    sections: ['overview', 'reqTable', 'reqDetail', 'decisions', 'open', 'checks', 'sourcesList', 'history'].map(k => ({ key: k, label: SECTION_DEFS[k], on: true })),
    columns: ['id', 'title', 'category', 'description', 'priority', 'status', 'statusReason', 'sources', 'acceptance'].map(k => ({ key: k, label: COLUMN_DEFS[k].label, on: true }))
  },
  rfp: {
    name: 'RFP 요구사항 정의표', docTitle: '요구사항 정의서',
    sections: [{ key: 'overview', label: '사업 개요', on: true }, { key: 'reqTable', label: '세부 요구사항', on: true }, { key: 'reqDetail', label: '요구사항 상세', on: false }, { key: 'decisions', label: '회의 결정사항', on: false }, { key: 'open', label: '미결사항 및 후속 조치', on: false }, { key: 'checks', label: '누락·충돌 점검 결과', on: false }, { key: 'sourcesList', label: '참고 자료 목록', on: true }, { key: 'history', label: '변경 이력', on: true }],
    columns: [{ key: 'id', label: '요구사항 고유번호', on: true }, { key: 'category', label: '요구사항 분류', on: true }, { key: 'title', label: '요구사항 명칭', on: true }, { key: 'description', label: '정의', on: true }, { key: 'tobe', label: '세부 내용', on: true }, { key: 'acceptance', label: '산출정보·검수 기준', on: true }, { key: 'priority', label: '중요도', on: true }, { key: 'sources', label: '요구사항 출처', on: true }, { key: 'status', label: '수용 여부', on: false }, { key: 'statusReason', label: '사유·조건', on: false }]
  },
  brief: {
    name: '간이 요구사항 목록', docTitle: '요구사항 목록',
    sections: [{ key: 'overview', label: '요청 개요', on: false }, { key: 'reqTable', label: '요구사항 목록', on: true }, { key: 'reqDetail', label: '요구사항 상세', on: false }, { key: 'decisions', label: '회의 결정사항', on: false }, { key: 'open', label: '미결사항 및 후속 조치', on: true }, { key: 'checks', label: '누락·충돌 점검 결과', on: false }, { key: 'sourcesList', label: '참고 자료 목록', on: false }, { key: 'history', label: '변경 이력', on: false }],
    columns: ['id', 'title', 'status', 'priority', 'statusReason'].map(k => ({ key: k, label: COLUMN_DEFS[k].label, on: true }))
  }
};

// ctx: {result, meta, template, sources, history, resolved, tx(text)}
function buildDocBlocks(ctx) {
  const { result, meta, template, tx } = ctx;
  const B = [];
  const T = s => tx(s ?? '');
  B.push({ t: 'title', text: T(meta.docName || template.docTitle) });
  B.push({ t: 'kv', rows: [['요청 건명', T(meta.title || result.project.title)], ['요청 부서', T(meta.dept)], ['작성자', T(meta.author)], ['작성일', T(meta.date)], ['대상 시스템', T(meta.system)], ['문서 버전', T(meta.version)]].filter(r => r[1]) });
  let n = 0;
  for (const sec of template.sections) {
    if (!sec.on) continue;
    n++;
    const H = `${n}. ${sec.label}`;
    const reqs = result.requirements;
    if (sec.key === 'overview') {
      B.push({ t: 'h1', text: H });
      if (result.project.summary) B.push({ t: 'p', text: T(result.project.summary) });
      if (result.project.background) B.push({ t: 'kv', rows: [['배경·목적', T(result.project.background)]] });
      const cnt = s => reqs.filter(r => r.status === s).length;
      B.push({ t: 'kv', rows: [['요구사항 수', `전체 ${reqs.length}건 (수용 ${cnt('수용')}, 조건부 수용 ${cnt('조건부 수용')}, 불가 ${cnt('불가')}, 미결 ${cnt('미결')})`], ['확정 현황', `${reqs.filter(r => r.confirmed).length} / ${reqs.length}건 확정`]] });
    } else if (sec.key === 'reqTable') {
      B.push({ t: 'h1', text: H });
      const cols = template.columns.filter(c => c.on);
      B.push({ t: 'table', head: cols.map(c => c.label), rows: reqs.map(r => cols.map(c => T(COLUMN_DEFS[c.key] ? COLUMN_DEFS[c.key].get(r, ctx) : ''))), wide: true });
    } else if (sec.key === 'reqDetail') {
      B.push({ t: 'h1', text: H });
      for (const r of reqs) {
        B.push({ t: 'h2', text: `${r.id} ${T(r.title)}` });
        B.push({ t: 'kv', rows: [['유형 / 우선순위', `${r.category} / ${r.priority}`], ['수용 여부', `${r.status}${r.statusReason ? ' — ' + T(r.statusReason) : ''}`], ['상세 내용', T(r.description)], ['AS-IS (현행)', T(r.asis)], ['TO-BE (개선)', T(r.tobe)], ['검수 기준', r.acceptanceCriteria.map(a => '- ' + T(a)).join('\n')], ['출처', r.sources.map(s => `[${s.ref}] ${T(s.who)}: "${T(s.quote)}"`).join('\n')]].filter(x => x[1]) });
      }
    } else if (sec.key === 'decisions') {
      B.push({ t: 'h1', text: H });
      B.push(result.meeting.decisions.length ? { t: 'bullets', items: result.meeting.decisions.map(d => `${T(d.text)}${d.ref ? ` (${d.ref})` : ''}`) } : { t: 'p', text: '없음' });
    } else if (sec.key === 'open') {
      B.push({ t: 'h1', text: H });
      B.push({ t: 'h2', text: '미결사항' });
      B.push(result.meeting.openIssues.length ? { t: 'table', head: ['미결사항', '담당', '출처'], rows: result.meeting.openIssues.map(o => [T(o.text), T(o.owner), o.ref]) } : { t: 'p', text: '없음' });
      B.push({ t: 'h2', text: '후속 조치' });
      B.push(result.meeting.actionItems.length ? { t: 'table', head: ['조치 내용', '담당', '기한'], rows: result.meeting.actionItems.map(a => [T(a.task), T(a.owner), T(a.due)]) } : { t: 'p', text: '없음' });
    } else if (sec.key === 'checks') {
      B.push({ t: 'h1', text: H });
      const c = result.checks, st = (k, x) => (ctx.resolved.has(checkKey(k, x)) ? '해결' : '확인 필요');
      B.push({ t: 'h2', text: `누락 항목 (${c.missing.length})` });
      B.push(c.missing.length ? { t: 'table', head: ['관련', '항목', '빠진 내용', '보완 제안', '상태'], rows: c.missing.map(x => [x.reqId || '전체', T(x.item), T(x.detail), T(x.suggestion), st('missing', x)]) } : { t: 'p', text: '없음' });
      B.push({ t: 'h2', text: `상충 의견 (${c.conflicts.length})` });
      B.push(c.conflicts.length ? { t: 'table', head: ['주제', '의견', '절충 제안', '상태'], rows: c.conflicts.map(x => [`${T(x.topic)}\n(${x.reqIds.join(', ')})`, x.positions.map(p => `${T(p.who)}: ${T(p.stance)}`).join('\n'), T(x.suggestion), st('conflicts', x)]) } : { t: 'p', text: '없음' });
      B.push({ t: 'h2', text: `모호한 표현 (${c.ambiguous.length})` });
      B.push(c.ambiguous.length ? { t: 'table', head: ['원문 표현', '관련', '구체화 제안', '상태'], rows: c.ambiguous.map(x => [`"${T(x.phrase)}"`, x.reqId, T(x.suggestion), st('ambiguous', x)]) } : { t: 'p', text: '없음' });
    } else if (sec.key === 'sourcesList') {
      B.push({ t: 'h1', text: H });
      B.push({ t: 'table', head: ['ID', '구분', '제목', '작성·요청자', '일자'], rows: ctx.sources.map(s => [s.id, KIND_LABEL[s.kind], T(s.mTitle ?? s.title), T(s.mAuthor ?? s.author), s.date]) });
    } else if (sec.key === 'history') {
      B.push({ t: 'h1', text: H });
      B.push(ctx.history.length ? { t: 'table', head: ['일시', '구분', '내용'], rows: ctx.history.map(h => [h.at, h.label, h.changes.map(c => `[${c.type}] ${c.reqId ? c.reqId + ' ' : ''}${T(c.summary)}`).join('\n')]) } : { t: 'p', text: '없음' });
    }
  }
  return B;
}

function blocksToHTML(B) {
  const cell = s => esc(s).replace(/\n/g, '<br>');
  return B.map(b => {
    if (b.t === 'title') return `<h1 class="doc-title">${esc(b.text)}</h1>`;
    if (b.t === 'h1') return `<h2 class="doc-h1">${esc(b.text)}</h2>`;
    if (b.t === 'h2') return `<h3 class="doc-h2">${esc(b.text)}</h3>`;
    if (b.t === 'p') return `<p class="doc-p">${cell(b.text)}</p>`;
    if (b.t === 'bullets') return `<ul class="doc-ul">${b.items.map(i => `<li>${cell(i)}</li>`).join('')}</ul>`;
    if (b.t === 'kv') return `<table class="doc-kv"><tbody>${b.rows.map(r => `<tr><th>${esc(r[0])}</th><td>${cell(r[1])}</td></tr>`).join('')}</tbody></table>`;
    if (b.t === 'table') return `<div class="doc-scroll"><table class="doc-tbl"><thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return '';
  }).join('\n');
}

function blocksToMarkdown(B) {
  const mdCell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  return B.map(b => {
    if (b.t === 'title') return `# ${b.text}`;
    if (b.t === 'h1') return `## ${b.text}`;
    if (b.t === 'h2') return `### ${b.text}`;
    if (b.t === 'p') return b.text;
    if (b.t === 'bullets') return b.items.map(i => `- ${i.replace(/\n/g, ' ')}`).join('\n');
    if (b.t === 'kv') return `| 항목 | 내용 |\n|---|---|\n` + b.rows.map(r => `| ${mdCell(r[0])} | ${mdCell(r[1])} |`).join('\n');
    if (b.t === 'table') return `| ${b.head.map(mdCell).join(' | ')} |\n|${b.head.map(() => '---').join('|')}|\n` + b.rows.map(r => `| ${r.map(mdCell).join(' | ')} |`).join('\n');
    return '';
  }).join('\n\n') + '\n';
}

// 최소 구성 Word(.docx) 파일을 직접 만듭니다.
async function blocksToDocx(B) {
  await loadScript(CDN.jszip);
  const x = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const runs = (text, rpr = '') => String(text ?? '').split('\n').map((line, i) => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`).join('');
  const para = (text, style, rpr) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs(text, rpr)}</w:p>`;
  const PAGE_W = 14570;
  const tbl = (head, rows, widths) => {
    const cols = head ? head.length : rows[0]?.length || 1;
    const w = widths || Array(cols).fill(Math.floor(PAGE_W / cols));
    const tc = (t, i, isHead) => `<w:tc><w:tcPr><w:tcW w:w="${w[i]}" w:type="dxa"/>${isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="DDEBE7"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>${runs(t, isHead ? '<w:b/><w:sz w:val="18"/>' : '<w:sz w:val="18"/>')}</w:p></w:tc>`;
    const tr = (r, isHead) => `<w:tr>${isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((t, i) => tc(t, i, isHead)).join('')}</w:tr>`;
    const bd = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="9AA8A4"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${PAGE_W}" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${w.map(v => `<w:gridCol w:w="${v}"/>`).join('')}</w:tblGrid>${head ? tr(head, true) : ''}${rows.map(r => tr(r, false)).join('')}</w:tbl><w:p/>`;
  };
  const colWidths = head => {
    const weight = h => (/ID|번호|우선|중요|유형|분류|수용 여부|확정|상태|구분|일자|일시|관련|기한/.test(h) ? 1 : /내용|정의|검수|사유|출처|의견|제안|빠진|조치|미결/.test(h) ? 3 : 2);
    const ws = head.map(weight), sum = ws.reduce((a, b) => a + b, 0);
    return ws.map(v => Math.floor(PAGE_W * v / sum));
  };
  const body = B.map(b => {
    if (b.t === 'title') return para(b.text, 'Title');
    if (b.t === 'h1') return para(b.text, 'Heading1');
    if (b.t === 'h2') return para(b.text, 'Heading2');
    if (b.t === 'p') return para(b.text);
    if (b.t === 'bullets') return b.items.map(i => para('• ' + i)).join('');
    if (b.t === 'kv') return tbl(null, b.rows.map(r => [r[0], r[1]]), [2800, PAGE_W - 2800]).replace(/<w:tc><w:tcPr><w:tcW w:w="2800" w:type="dxa"\/>/g, '<w:tc><w:tcPr><w:tcW w:w="2800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF3F1"/>');
    if (b.t === 'table') return tbl(b.head, b.rows, colWidths(b.head));
    return '';
  }).join('');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const font = '<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕" w:cs="Malgun Gothic"/>';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F5F5B"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
</w:styles>`;
  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/document.xml', doc);
  zip.file('word/styles.xml', styles);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function buildXlsx(ctx) {
  await loadScript(CDN.xlsx);
  const X = window.XLSX, T = ctx.tx, wb = X.utils.book_new();
  const add = (name, aoa, widths) => { const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
  const cols = ctx.template.columns.filter(c => c.on);
  add('요구사항', [cols.map(c => c.label), ...ctx.result.requirements.map(r => cols.map(c => T(COLUMN_DEFS[c.key] ? COLUMN_DEFS[c.key].get(r, ctx) : '')))], cols.map(c => (/내용|기준|사유|출처|정의/.test(c.label) ? 50 : /명/.test(c.label) ? 28 : 12)));
  const r = ctx.result.requirements;
  add('추적표', [['ID', '요구사항명', '수용 여부', '출처 ID', '발언·작성자', '근거 문장', '검수 기준'], ...r.flatMap(q => (q.sources.length ? q.sources : [{}]).map((s, i) => [q.id, i ? '' : T(q.title), i ? '' : q.status, s.ref || '', T(s.who || ''), T(s.quote || ''), i ? '' : q.acceptanceCriteria.map(T).join('\n')]))], [10, 28, 12, 8, 18, 50, 50]);
  const c = ctx.result.checks;
  add('점검결과', [['구분', '관련', '항목·주제', '내용', '제안', '상태'],
    ...c.missing.map(x => ['누락', x.reqId || '전체', T(x.item), T(x.detail), T(x.suggestion), ctx.resolved.has(checkKey('missing', x)) ? '해결' : '확인 필요']),
    ...c.conflicts.map(x => ['상충', x.reqIds.join(', '), T(x.topic), x.positions.map(p => `${T(p.who)}: ${T(p.stance)}`).join('\n'), T(x.suggestion), ctx.resolved.has(checkKey('conflicts', x)) ? '해결' : '확인 필요']),
    ...c.ambiguous.map(x => ['모호', x.reqId, `"${T(x.phrase)}"`, '', T(x.suggestion), ctx.resolved.has(checkKey('ambiguous', x)) ? '해결' : '확인 필요'])], [8, 14, 20, 50, 50, 10]);
  add('확인질문', [['받는 사람', '역할', '질문', '관련', '이유'], ...ctx.result.questions.flatMap(g => g.items.map(q => [T(g.to), T(g.role), T(q.q), q.reqIds.join(', '), T(q.why)]))], [18, 16, 70, 14, 30]);
  add('변경이력', [['일시', '구분', '유형', '관련', '내용'], ...ctx.history.flatMap(h => h.changes.map(ch => [h.at, h.label, ch.type, ch.reqId, T(ch.summary)]))], [16, 14, 8, 10, 70]);
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ───────── AI 판단 과정 기록 (설명 가능성) ─────────
// 나중에 "왜 이렇게 정리됐는지"를 추적할 수 있도록 입력·보호 조치·AI 호출·요구사항별 판단 근거·사람의 검토를 한 문서로 남깁니다.
// ctx: docCtx() + {calls, maskStats, engine, prompts}
function buildTraceMarkdown(ctx) {
  const { result, tx } = ctx;
  const T = s => tx(s ?? '');
  const cell = s => String(s ?? '').replace(/\|/g, '\|').replace(/\n/g, '<br>');
  const table = (head, rows) => rows.length ? `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map(r => `| ${r.map(cell).join(' | ')} |`).join('\n') : '_없음_';
  const reqs = result.requirements;
  const histOf = id => ctx.history.flatMap(h => h.changes.filter(c => c.reqId === id).map(c => ({ at: h.at, label: h.label, ref: h.ref, ...c })));
  const done = (k, x) => (ctx.resolved.has(checkKey(k, x)) ? '해결' : '확인 필요');
  const L = [];
  L.push(`# AI 판단 과정 기록: ${T(result.project.title)}`);
  L.push(table(['항목', '내용'], [
    ['만든 일시', nowStamp()],
    ['도구', `모두의 요구사항 한 번에! v${APP_VERSION}`],
    ['분석 방식', result.isDemo ? '예시 모드: 미리 분석해 둔 결과를 불러옴 (AI를 호출하지 않음)' : ctx.engine],
    ['요구사항', `${reqs.length}건 (확정 ${reqs.filter(r => r.confirmed).length}건)`],
    ['민감정보 표시', ctx.restored ? '이 문서는 가린 값을 원래 값으로 채워 만들었습니다. 외부 공유 전에 확인하세요.' : 'AI에 보낸 상태 그대로([이름-1] 같은 토큰)로 기록했습니다.']
  ]));
  L.push('> 이 문서는 AI가 낸 결과를 사람이 검증할 수 있도록 판단 근거와 처리 과정을 남긴 기록입니다. AI 결과는 초안이며, 확정 표시는 담당자가 직접 확인한 항목입니다.');

  L.push('## 1. 처리 순서');
  L.push(['1. **자료 입력**: 고객 니즈, 회의 내용, 참고 문서를 받음',
    '2. **민감정보 가리기**: 이름·연락처·계좌 등을 이 브라우저 안에서 토큰으로 바꿈. 원래 값은 AI에 보내지 않음',
    '3. **요구사항 추출·분류**: AI가 요구사항, 출처, 유형·우선순위·수용 여부와 그 판단 근거를 정리함',
    '4. **누락·충돌 점검**: AI가 정리된 요구사항을 원 자료와 다시 대조해 빠진 것, 의견이 다른 것, 모호한 표현을 찾음',
    '5. **사람 검토**: 담당자가 수정·확정·해결 표시를 하고, 회신을 받아 다시 반영함',
    '6. **문서 생성**: 확정한 내용으로 양식에 맞춰 문서를 만듦'].join('\n'));

  L.push('## 2. 입력 자료');
  L.push(table(['ID', '구분', '제목', '작성·요청자', '일자', '글자 수', '파일'], ctx.sources.map(s => [s.id, KIND_LABEL[s.kind], T(s.mTitle ?? s.title), T(s.mAuthor ?? s.author), s.date, fmtNum(s.text.length), s.fileName || '직접 입력'])));

  L.push('## 3. 민감정보 보호 조치');
  L.push('AI에 보내기 전에 아래 항목을 토큰으로 바꿨습니다. 원래 값은 이 기록에 남기지 않습니다.');
  L.push(table(['유형', '가림', '가리지 않음(원문 전송)'], ctx.maskStats.map(m => [m.type, `${m.on}종`, m.off ? `${m.off}종` : '-'])));
  if (ctx.maskStats.some(m => m.off)) L.push('> 주의: 담당자가 "가리지 않음"으로 바꾼 항목은 원문 그대로 AI에 전송됐습니다.');

  L.push('## 4. AI 호출 기록');
  L.push(table(['#', '시각', '단계', '실행', '보낸 크기', '받은 글자', '걸린 시간', '결과'], ctx.calls.map((c, i) => [i + 1, c.at, c.step, c.engine, c.inBytes ? `${fmtNum(c.inBytes)} B` : '-', c.outChars ? fmtNum(c.outChars) : '-', c.ms != null ? `${(c.ms / 1000).toFixed(1)}초` : '-', c.ok ? '성공' : `실패: ${c.error || ''}`])));
  L.push('AI에 준 지시문 전문은 이 문서 끝 [부록]에 있습니다. 자료 본문은 3장의 보호 조치를 거친 상태로만 전송됐습니다.');

  L.push('## 5. 요구사항별 판단 근거');
  const cnt = s => reqs.filter(r => r.status === s).length;
  L.push(`전체 ${reqs.length}건: ${STATUSES.map(s => `${s} ${cnt(s)}`).join(', ')}`);
  for (const r of reqs) {
    L.push(`### ${r.id} ${T(r.title)}`);
    L.push(table(['판단', '결과', '근거'], [
      ['추출', T(r.description), T(r.rationale?.extract) || '(기록 없음)'],
      ['유형·우선순위', `${r.category} / ${r.priority}`, T(r.rationale?.classify) || '(기록 없음)'],
      ['수용 여부', `${r.status}${r.statusReason ? `: ${T(r.statusReason)}` : ''}`, T(r.rationale?.decide) || '(기록 없음)'],
      ['확신도', r.confidence || '(기록 없음)', r.confidence === '낮음' ? '근거가 약함. 담당자 확인 필요' : ''],
      ['사람 검토', r.confirmed ? '확정' : '검토 중', '']
    ]));
    if (r.sources.length) L.push('근거 문장\n\n' + r.sources.map(s => `> **[${s.ref}${ctx.srcTitle(s.ref) ? ' ' + ctx.srcTitle(s.ref) : ''}]** ${T(s.who)}: "${T(s.quote)}"`).join('\n>\n'));
    else L.push('> 근거 문장 없음: 출처를 확인해야 합니다.');
    const h = histOf(r.id);
    if (h.length) L.push('변경 이력\n\n' + h.map(c => `- ${c.at} ${c.label}${c.ref ? ` (${c.ref})` : ''}: [${c.type}] ${T(c.summary)}`).join('\n'));
  }

  const c = result.checks;
  L.push('## 6. 누락·충돌 점검 판단');
  L.push('AI가 요구사항 목록을 원 자료와 다시 대조해 찾은 항목입니다. 상태는 담당자가 표시한 처리 결과입니다.');
  L.push('### 빠진 항목');
  L.push(table(['관련', '점검 항목', '왜 빠졌다고 봤는지', '보완 제안', '근거 자료', '상태'], c.missing.map(x => [x.reqId || '전체', T(x.item), T(x.detail), T(x.suggestion), x.ref, done('missing', x)])));
  L.push('### 서로 다른 의견');
  L.push(table(['주제', '관련', '각 입장', '절충 제안', '상태'], c.conflicts.map(x => [T(x.topic), x.reqIds.join(', '), x.positions.map(p => `${T(p.who)}(${p.ref}): ${T(p.stance)}`).join('\n'), T(x.suggestion), done('conflicts', x)])));
  L.push('### 모호한 표현');
  L.push(table(['원문 표현', '관련', '근거 자료', '구체화 제안', '상태'], c.ambiguous.map(x => [`"${T(x.phrase)}"`, x.reqId, x.ref, T(x.suggestion), done('ambiguous', x)])));
  L.push('### 확인 질문');
  L.push(table(['받는 사람', '질문', '관련', '묻는 이유'], result.questions.flatMap(g => g.items.map(q => [`${T(g.to)} (${T(g.role)})`, T(q.q), q.reqIds.join(', '), T(q.why)]))));

  L.push('## 7. 전체 변경 이력');
  L.push(table(['일시', '구분', '근거 자료', '유형', '관련', '내용'], ctx.history.flatMap(h => h.changes.map(ch => [h.at, h.label, h.ref || '-', ch.type, ch.reqId || '-', T(ch.summary)]))));

  L.push('## 8. 유의사항');
  L.push(['- AI 결과는 초안입니다. 수용 여부와 일정은 담당 부서가 최종 결정합니다.',
    '- 확신도 "낮음"이거나 근거 문장이 없는 요구사항은 원 자료로 다시 확인하세요.',
    '- 같은 자료라도 AI 모델이나 실행 시점에 따라 결과가 조금 달라질 수 있습니다. 이 기록은 이번 실행의 판단 과정입니다.'].join('\n'));

  if (ctx.prompts.length) {
    L.push('## 부록. AI에 준 지시문');
    for (const p of ctx.prompts) L.push(`<details><summary>${p.name}</summary>\n\n\`\`\`text\n${p.text.replace(/```/g, "'''")}\n\`\`\`\n\n</details>`);
  }
  return L.join('\n\n') + '\n';
}
