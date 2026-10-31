// ───────── 사내 표준 양식 ─────────
// 문서 만들기의 양식 목록에 개발요청서·RFP·간이 목록과 나란히 들어갑니다. 모양이 표준으로 고정돼 목차·열 편집은 없습니다.
const FORM_PRESETS = {
  pumui: {
    name: '품의문 (한글)', fmt: 'hwpx', button: '한글로 내려받기 (.hwpx)', meta: ['title', 'dept', 'author', 'system'],
    note: '사내 한글 문서 작성 표준을 따릅니다. 한글 2014 이후 버전에서 열립니다.',
    help: '품의문은 한글(.hwpx) 파일 하나로 내려받습니다. 붙임으로 요구사항명세서를 함께 첨부하세요.',
    spec: [['용지', 'A4, 위 20 · 아래 10 · 좌우 20mm'], ['글꼴', '휴먼명조(제목류는 굵게)'], ['크기', '제목 22, 대 16, 중 15, 내용 14, 표 12pt'], ['항목', '1. → 가. → □ → ○ → -'], ['표', '0.1mm 실선, 양 끝 세로선 없음, 첫 행 음영'], ['쪽 번호', '가운데 아래 "- 1 -"'], ['구성', '추진 배경 · 요청 개요 · 주요 요구사항 · 협의 결과 및 향후 조치 · 붙임']]
  },
  spec: {
    name: '요구사항명세서 (Excel)', fmt: 'spec', button: 'Excel로 내려받기 (.xlsx)', meta: ['title', 'author', 'date'],
    note: '사내 요구사항명세 양식과 같은 배치입니다.',
    help: "요구사항명세서는 시트 '요구사항명세(상세)' 하나로 내려받습니다. 머리글에 필터가 걸리고, 유형·품질속성·긴급도·난이도는 목록에서 고릅니다.",
    spec: [['1행', '관련개발요청 · 작성자 · 작성일'], ['3행', '요구사항 ID · 유형 · 품질속성 · 요구사항명 · 상세설명 · 긴급도 · 난이도 · 출처'], ['상세설명', '내용 + 수용 여부 조건 + 검수 기준'], ['품질속성', 'ISO/IEC 25010 품질 특성'], ['긴급도·난이도', '상 · 중 · 하 (요구사항 수정에서 변경)']]
  }
};

