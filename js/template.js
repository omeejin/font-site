// 템플릿 이미지의 기하 정보(좌표)와 렌더링.
// 모든 좌표는 A4 300dpi(2480×3508px) 기준 "템플릿 좌표"이다.
import { COLS, ROWS, ZONES, BASELINE, HANGUL_TOP, WITH_JONG_BOTTOM, CHO, JUNG, JONG } from './charset.js';

export const PAGE_W = 2480;
export const PAGE_H = 3508;

export const MARKER_SIZE = 100;
const MI = 150; // 마커 중심의 여백
export const MARKERS = [
  [MI, MI], // 좌상
  [PAGE_W - MI, MI], // 우상
  [PAGE_W - MI, PAGE_H - MI], // 우하
  [MI, PAGE_H - MI], // 좌하
];

// 페이지 식별 비트: [1,1,0, p3,p2,p1,p0, parity]
export const BIT_COUNT = 8;
export const BIT_SIZE = 48;
const BIT_GAP = 26;
const BIT_X0 = PAGE_W - MI - MARKER_SIZE / 2 - 60 - BIT_COUNT * (BIT_SIZE + BIT_GAP) + BIT_GAP;
export function bitRect(i) {
  return [BIT_X0 + i * (BIT_SIZE + BIT_GAP), MI - BIT_SIZE / 2, BIT_SIZE, BIT_SIZE];
}
export function encodePageBits(pageIndex) {
  const p = [3, 2, 1, 0].map((s) => (pageIndex >> s) & 1);
  const parity = p.reduce((a, b) => a ^ b, 0);
  return [1, 1, 0, ...p, parity];
}
export function decodePageBits(bits) {
  if (bits[0] !== 1 || bits[1] !== 1 || bits[2] !== 0) return null;
  const p = bits.slice(3, 7);
  const parity = p.reduce((a, b) => a ^ b, 0);
  if (parity !== bits[7]) return null;
  return p.reduce((a, b) => a * 2 + b, 0);
}

// 칸 배치
const COL_W = 258;
export const BOX = 234;
const LABEL_H = 46;
const ROW_H = LABEL_H + BOX + 22;
const GRID_X = (PAGE_W - COLS * COL_W) / 2;
const GRID_Y = 330;

/** i번째 칸의 쓰기 영역 [x, y, size] */
export function cellBox(i) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return [GRID_X + col * COL_W + (COL_W - BOX) / 2, GRID_Y + row * ROW_H + LABEL_H, BOX];
}

const C = {
  ink: '#111',
  label: '#333',
  sample: '#8a8a8a',
  border: '#c4c4c4',
  zone: '#dcecfb',
  zoneLine: '#b7cde2',
  guide: '#b5d3ee',
};

export const UI_FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function zoneRect(ctx, x, y, s, z) {
  return [x + z[0] * s, y + z[1] * s, (z[2] - z[0]) * s, (z[3] - z[1]) * s];
}

function fillZones(ctx, x, y, s, zones) {
  ctx.fillStyle = C.zone;
  for (const z of zones) ctx.fillRect(...zoneRect(ctx, x, y, s, z));
}

function dashZones(ctx, x, y, s, zones) {
  ctx.save();
  ctx.strokeStyle = C.zoneLine;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);
  for (const z of zones) ctx.strokeRect(...zoneRect(ctx, x, y, s, z));
  ctx.restore();
}

function hLine(ctx, x, y, s, v, dashed) {
  ctx.save();
  ctx.strokeStyle = C.guide;
  ctx.lineWidth = 2;
  if (dashed) ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(x + 4, y + v * s);
  ctx.lineTo(x + s - 4, y + v * s);
  ctx.stroke();
  ctx.restore();
}

/** 칸 안의 안내선(쓰기 영역 표시) */
export function targetZones(cell) {
  switch (cell.kind) {
    case 'cho': return ZONES[cell.cls].cho;
    case 'jung': return ZONES[cell.cls].jung;
    case 'jong': return ZONES.jong;
    case 'jamo': return [[0.18, 0.12, 0.82, 0.88]];
    default: return [];
  }
}

function drawCellGuides(ctx, cell, x, y, s) {
  switch (cell.kind) {
    case 'cho':
      fillZones(ctx, x, y, s, ZONES[cell.cls].cho);
      dashZones(ctx, x, y, s, ZONES[cell.cls].jung);
      break;
    case 'jung':
      fillZones(ctx, x, y, s, ZONES[cell.cls].jung);
      dashZones(ctx, x, y, s, ZONES[cell.cls].cho);
      break;
    case 'jong':
      fillZones(ctx, x, y, s, ZONES.jong);
      dashZones(ctx, x, y, s, [[0.08, HANGUL_TOP, 0.92, WITH_JONG_BOTTOM]]);
      break;
    case 'jamo':
      fillZones(ctx, x, y, s, targetZones(cell));
      break;
    default:
      // 영문/숫자/기호: 대문자선, x높이선, 기준선
      hLine(ctx, x, y, s, BASELINE - 0.6, true);
      hLine(ctx, x, y, s, BASELINE - 0.42, true);
      hLine(ctx, x, y, s, BASELINE, false);
  }
}

