import { PAGES } from './charset.js';
import { PAGE_W, PAGE_H, renderPage, demoFill, UI_FONT } from './template.js';
import { loadGray, grayFromImageData, locateTemplate, sampleCell, warpPreview } from './scanner.js';
import { vectorizeCell } from './vectorize.js';
import { buildFont } from './fontbuilder.js';

const S = 192; // 칸 샘플링 해상도
const $ = (id) => document.getElementById(id);
const ALL_CELLS = PAGES.flatMap((p) => p.cells);
const DEMO_FONT = '"Nanum Pen Script", cursive';

/** 업로드 결과: { id, name, gray, loc, pageIndex, loops: Map } */
const results = [];
let uid = 0;
let fontUrl = null;
let previewFace = null;

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`500 28px ${UI_FONT}`, '가A'),
      document.fonts.load(`700 54px ${UI_FONT}`, '가A'),
      document.fonts.load(`40px ${DEMO_FONT}`, '가A'),
    ]);
  } catch { /* 글꼴이 없어도 계속 진행 */ }
}

function pageCanvas(page, demo = false) {
  const c = document.createElement('canvas');
  c.width = PAGE_W; c.height = PAGE_H;
  const ctx = c.getContext('2d');
  renderPage(ctx, page, PAGES.length);
  if (demo) demoFill(ctx, page, DEMO_FONT);
  return c;
}