// ───────── 품의문 (한글 문서 작성 표준) ─────────
// 내용 모델 하나로 화면 미리보기와 HWPX 파일을 함께 만듭니다.
// 블록: title, h1(1.), h2(가.), box(□), circle(○), dash(-), table, note(*), attach(붙임)
const HANGUL_SEQ = '가나다라마바사아자차카타파하';
const dotDate = iso => { const m = String(iso || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? `${m[1]}. ${+m[2]}. ${+m[3]}.` : String(iso || ''); };
const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function buildPumuiBlocks(ctx) {
  const { result, meta, tx } = ctx;
  const T = s => tx(s ?? '');
  const reqs = result.requirements, m = result.meeting;
  const title = T(meta.title || result.project.title);
  const B = [{ t: 'title', text: `${title} 개발 요청` }];
  let n = 0, sub = 0;
  const h1 = text => { B.push({ t: 'h1', text: `${++n}. ${text}` }); sub = 0; };
  const h2 = text => B.push({ t: 'h2', text: `${HANGUL_SEQ[sub++]}. ${text}` });
  const cnt = s => reqs.filter(r => r.status === s).length;
  const kinds = new Set(ctx.sources.map(s => s.kind));
  const basis = [kinds.has('need') && '고객 요청', kinds.has('meeting') && '이해관계자 협의', kinds.has('reply') && '확인 회신', kinds.has('doc') && '현행 자료 검토'].filter(Boolean).join('·') || '검토';

  h1('추진 배경');
  if (result.project.background) B.push({ t: 'box', text: T(result.project.background) });
  B.push({ t: 'box', text: `${basis} 결과를 반영하여 아래와 같이 개발을 요청하고자 함` });

  h1('요청 개요');
  B.push({ t: 'box', text: `요청 건명: ${title}` });
  if (meta.dept) B.push({ t: 'box', text: `요청 부서: ${T(meta.dept)}` });
  if (meta.system) B.push({ t: 'box', text: `대상 시스템: ${T(meta.system)}` });
  if (result.project.summary) B.push({ t: 'box', text: `요청 내용: ${T(result.project.summary)}` });
  B.push({ t: 'box', text: `요구사항: 전체 ${reqs.length}건(수용 ${cnt('수용')}, 조건부 수용 ${cnt('조건부 수용')}, 불가 ${cnt('불가')}, 미결 ${cnt('미결')})` });

  h1('주요 요구사항');
  B.push({ t: 'table', title: '요구사항 목록', head: ['번호', '요구사항명', '유형', '긴급도', '수용 여부'], align: ['c', 'l', 'c', 'c', 'c'], weights: [1.8, 4.4, 1.6, 1.3, 1.7],
    rows: reqs.map(r => [r.id, T(r.title), r.category, r.priority, r.status]) });
  B.push({ t: 'note', text: '* 세부 내용은 붙임 「요구사항명세서」 참조' });
  for (const [st, label] of [['조건부 수용', '조건부 수용 사항'], ['불가', '불가 사항']]) {
    const list = reqs.filter(r => r.status === st);
    if (!list.length) continue;
    h2(label);
    for (const r of list) {
      B.push({ t: 'box', text: `${T(r.title)}(${r.id})` });
      if (r.statusReason) B.push({ t: 'circle', text: T(r.statusReason) });
    }
  }

  h1('협의 결과 및 향후 조치');
  if (m.decisions.length) { h2('결정사항'); m.decisions.forEach(d => B.push({ t: 'box', text: T(d.text) })); }
  if (m.openIssues.length) {
    h2('미결사항');
    m.openIssues.forEach(o => { B.push({ t: 'box', text: T(o.text) }); if (o.owner) B.push({ t: 'dash', text: `담당: ${T(o.owner)}` }); });
  }
  if (m.actionItems.length) {
    h2('후속 조치');
    B.push({ t: 'table', title: '후속 조치 계획', head: ['조치 내용', '담당', '기한'], align: ['l', 'c', 'c'], weights: [5, 2, 1.6],
      rows: m.actionItems.map(a => [T(a.task), T(a.owner) || '미지정', T(a.due) || '미정']) });
  }
  B.push({ t: 'attach', text: '붙임  요구사항명세서 1부.  끝.' });
  return B;
}

// 표준의 문단 간격: 앞 요소에 따라 빈 줄 크기(pt)를 고릅니다.
function pumuiGap(prev, cur) {
  if (!prev) return 0;
  if (cur === 'h1' || cur === 'attach') return 20;
  if (cur === 'h2') return 16;
  if (cur === 'table') return 14;
  if (cur === 'note') return 0;
  if (cur === 'box') return /^h/.test(prev) ? 14 : 10;
  return 6; // circle, dash
}

function pumuiToHTML(B) {
  let prev = null;
  return '<div class="pumui">' + B.map(b => {
    const gap = pumuiGap(prev, b.t); prev = b.t;
    const st = gap ? ` style="margin-top:${gap}pt"` : '';
    if (b.t === 'title') return `<div class="pm-title">${esc(b.text)}</div>`;
    if (b.t === 'h1') return `<p class="pm-h1"${st}>${esc(b.text)}</p>`;
    if (b.t === 'h2') return `<p class="pm-h2"${st}>${esc(b.text)}</p>`;
    if (b.t === 'box') return `<p class="pm-b pm-l2"${st}><span>□</span>${esc(b.text)}</p>`;
    if (b.t === 'circle') return `<p class="pm-b pm-l3"${st}><span>○</span>${esc(b.text)}</p>`;
    if (b.t === 'dash') return `<p class="pm-b pm-l4"${st}><span>-</span>${esc(b.text)}</p>`;
    if (b.t === 'note') return `<p class="pm-note">${esc(b.text)}</p>`;
    if (b.t === 'attach') return `<p class="pm-attach"${st}>${esc(b.text)}</p>`;
    if (b.t === 'table') return `<p class="pm-tt"${st}>${esc(b.title)}</p><div class="doc-scroll"><table class="pm-tbl"><thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, i) => `<td class="${b.align[i] === 'l' ? 'l' : ''}">${esc(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return '';
  }).join('') + '<div class="pm-page">- 1 -</div></div>';
}

// ── HWPX(OWPML) 쓰기 ──
// 한글이 만든 빈 문서의 구조를 따라 header.xml(글꼴·글자·문단·테두리 모양)과 section0.xml(본문)을 직접 씁니다.
// 단위: HWPUNIT(1pt = 100, 1mm ≈ 283.465)
const mmHU = v => Math.round(v * 283.465);
const HWPX_NS = 'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

// 글꼴은 모두 휴먼명조(제목류는 굵게). 글자 모양: 크기 pt, 굵게, 밑줄
const PM_CHAR = [
  { pt: 14, f: 0 },            // 0 본문 내용
  { pt: 12, f: 0 },            // 1 표 내용·주석·쪽 번호
  { pt: 22, f: 0, b: 1 },      // 2 문서 제목
  { pt: 16, f: 0, b: 1 },      // 3 대제목 1.
  { pt: 15, f: 0, b: 1 },      // 4 중제목 가.
  { pt: 14, f: 0, u: 1 },      // 5 표 제목(밑줄)
  { pt: 12, f: 0, b: 1 },      // 6 표 첫 행
  { pt: 20, f: 0 }, { pt: 16, f: 0 }, { pt: 10, f: 0 }, { pt: 6, f: 0 } // 7~10 문단 간격용 빈 줄
];
const PM_GAP_CHAR = { 20: 7, 16: 8, 14: 0, 10: 9, 6: 10 };
// 문단 모양: 정렬, 줄 간격 %, 왼쪽 여백, 내어쓰기(음수)
const PM_PARA = [
  { al: 'JUSTIFY', ls: 160 },                         // 0 바탕(대제목)
  { al: 'CENTER', ls: 160 },                          // 1 제목 상자·표 제목·표를 담는 문단
  { al: 'CENTER', ls: 110 },                          // 2 표 칸(가운데)
  { al: 'JUSTIFY', ls: 110 },                         // 3 표 칸(긴 글)
  { al: 'JUSTIFY', ls: 100 },                         // 4 문단 간격용 빈 줄
  { al: 'JUSTIFY', ls: 160, left: 700 },              // 5 중제목 가.(1칸 들여씀)
  { al: 'JUSTIFY', ls: 160, left: 1400, ind: -1500 }, // 6 □
  { al: 'JUSTIFY', ls: 160, left: 2100, ind: -1500 }, // 7 ○
  { al: 'JUSTIFY', ls: 160, left: 2800, ind: -1000 }, // 8 -
  { al: 'JUSTIFY', ls: 130, left: 1400, ind: -700 },  // 9 주석 *
  { al: 'JUSTIFY', ls: 160, left: 0, ind: -2400 },    // 10 붙임
  { al: 'CENTER', ls: 130 }                           // 11 쪽 번호·머리말
];
const BF = { page: 1, none: 2, cell: 3, cellL: 4, cellR: 5, cellLR: 6, head: 7, headL: 8, headR: 9, headLR: 10, titleBox: 11 };

function hwpxHeader() {
  const font = (id, face, fam) => `<hh:font id="${id}" face="${face}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="${fam}" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`;
  const faces = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'].map(l => `<hh:fontface lang="${l}" fontCnt="1">${font(0, '휴먼명조', 'FCAT_MYUNGJO')}</hh:fontface>`).join('');
  const L7 = v => ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user'].map(k => `${k}="${v}"`).join(' ');
  const chars = PM_CHAR.map((c, i) => `<hh:charPr id="${i}" height="${c.pt * 100}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${BF.none}"><hh:fontRef ${L7(c.f)}/><hh:ratio ${L7(100)}/><hh:spacing ${L7(0)}/><hh:relSz ${L7(100)}/><hh:offset ${L7(0)}/>${c.b ? '<hh:bold/>' : ''}<hh:underline type="${c.u ? 'BOTTOM' : 'NONE'}" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`).join('');
  const margin = (p, k) => `<hh:margin><hc:intent value="${(p.ind || 0) * k}" unit="HWPUNIT"/><hc:left value="${(p.left || 0) * k}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="${p.ls}" unit="HWPUNIT"/>`;
  const paras = PM_PARA.map((p, i) => `<hh:paraPr id="${i}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR"><hh:align horizontal="${p.al}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin(p, 1)}</hp:case><hp:default>${margin(p, 2)}</hp:default></hp:switch><hh:border borderFillIDRef="${BF.none}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`).join('');
  // 표: 0.1mm 검정 실선, 양 끝 세로선 없음, 첫 행만 음영(검정 90% 밝게)
  const line = (on, w, c) => `type="${on ? 'SOLID' : 'NONE'}" width="${w}" color="${c}"`;
  const bf = (id, l, r, t, b, fill, w = '0.1 mm', c = '#000000') => `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder ${line(l, w, c)}/><hh:rightBorder ${line(r, w, c)}/><hh:topBorder ${line(t, w, c)}/><hh:bottomBorder ${line(b, w, c)}/><hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>${fill ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : ''}</hh:borderFill>`;
  const G = '#E5E5E5';
  const fills = [bf(1, 0, 0, 0, 0), bf(2, 0, 0, 0, 0, 'none'),
    bf(3, 1, 1, 1, 1), bf(4, 0, 1, 1, 1), bf(5, 1, 0, 1, 1), bf(6, 0, 0, 1, 1),
    bf(7, 1, 1, 1, 1, G), bf(8, 0, 1, 1, 1, G), bf(9, 1, 0, 1, 1, G), bf(10, 0, 0, 1, 1, G),
    bf(11, 0, 0, 1, 1, null, '1.0 mm', '#2E5D8E')].join(''); // 제목 상자: 양단선 1mm
  const styles = [['바탕글', 'Normal', 0, 0], ['본문', 'Body', 0, 0], ['쪽 번호', 'Page Number', 11, 1, 'CHAR'], ['머리말', 'Header', 11, 1], ['각주', 'Footnote', 9, 1], ['미주', 'Endnote', 9, 1], ['캡션', 'Caption', 1, 1]]
    .map(([n, e, pp, cp, type], i) => `<hh:style id="${i}" type="${type || 'PARA'}" name="${n}" engName="${e}" paraPrIDRef="${pp}" charPrIDRef="${cp}" nextStyleIDRef="${type ? 0 : i}" langID="1042" lockForm="0"/>`).join('');
  return `${XMLH}<hh:head ${HWPX_NS} version="1.5" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList><hh:fontfaces itemCnt="7">${faces}</hh:fontfaces><hh:borderFills itemCnt="11">${fills}</hh:borderFills><hh:charProperties itemCnt="${PM_CHAR.length}">${chars}</hh:charProperties><hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties><hh:paraProperties itemCnt="${PM_PARA.length}">${paras}</hh:paraProperties><hh:styles itemCnt="7">${styles}</hh:styles></hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument><hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>`;
}

function hwpxSection(B) {
  let pid = 1, oid = 1;
  const p = (pp, cp, inner) => `<hp:p id="${pid++}" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cp}">${inner}</hp:run></hp:p>`;
  const tp = (pp, cp, text) => p(pp, cp, text ? `<hp:t>${xmlEsc(text)}</hp:t>` : '<hp:t/>');
  const W = 59528 - 2 * mmHU(20); // 본문 폭
  const table = (rows, widths, cellFn, rowH = mmHU(7)) => {
    const R = rows.length, C = widths.length;
    const trs = rows.map((row, r) => `<hp:tr>${row.map((txt, c) => {
      const { bf, pp, cp } = cellFn(r, c);
      const paras = String(txt ?? '').split('\n').map(line => tp(pp, cp, line)).join('');
      return `<hp:tc name="" header="${r === 0 && R > 1 ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${widths[c]}" height="${rowH}"/><hp:cellMargin left="510" right="510" top="142" bottom="142"/></hp:tc>`;
    }).join('')}</hp:tr>`).join('');
    const id = 1000000 + oid++;
    return p(1, 0, `<hp:tbl id="${id}" zOrder="${oid}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${R}" colCnt="${C}" cellSpacing="0" borderFillIDRef="${BF.page}" noAdjust="0"><hp:sz width="${W}" widthRelTo="ABSOLUTE" height="${rowH * R}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="142" bottom="142"/>${trs}</hp:tbl><hp:t/>`);
  };
  const splitW = weights => { const sum = weights.reduce((a, b) => a + b, 0); const w = weights.map(v => Math.floor(W * v / sum)); w[w.length - 1] += W - w.reduce((a, b) => a + b, 0); return w; };
  const notePr = k => `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="${k ? 14692344 : -1}" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="${k ? 0 : 283}" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="${k ? 'END_OF_DOCUMENT' : 'EACH_COLUMN'}" beneathText="0"/>`;
  // 용지: A4, 위 20·아래 10·좌우 20, 머리말·꼬리말 10(mm)
  const secPr = `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/><hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY"><hp:margin header="${mmHU(10)}" footer="${mmHU(10)}" gutter="0" left="${mmHU(20)}" right="${mmHU(20)}" top="${mmHU(20)}" bottom="${mmHU(10)}"/></hp:pagePr><hp:footNotePr>${notePr(0)}</hp:footNotePr><hp:endNotePr>${notePr(1)}</hp:endNotePr>${['BOTH', 'EVEN', 'ODD'].map(t => `<hp:pageBorderFill type="${t}" borderFillIDRef="${BF.page}" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`).join('')}</hp:secPr>`;
  // 첫 문단: 구역 설정, 단 설정, 쪽 번호(가운데 아래 "- 1 -")
  let body = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${secPr}<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl><hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl></hp:run><hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>`;
  let prev = null;
  for (const b of B) {
    const gap = pumuiGap(prev, b.t); prev = b.t;
    if (gap) body += tp(4, PM_GAP_CHAR[gap], '');
    if (b.t === 'title') body += table([[b.text]], [W], () => ({ bf: BF.titleBox, pp: 1, cp: 2 }), mmHU(15));
    else if (b.t === 'h1') body += tp(0, 3, b.text);
    else if (b.t === 'h2') body += tp(5, 4, b.text);
    else if (b.t === 'box') body += tp(6, 0, `□ ${b.text}`);
    else if (b.t === 'circle') body += tp(7, 0, `○ ${b.text}`);
    else if (b.t === 'dash') body += tp(8, 0, `- ${b.text}`);
    else if (b.t === 'note') body += tp(9, 1, b.text);
    else if (b.t === 'attach') body += tp(10, 0, b.text);
    else if (b.t === 'table') {
      body += tp(1, 5, b.title);
      const C = b.head.length;
      const edge = c => (C === 1 ? 'LR' : c === 0 ? 'L' : c === C - 1 ? 'R' : '');
      body += table([b.head, ...b.rows], splitW(b.weights), (r, c) => ({
        bf: BF[(r === 0 ? 'head' : 'cell') + edge(c)],
        pp: r === 0 || b.align[c] !== 'l' ? 2 : 3,
        cp: r === 0 ? 6 : 1
      }));
    }
  }
  return `${XMLH}<hs:sec ${HWPX_NS}>${body}</hs:sec>`;
}

// 압축 파일 구성은 한글이 저장한 빈 문서와 같습니다(mimetype은 압축하지 않고 맨 앞).
function hwpxParts(ctx) {
  const B = buildPumuiBlocks(ctx);
  const title = B[0].text;
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const pkg = 'http://www.hancom.co.kr/hwpml/2016/meta/pkg#';
  return [
    ['mimetype', 'application/hwp+zip'],
    ['version.xml', `${XMLH}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="13, 0, 0, 1408 WIN32LEWindows_10"/>`],
    ['Contents/header.xml', hwpxHeader()],
    ['Contents/section0.xml', hwpxSection(B)],
    ['Preview/PrvText.txt', title + '\r\n'],
    ['settings.xml', `${XMLH}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`],
    ['META-INF/container.rdf', `${XMLH}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="${pkg}" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="${pkg}HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="${pkg}" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="${pkg}SectionFile"/></rdf:Description><rdf:Description rdf:about=""><rdf:type rdf:resource="${pkg}Document"/></rdf:Description></rdf:RDF>`],
    ['Contents/content.hpf', `${XMLH}<opf:package ${HWPX_NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${xmlEsc(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">${xmlEsc(ctx.tx(ctx.meta.author || ''))}</opf:meta><opf:meta name="subject" content="text"/><opf:meta name="description" content="text">모두의 요구사항 한 번에!로 작성</opf:meta><opf:meta name="CreatedDate" content="text">${stamp}</opf:meta><opf:meta name="ModifiedDate" content="text">${stamp}</opf:meta><opf:meta name="keyword" content="text"/></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`],
    ['META-INF/container.xml', `${XMLH}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/><ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/></ocf:rootfiles></ocf:container>`],
    ['META-INF/manifest.xml', `${XMLH}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`]
  ];
}

async function buildPumuiHwpx(ctx) {
  await loadScript(CDN.jszip);
  const zip = new window.JSZip();
  for (const [name, data] of hwpxParts(ctx)) zip.file(name, data, name === 'mimetype' ? { compression: 'STORE', createFolders: false } : { createFolders: false });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
}

// ───────── 요구사항명세서 (사내 Excel 양식) ─────────
// 1행: 관련개발요청 | 건명(B~D 병합) | 작성자 | 이름 | 작성일 | 날짜, 3행: 머리글(필터), 4행부터 요구사항
const SPEC_COLS = [
  { label: '요구사항 ID', w: 14, al: 'c', get: r => r.id },
  { label: '유형', w: 10, al: 'c', get: r => r.category, list: CATEGORIES },
  { label: '품질속성', w: 12, al: 'c', get: r => r.quality, list: QUALITIES },
  { label: '요구사항명', w: 34, al: 'l', get: (r, T) => T(r.title) },
  { label: '상세설명', w: 70, al: 'l', get: (r, T) => [T(r.description), r.status !== '수용' ? `[${r.status}] ${T(r.statusReason)}` : '', r.acceptanceCriteria.length ? '[검수 기준]\n' + r.acceptanceCriteria.map(a => '- ' + T(a)).join('\n') : ''].filter(Boolean).join('\n') },
  { label: '긴급도', w: 8, al: 'c', get: r => r.priority, list: PRIORITIES },
  { label: '난이도', w: 8, al: 'c', get: r => r.difficulty, list: PRIORITIES },
  { label: '출처', w: 30, al: 'l', get: (r, T, ctx) => r.sources.map(s => `${s.ref} ${ctx.srcTitle(s.ref)}${s.who ? `(${T(s.who)})` : ''}`).join('\n') }
];

function specRows(ctx) {
  return ctx.result.requirements.map(r => SPEC_COLS.map(c => String(c.get(r, ctx.tx, ctx) ?? '')));
}

function specToHTML(ctx) {
  const T = ctx.tx;
  return `<div class="spec"><table class="spec-meta"><tr><th>관련개발요청</th><td>${esc(T(ctx.meta.title || ctx.result.project.title))}</td><th>작성자</th><td>${esc(T(ctx.meta.author))}</td><th>작성일</th><td>${esc(ctx.meta.date)}</td></tr></table>
  <div class="doc-scroll"><table class="spec-tbl"><thead><tr>${SPEC_COLS.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${specRows(ctx).map(row => `<tr>${row.map((v, i) => `<td class="${SPEC_COLS[i].al}">${esc(v).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

// 서식(노란 머리글, 테두리, 병합, 필터, 목록)을 넣기 위해 xlsx를 직접 만듭니다.
function specXlsxParts(ctx) {
  const T = ctx.tx;
  const colL = i => String.fromCharCode(65 + i);
  const cell = (ref, v, s) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  // 스타일: 1 노란 라벨, 2 값, 3 머리글, 4 내용 가운데, 5 내용 왼쪽
  const data = specRows(ctx);
  const rows = [
    `<row r="1">${cell('A1', '관련개발요청', 1)}${cell('B1', T(ctx.meta.title || ctx.result.project.title), 2)}${cell('C1', '', 2)}${cell('D1', '', 2)}${cell('E1', '작성자', 1)}${cell('F1', T(ctx.meta.author), 2)}${cell('G1', '작성일', 1)}${cell('H1', ctx.meta.date, 2)}</row>`,
    `<row r="3">${SPEC_COLS.map((c, i) => cell(colL(i) + 3, c.label, 3)).join('')}</row>`,
    ...data.map((row, k) => `<row r="${k + 4}">${row.map((v, i) => cell(colL(i) + (k + 4), v, SPEC_COLS[i].al === 'c' ? 4 : 5)).join('')}</row>`)
  ];
  const end = data.length + 3;
  const dv = SPEC_COLS.map((c, i) => (c.list ? `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${colL(i)}4:${colL(i)}${end + 200}"><formula1>"${c.list.join(',')}"</formula1></dataValidation>` : '')).filter(Boolean);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16.5"/><cols>${SPEC_COLS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A3:H${end}"/><mergeCells count="1"><mergeCell ref="B1:D1"/></mergeCells><dataValidations count="${dv.length}">${dv.join('')}</dataValidations><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>`;
  const font = b => `<font>${b ? '<b/>' : ''}<sz val="10"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>`;
  const side = k => `<${k} style="thin"><color rgb="FF808080"/></${k}>`;
  const xf = (f, fill, h, v = 'center') => `<xf numFmtId="0" fontId="${f}" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${h}" vertical="${v}" wrapText="1"/></xf>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2">${font(0)}${font(1)}</fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left', 'right', 'top', 'bottom'].map(side).join('')}<diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xf(1, 2, 'center')}${xf(0, 0, 'left')}${xf(1, 2, 'center')}${xf(0, 0, 'center')}${xf(0, 0, 'left', 'top')}</cellXfs><cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const SHEET = '요구사항명세(상세)';
  return [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${SHEET}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${SHEET}'!$A$3:$H$${end}</definedName></definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles]
  ];
}

async function buildSpecXlsx(ctx) {
  await loadScript(CDN.jszip);
  const zip = new window.JSZip();
  for (const [name, data] of specXlsxParts(ctx)) zip.file(name, data, { createFolders: false });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
