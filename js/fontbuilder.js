// 추출한 글자 외곽선 → 글리프 구성 → TTF
import { CHO, JUNG, JONG, JUNG_CLASS, BASELINE, HANGUL_TOP, JONG_SQUEEZE } from './charset.js';
import { buildTTF } from './ttf.js';

const EM = 1000;
const SIDE = 45; // 영문 좌우 여백
const CORNER_DEG = 55;

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 칸 좌표 외곽선 → 폰트 단위 TrueType 윤곽 */
export function toFontContours(loops) {
  const out = [];
  for (const { points, depth } of loops) {
    let pts = [];
    for (const [u, v] of points) {
      const p = { x: Math.round(u * EM), y: Math.round((BASELINE - v) * EM) };
      const last = pts[pts.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
    }
    while (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
    if (pts.length < 3) continue;
    const area = polyArea(pts);
    if (Math.abs(area) < 40) continue;
    // TrueType: 바깥선 시계방향(면적 음수), 구멍 반시계방향
    const outer = depth % 2 === 0;
    if ((outer && area > 0) || (!outer && area < 0)) pts.reverse();
    const n = pts.length;
    out.push(pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const v1x = p.x - a.x, v1y = p.y - a.y, v2x = b.x - p.x, v2y = b.y - p.y;
      const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
      const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      return { x: p.x, y: p.y, on: turn > CORNER_DEG };
    }));
  }
  return out;
}

function bbox(contours) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const p of c) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

function shiftContours(contours, dx) {
  return contours.map((c) => c.map((p) => ({ ...p, x: p.x + dx })));
}

function notdef() {
  const box = (x0, y0, x1, y1, cw) => {
    const pts = [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }];
    return (cw ? pts : pts.reverse()).map((p) => ({ ...p, on: true }));
  };
  return { advance: 600, contours: [box(80, 0, 520, 700, true), box(130, 50, 470, 650, false)] };
}

/**
 * @param {Map<string, Array>} cellLoops  칸 id → vectorizeCell() 결과
 * @param {Array} cells 칸 정의 목록(charset.js)
 * @param {string} familyName
 * @returns {{ ttf: Uint8Array, stats: object }}
 */
export function buildFont(cellLoops, cells, familyName) {
  const glyphs = [notdef(), { advance: 300 }];
  const cmap = new Map([[0x20, 1], [0xa0, 1]]);
  const stats = { latin: 0, hangul: 0, jamo: 0, missingHangulParts: [] };

  const contoursOf = (id) => {
    const loops = cellLoops.get(id);
    if (!loops) return null;
    const c = toFontContours(loops);
    return c.length ? c : null;
  };

  // 1) 영문/숫자/기호 · 낱자 자음 (비례폭)
  for (const cell of cells) {
    if (cell.kind !== 'latin' && cell.kind !== 'jamo') continue;
    const contours = contoursOf(cell.id);
    if (!contours) continue;
    const [x0, , x1] = bbox(contours);
    const side = cell.kind === 'jamo' ? 80 : SIDE;
    glyphs.push({ advance: x1 - x0 + side * 2, contours: shiftContours(contours, side - x0) });
    cmap.set(cell.char.codePointAt(0), glyphs.length - 1);
    if (cell.kind === 'jamo') stats.jamo++; else stats.latin++;
  }

  // 2) 한글 자모 구성요소 (cmap 없음)
  const comp = new Map(); // id → glyph index
  const compBox = new Map();
  for (const cell of cells) {
    if (!['cho', 'jung', 'jong'].includes(cell.kind)) continue;
    const contours = contoursOf(cell.id);
    if (!contours) continue;
    glyphs.push({ advance: EM, contours });
    comp.set(cell.id, glyphs.length - 1);
    compBox.set(cell.id, bbox(contours));
  }
  const choGlyph = (l, cls) => {
    for (const c of [cls, cls === 'm' ? 'h' : 'm', 'v', 'h']) {
      const g = comp.get(`cho${l}_${c}`);
      if (g !== undefined) return g;
    }
    return undefined;
  };

  // 3) 호환용 모음 낱자 (ㅏ, ㅜ, ㅠ ...): 중성 글리프를 가운데로 옮겨 사용
  JUNG.forEach((_, i) => {
    const id = `jung${i}`;
    const g = comp.get(id);
    if (g === undefined) return;
    const [x0, y0, x1, y1] = compBox.get(id);
    const dy = Math.round((BASELINE - 0.5) * EM - (y0 + y1) / 2);
    glyphs.push({ advance: x1 - x0 + 160, components: [{ glyph: g, dx: 80 - x0, dy }] });
    cmap.set(0x314f + i, glyphs.length - 1);
    stats.jamo++;
  });

  // 4) 한글 음절 11,172자 (합성 글리프)
  const s = JONG_SQUEEZE;
  const topY = (BASELINE - HANGUL_TOP) * EM;
  const squeezeDy = Math.round(topY * (1 - s));
  for (let l = 0; l < CHO.length; l++) {
    for (let v = 0; v < JUNG.length; v++) {
      const cg = choGlyph(l, JUNG_CLASS[v]);
      const vg = comp.get(`jung${v}`);
      if (cg === undefined || vg === undefined) continue;
      for (let t = 0; t < JONG.length; t++) {
        const code = 0xac00 + (l * 21 + v) * 28 + t;
        let components;
        if (t === 0) components = [{ glyph: cg }, { glyph: vg }];
        else {
          const tg = comp.get(`jong${t}`);
          if (tg === undefined) continue;
          components = [{ glyph: cg, dy: squeezeDy, sy: s }, { glyph: vg, dy: squeezeDy, sy: s }, { glyph: tg }];
        }
        glyphs.push({ advance: EM, components });
        cmap.set(code, glyphs.length - 1);
        stats.hangul++;
      }
    }
  }

  for (const cell of cells) {
    if (['cho', 'jung', 'jong'].includes(cell.kind) && !comp.has(cell.id)) stats.missingHangulParts.push(cell.label);
  }
  const ttf = buildTTF({ familyName, glyphs, cmap });
  stats.glyphs = glyphs.length;
  stats.bytes = ttf.length;
  return { ttf, stats };
}
