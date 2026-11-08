// 잉크 농도 배열 → 매끄러운 외곽선(폴리곤) 목록
import { components } from './scanner.js';

const KERNEL = [0.054, 0.244, 0.404, 0.244, 0.054];

function blur(src, S) {
  const tmp = new Float32Array(S * S), out = new Float32Array(S * S);
  const r = 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) {
      const xx = Math.min(S - 1, Math.max(0, x + k));
      s += src[y * S + xx] * KERNEL[k + r];
    }
    tmp[y * S + x] = s;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) {
      const yy = Math.min(S - 1, Math.max(0, y + k));
      s += tmp[yy * S + x] * KERNEL[k + r];
    }
    out[y * S + x] = s;
  }
  return out;
}

/**
 * 잡티 제거와 평활화.
 * @returns {Float32Array|null} 빈 칸이면 null
 */
export function cleanField(ink, S) {
  const f = blur(ink, S);
  const bin = new Uint8Array(S * S);
  for (let i = 0; i < f.length; i++) bin[i] = f[i] >= 0.5 ? 1 : 0;
  const { labels, comps } = components(bin, S, S);
  const minArea = Math.max(6, S * S * 0.00025);
  const remove = new Set(comps.filter((c) => c.area < minArea).map((c) => c.label));
  let total = 0;
  for (let i = 0; i < f.length; i++) {
    if (!bin[i]) continue;
    if (remove.has(labels[i])) f[i] = Math.min(f[i], 0.49);
    else total++;
  }
  if (total < S * S * 0.0015) return null;
  // 지워진 잡티 주변을 확실히 0.5 미만으로
  if (remove.size) for (let i = 0; i < f.length; i++) if (labels[i] && remove.has(labels[i])) f[i] = 0;
  return f;
}

/**
 * 마칭 스퀘어로 0.5 등고선을 추출한다.
 * @returns {Array<Array<[number,number]>>} 닫힌 폴리곤 목록 (픽셀 중심 좌표 + 0.5 = 칸 좌표)
 */
export function marchingSquares(field, S) {
  const W = S + 2; // 0으로 둘러싼 패딩
  const val = (x, y) => (x <= 0 || y <= 0 || x > S || y > S ? 0 : field[(y - 1) * S + (x - 1)]);
  const T = 0.5;
  const pts = new Map(); // edgeId → [x,y]
  const adj = new Map(); // edgeId → [edgeId, edgeId]
  const hId = (x, y) => (y * W + x) * 2;
  const vId = (x, y) => (y * W + x) * 2 + 1;
  const point = (id) => {
    let p = pts.get(id);
    if (p) return p;
    const cell = id >> 1, x = cell % W, y = (cell - x) / W;
    if (id & 1) { // 세로 변 (x,y)-(x,y+1)
      const a = val(x, y), b = val(x, y + 1);
      p = [x, y + (T - a) / (b - a)];
    } else { // 가로 변 (x,y)-(x+1,y)
      const a = val(x, y), b = val(x + 1, y);
      p = [x + (T - a) / (b - a), y];
    }
    pts.set(id, p);
    return p;
  };
  const link = (a, b) => {
    point(a); point(b);
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  };
  for (let y = 0; y < W - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = val(x, y), tr = val(x + 1, y), br = val(x + 1, y + 1), bl = val(x, y + 1);
      const c = (tl >= T ? 8 : 0) | (tr >= T ? 4 : 0) | (br >= T ? 2 : 0) | (bl >= T ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = hId(x, y), right = vId(x + 1, y), bottom = hId(x, y + 1), left = vId(x, y);
      const center = (tl + tr + br + bl) / 4 >= T;
      switch (c) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 5: // tr, bl 안쪽
          if (center) { link(left, top); link(bottom, right); } else { link(left, bottom); link(top, right); }
          break;
        case 10: // tl, br 안쪽
          if (center) { link(top, right); link(left, bottom); } else { link(left, top); link(bottom, right); }
          break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      const p = pts.get(cur);
      loop.push([p[0] - 1 + 0.5, p[1] - 1 + 0.5]); // 패딩 제거, 픽셀 중심 보정
      const nb = adj.get(cur);
      const nxt = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = nxt;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i], pts[a], pts[b]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function simplifyClosed(loop, eps) {
  // 가장 먼 두 점으로 나눠 각각 RDP
  let far = 0, fd = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = rdp(loop.slice(0, far + 1), eps);
  const b = rdp(loop.slice(far).concat([loop[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 칸의 잉크 배열 → 외곽선 목록. 좌표는 0~1(칸 기준), depth가 짝수면 바깥선, 홀수면 구멍.
 * @returns {Array<{points:Array<[number,number]>, depth:number}>|null}
 */
export function vectorizeCell(ink, S) {
  const field = cleanField(ink, S);
  if (!field) return null;
  const raw = marchingSquares(field, S);
  const loops = raw
    .map((l) => simplifyClosed(l, 0.9))
    .filter((l) => l.length >= 3 && Math.abs(signedArea(l)) > 3);
  if (!loops.length) return null;
  return loops.map((l, i) => {
    let depth = 0;
    for (let k = 0; k < loops.length; k++) if (k !== i && pointInPoly(l[0], loops[k])) depth++;
    return { points: l.map(([x, y]) => [x / S, y / S]), depth };
  });
}