/**
 * 템플릿 한 장을 그린다.
 * @param {CanvasRenderingContext2D} ctx PAGE_W×PAGE_H 크기의 캔버스
 */
export function renderPage(ctx, page, pageCount) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  // 기준 마커
  ctx.fillStyle = C.ink;
  for (const [mx, my] of MARKERS) {
    ctx.fillRect(mx - MARKER_SIZE / 2, my - MARKER_SIZE / 2, MARKER_SIZE, MARKER_SIZE);
  }

  // 페이지 식별 비트
  encodePageBits(page.index).forEach((b, i) => {
    const [bx, by, bs] = bitRect(i);
    if (b) {
      ctx.fillStyle = C.ink;
      ctx.fillRect(bx, by, bs, bs);
    } else {
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, by + 1, bs - 2, bs - 2);
    }
  });

  // 제목
  ctx.fillStyle = C.ink;
  ctx.textBaseline = 'middle';
  ctx.font = `700 54px ${UI_FONT}`;
  ctx.fillText(`손글씨 폰트 템플릿 · ${page.title}`, MI + 90, MI - 8);
  ctx.font = `400 34px ${UI_FONT}`;
  ctx.fillStyle = '#555';
  ctx.fillText(`${page.index + 1} / ${pageCount} 페이지`, MI + 90, MI + 50);

  // 칸
  page.cells.forEach((cell, i) => {
    const [x, y, s] = cellBox(i);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.label;
    ctx.font = `500 28px ${UI_FONT}`;
    ctx.fillText(cell.label, x, y - 12);
    if (cell.sample) {
      ctx.fillStyle = C.sample;
      ctx.font = `400 24px ${UI_FONT}`;
      const w = ctx.measureText(cell.sample).width;
      ctx.fillText(cell.sample, x + s - w, y - 12);
    }
    drawCellGuides(ctx, cell, x, y, s);
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, s, s);
  });

  // 안내문
  ctx.fillStyle = '#555';
  ctx.font = `400 30px ${UI_FONT}`;
  ctx.textBaseline = 'middle';
  const notes = [
    '• 검은색/진한 펜으로 하늘색 영역 안에 글자를 크게 써 주세요. 점선은 함께 놓일 다른 자모의 자리입니다.',
    '• 영문·숫자·기호는 실선(기준선)에 글자를 맞추고, 대문자는 위쪽 점선까지 써 주세요.',
    '• 네 모서리의 검은 사각형이 모두 보이도록 스캔하거나 평평하게 촬영해 업로드하세요. 빈 칸은 건너뜁니다.',
  ];
  notes.forEach((t, i) => ctx.fillText(t, GRID_X + 12, GRID_Y + ROWS * ROW_H + 30 + i * 46));
  ctx.restore();
}

/**
 * 데모용: 지정한 글꼴로 템플릿 칸을 자동으로 채운다(실제 손글씨 대신).
 */
export function demoFill(ctx, page, fontFamily) {
  ctx.save();
  ctx.fillStyle = '#16245a';
  page.cells.forEach((cell, i) => {
    const [x, y, s] = cellBox(i);
    if (cell.kind === 'latin') {
      ctx.font = `200px ${fontFamily}`;
      const cap = ctx.measureText('H').actualBoundingBoxAscent || 140;
      ctx.font = `${Math.round((200 * 0.56 * s) / cap)}px ${fontFamily}`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      ctx.fillText(cell.char, x + s / 2, y + s * BASELINE);
      ctx.textAlign = 'left';
      return;
    }
    let ch;
    if (cell.kind === 'cho') ch = CHO[cell.cho];
    else if (cell.kind === 'jung') ch = JUNG[cell.jung];
    else if (cell.kind === 'jong') ch = JONG[cell.jong];
    else ch = cell.char;
    const zones = targetZones(cell);
    const u0 = Math.min(...zones.map((z) => z[0])), v0 = Math.min(...zones.map((z) => z[1]));
    const u1 = Math.max(...zones.map((z) => z[2])), v1 = Math.max(...zones.map((z) => z[3]));
    const pad = 0.03;
    const zx = x + (u0 + pad) * s, zy = y + (v0 + pad) * s;
    const zw = (u1 - u0 - 2 * pad) * s, zh = (v1 - v0 - 2 * pad) * s;
    ctx.font = `200px ${fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(ch);
    const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!(gw > 0 && gh > 0)) return;
    // 비율을 유지하되 긴 방향으로만 조금 늘려 영역을 채운다
    const fit = Math.min(zw / gw, zh / gh);
    const stretch = cell.kind === 'jamo' ? 1 : 1.5;
    const sx = Math.min(zw / gw, fit * (zw >= zh ? stretch : 1));
    const sy = Math.min(zh / gh, fit * (zh >= zw ? stretch : 1));
    ctx.save();
    ctx.translate(zx + (zw - gw * sx) / 2, zy + (zh - gh * sy) / 2);
    ctx.scale(sx, sy);
    ctx.fillText(ch, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
    ctx.restore();
  });
  ctx.restore();
}