const toBlob = (canvas, type = 'image/png', q) => new Promise((r) => canvas.toBlob(r, type, q));

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ───────────── 1. 템플릿 ─────────────
function pageDesc(page) {
  const kinds = {};
  page.cells.forEach((c) => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
  const names = { cho: '초성', jung: '중성', jong: '받침', jamo: '낱자', latin: '글자' };
  return Object.entries(kinds).map(([k, n]) => `${names[k]} ${n}`).join(' · ');
}

async function setupTemplates() {
  const list = $('templateList');
  for (const page of PAGES) {
    const card = document.createElement('div');
    card.className = 'page-card';
    const thumb = document.createElement('canvas');
    thumb.width = 340; thumb.height = Math.round((340 * PAGE_H) / PAGE_W);
    const full = pageCanvas(page);
    thumb.getContext('2d').drawImage(full, 0, 0, thumb.width, thumb.height);
    const btn = document.createElement('button');
    btn.className = 'btn ghost small';
    btn.textContent = 'PNG 다운로드';
    btn.onclick = async () => download(await toBlob(pageCanvas(page)), `handwriting-template-${page.index + 1}.png`);
    card.append(thumb);
    card.insertAdjacentHTML('beforeend', `<p class="t">${page.index + 1}. ${page.title}</p><p class="d">${pageDesc(page)}</p>`);
    card.append(btn);
    list.append(card);
    await tick();
  }
  $('downloadAll').onclick = async () => {
    for (const page of PAGES) {
      download(await toBlob(pageCanvas(page)), `handwriting-template-${page.index + 1}.png`);
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  $('printAll').onclick = async () => {
    const area = $('printArea');
    area.innerHTML = '';
    for (const page of PAGES) {
      const img = new Image();
      img.src = URL.createObjectURL(await toBlob(pageCanvas(page)));
      await img.decode();
      area.append(img);
    }
    window.print();
  };
}

// ───────────── 3. 업로드 & 인식 ─────────────
function setStatus(el, msg, err = false) {
  el.textContent = msg;
  el.classList.toggle('err', err);
}

async function handleFiles(files) {
  const status = $('uploadStatus');
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    setStatus(status, `${file.name} 불러오는 중…`);
    await tick();
    try {
      const gray = await loadGray(file);
      await addResult(file.name, gray);
      setStatus(status, '');
    } catch (e) {
      console.error(e);
      setStatus(status, `${file.name}: ${e.message}`, true);
    }
  }
}

async function addResult(name, gray) {
  const loc = locateTemplate(gray);
  const r = { id: ++uid, name, gray, loc, pageIndex: loc.pageIndex, loops: new Map() };
  results.push(r);
  const el = renderResultShell(r);
  if (r.pageIndex !== null) await extract(r, el);
  else el.querySelector('.meta-note').textContent = '페이지 번호를 인식하지 못했어요. 직접 선택해 주세요.';
  updateBuildState();
}

async function extract(r, el) {
  const page = PAGES[r.pageIndex];
  r.loops = new Map();
  const note = el.querySelector('.meta-note');
  const grid = el.querySelector('.glyphs');
  grid.innerHTML = '';
  for (let i = 0; i < page.cells.length; i++) {
    if (i % 6 === 0) { note.textContent = `글자 추출 중… ${i}/${page.cells.length}`; await tick(); }
    const cell = page.cells[i];
    const loops = vectorizeCell(sampleCell(r.gray, r.loc.H, i, S), S);
    if (loops) r.loops.set(cell.id, loops);
    grid.append(glyphThumb(cell, loops));
  }
  note.textContent = `${r.loops.size} / ${page.cells.length}칸 인식됨`;
  updateBuildState();
}

function glyphThumb(cell, loops) {
  const box = document.createElement('div');
  box.className = 'glyph' + (loops ? '' : ' empty');
  box.title = cell.label;
  if (loops) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.beginPath();
    for (const { points } of loops) {
      points.forEach(([u, v], k) => (k ? ctx.lineTo(u * 64, v * 64) : ctx.moveTo(u * 64, v * 64)));
      ctx.closePath();
    }
    ctx.fill('evenodd');
    box.append(c);
  }
  const lab = document.createElement('span');
  lab.textContent = cell.kind === 'latin' ? cell.char : cell.label.split(' ').pop();
  box.append(lab);
  return box;
}

function renderResultShell(r) {
  const el = document.createElement('div');
  el.className = 'result';
  const warp = document.createElement('canvas');
  warp.className = 'warp';
  const img = warpPreview(r.gray, r.loc.H, 360);
  warp.width = img.width; warp.height = img.height;
  warp.getContext('2d').putImageData(img, 0, 0);
  const right = document.createElement('div');
  right.innerHTML = `<h3></h3>
    <div class="meta">
      <label>페이지 <select></select></label>
      <span class="meta-note"></span>
      <button class="btn ghost small remove">삭제</button>
    </div>
    <div class="glyphs"></div>`;
  right.querySelector('h3').textContent = r.name;
  const sel = right.querySelector('select');
  if (r.pageIndex === null) sel.add(new Option('선택…', ''));
  PAGES.forEach((p) => sel.add(new Option(`${p.index + 1}. ${p.title}`, p.index)));
  sel.value = r.pageIndex ?? '';
  sel.onchange = async () => {
    if (sel.value === '') return;
    r.pageIndex = +sel.value;
    await extract(r, el);
  };
  right.querySelector('.remove').onclick = () => {
    results.splice(results.indexOf(r), 1);
    el.remove();
    updateBuildState();
  };
  el.append(warp, right);
  $('results').append(el);
  return el;
}

async function runDemo() {
  const btn = $('demoBtn');
  btn.disabled = true;
  const status = $('uploadStatus');
  try {
    for (const page of PAGES) {
      setStatus(status, `예시 ${page.index + 1}페이지 생성 중…`);
      await tick();
      // 실제 촬영처럼 약간 기울어진 사진을 흉내낸다
      const src = pageCanvas(page, true);
      const c = document.createElement('canvas');
      c.width = 1900; c.height = 2600;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#7d756c';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(((page.index % 2 ? -1 : 1) * 2.2 * Math.PI) / 180);
      const sc = 2350 / PAGE_H;
      ctx.drawImage(src, (-PAGE_W * sc) / 2, (-PAGE_H * sc) / 2, PAGE_W * sc, PAGE_H * sc);
      const gray = grayFromImageData(ctx.getImageData(0, 0, c.width, c.height));
      await addResult(`예시 손글씨 ${page.index + 1}페이지`, gray);
    }
    setStatus(status, '예시 템플릿을 인식했어요. 아래에서 폰트를 생성해 보세요.');
  } catch (e) {
    console.error(e);
    setStatus(status, e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function setupUpload() {
  const drop = $('drop'), input = $('fileInput');
  input.onchange = () => { handleFiles([...input.files]); input.value = ''; };
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));
  $('demoBtn').onclick = runDemo;
}

// ───────────── 4. 폰트 생성 ─────────────
function mergedLoops() {
  const m = new Map();
  for (const r of results) for (const [k, v] of r.loops) m.set(k, v);
  return m;
}

function updateBuildState() {
  const m = mergedLoops();
  $('buildBtn').disabled = m.size === 0;
  if (m.size) setStatus($('buildStatus'), `인식된 글자 ${m.size} / ${ALL_CELLS.length}칸`);
}

async function build() {
  const status = $('buildStatus');
  const name = $('fontName').value.trim() || '나의 손글씨';
  setStatus(status, '폰트를 만드는 중…');
  $('buildBtn').disabled = true;
  await tick();
  try {
    const { ttf, stats } = buildFont(mergedLoops(), ALL_CELLS, name);
    if (fontUrl) URL.revokeObjectURL(fontUrl);
    window.__lastTtf = ttf; // 테스트용
    const blob = new Blob([ttf], { type: 'font/ttf' });
    fontUrl = URL.createObjectURL(blob);
    const a = $('downloadTtf');
    a.href = fontUrl;
    a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.ttf`;
    a.classList.remove('hidden');

    if (previewFace) document.fonts.delete(previewFace);
    previewFace = new FontFace(`preview-${Date.now()}`, ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
    await previewFace.load();
    document.fonts.add(previewFace);
    $('previewText').style.fontFamily = `"${previewFace.family}", "Noto Sans KR", sans-serif`;
    $('previewBox').classList.remove('hidden');

    let msg = `완성! 한글 ${stats.hangul.toLocaleString()}자 · 영문/숫자/기호 ${stats.latin}자 · 낱자 ${stats.jamo}자 (${(stats.bytes / 1024).toFixed(0)}KB)`;
    if (stats.hangul === 0) msg += ' — 한글을 만들려면 1·2페이지를 모두 올려 주세요.';
    else if (stats.missingHangulParts.length) msg += ` — 빈 자모 ${stats.missingHangulParts.length}개가 들어간 음절은 제외되었습니다.`;
    setStatus(status, msg);
    window.__lastFont = ttf; // 테스트용
  } catch (e) {
    console.error(e);
    setStatus(status, `폰트 생성 실패: ${e.message}`, true);
  } finally {
    $('buildBtn').disabled = false;
  }
}

function setupBuild() {
  $('buildBtn').onclick = build;
  $('previewSize').oninput = (e) => { $('previewText').style.fontSize = `${e.target.value}px`; };
}

setupUpload();
setupBuild();
fontsReady().then(setupTemplates);
