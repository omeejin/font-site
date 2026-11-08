// 업로드된 템플릿 이미지에서 마커를 찾아 원근을 보정하고, 각 칸의 글자 이미지를 추출한다.
import { PAGE_W, PAGE_H, MARKERS, MARKER_SIZE, BIT_COUNT, bitRect, decodePageBits, cellBox, BOX } from './template.js';

const MAX_SIDE = 3600;

/** File/Blob → 그레이스케일 { width, height, data:Uint8ClampedArray } */
export async function loadGray(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return grayFromImageData(ctx.getImageData(0, 0, w, h));
}

export function grayFromImageData(img) {
  const { width, height, data } = img;
  const g = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return { width, height, data: g };
}

function downscale(gray, maxSide) {
  const f = Math.max(1, Math.ceil(Math.max(gray.width, gray.height) / maxSide));
  const w = Math.floor(gray.width / f), h = Math.floor(gray.height / f);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * gray.width + x * f;
        for (let dx = 0; dx < f; dx++) s += gray.data[row + dx];
      }
      out[y * w + x] = s / (f * f);
    }
  }
  return { width: w, height: h, data: out, factor: f };
}

function otsu(data) {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/** 이진 영상의 연결 요소(8-연결) */
export function components(bin, w, h) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || labels[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let area = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (bin[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; }
        }
      }
    }
    comps.push({ label: next, area, cx: sx / area, cy: sy / area, x0, y0, x1, y1 });
    next++;
  }
  return { labels, comps };
}

function quadArea(p) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function orderCorners(pts) {
  // 좌상, 우상, 우하, 좌하
  const bySum = [...pts].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const byDiff = [...pts].sort((a, b) => a[0] - a[1] - (b[0] - b[1]));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]];
}

/** 네 모서리 마커를 찾아 이미지 좌표로 반환 (좌상, 우상, 우하, 좌하) */
export function findMarkers(gray) {
  const small = downscale(gray, 1100);
  const { width: w, height: h, data } = small;
  const thr = Math.min(otsu(data), 140);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = data[i] < thr ? 1 : 0;

  // 적분 영상(링 검사용)
  const integ = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += bin[y * w + x];
      integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row;
    }
  }
  const rectSum = (x0, y0, x1, y1) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
    if (x1 <= x0 || y1 <= y0) return [0, 0];
    const s = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
    return [s, (x1 - x0) * (y1 - y0)];
  };

  const { comps } = components(bin, w, h);
  const minArea = (Math.min(w, h) * 0.012) ** 2;
  const cands = comps.filter((c) => {
    if (c.area < minArea) return false;
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const aspect = bw / bh;
    if (aspect < 0.5 || aspect > 2) return false;
    if (c.area / (bw * bh) < 0.6) return false;
    // 주변(링)이 대부분 흰색이어야 한다
    const mx = Math.round(bw * 0.4), my = Math.round(bh * 0.4);
    const [outer, outerN] = rectSum(c.x0 - mx, c.y0 - my, c.x1 + 1 + mx, c.y1 + 1 + my);
    const [inner, innerN] = rectSum(c.x0, c.y0, c.x1 + 1, c.y1 + 1);
    const ringN = outerN - innerN;
    return ringN > 0 && (outer - inner) / ringN < 0.2;
  }).sort((a, b) => b.area - a.area).slice(0, 12);

  if (cands.length < 4) throw new Error('모서리의 검은 사각형 마커 4개를 찾지 못했습니다. 네 모서리가 모두 보이게 다시 촬영해 주세요.');

  let best = null, bestScore = -1;
  const n = cands.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const set = [cands[a], cands[b], cands[c], cands[d]];
    const areas = set.map((s) => s.area);
    const ratio = Math.min(...areas) / Math.max(...areas);
    if (ratio < 0.35) continue;
    const pts = orderCorners(set.map((s) => [s.cx, s.cy]));
    const score = quadArea(pts) * ratio;
    if (score > bestScore) { bestScore = score; best = pts; }
  }
  if (!best || quadArea(best) < w * h * 0.15) {
    throw new Error('템플릿 마커를 인식하지 못했습니다. 종이 전체가 화면에 크게 나오도록 촬영해 주세요.');
  }
  const f = small.factor;
  return best.map(([x, y]) => [(x + 0.5) * f - 0.5, (y + 0.5) * f - 0.5]);
}

/** 4점 대응으로 호모그래피 계산: src(템플릿) → dst(이미지) */
export function homography(src, dst) {
  const A = [], bvec = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bvec.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bvec.push(v);
  }
  const h = solve(A, bvec);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('마커 배치가 올바르지 않습니다.');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function project(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

function sampler(gray) {
  const { width: w, height: h, data } = gray;
  return (x, y) => {
    if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
    if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const i = y0 * w + x0;
    const a = data[i], b = data[i + 1], c = data[i + w], d = data[i + w + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

function meanInRect(H, sample, x, y, s, inset = 0.25) {
  let sum = 0, n = 0;
  const steps = 6;
  for (let j = 0; j < steps; j++) for (let i = 0; i < steps; i++) {
    const px = x + s * (inset + (1 - 2 * inset) * (i + 0.5) / steps);
    const py = y + s * (inset + (1 - 2 * inset) * (j + 0.5) / steps);
    sum += sample(...project(H, px, py)); n++;
  }
  return sum / n;
}

function readPageBits(H, sample) {
  const black = MARKERS.reduce((a, [mx, my]) => a + meanInRect(H, sample, mx - MARKER_SIZE / 2, my - MARKER_SIZE / 2, MARKER_SIZE), 0) / 4;
  // 마커 바로 아래쪽 빈 여백을 흰색 기준으로
  const white = MARKERS.reduce((a, [mx, my]) => {
    const oy = my < PAGE_H / 2 ? MARKER_SIZE : -2 * MARKER_SIZE;
    return a + meanInRect(H, sample, mx - MARKER_SIZE / 2, my + oy, MARKER_SIZE);
  }, 0) / 4;
  const thr = (black + white) / 2;
  const bits = [];
  for (let i = 0; i < BIT_COUNT; i++) {
    const [x, y, s] = bitRect(i);
    bits.push(meanInRect(H, sample, x, y, s) < thr ? 1 : 0);
  }
  return { bits, contrast: white - black };
}

/**
 * 이미지에서 템플릿 위치를 찾는다.
 * @returns {{ H:number[], pageIndex:number|null, corners:number[][] }}
 */
export function locateTemplate(gray) {
  const corners = findMarkers(gray);
  const sample = sampler(gray);
  let fallback = null;
  for (let rot = 0; rot < 4; rot++) {
    const dst = [0, 1, 2, 3].map((i) => corners[(i + rot) % 4]);
    const H = homography(MARKERS, dst);
    const { bits, contrast } = readPageBits(H, sample);
    const pageIndex = decodePageBits(bits);
    if (rot === 0) fallback = { H, pageIndex: null, corners: dst, contrast };
    if (pageIndex !== null) return { H, pageIndex, corners: dst, contrast };
  }
  return fallback;
}

/**
 * 칸 하나를 S×S 해상도로 샘플링해 잉크 농도(0~1) 배열을 만든다.
 */
export function sampleCell(gray, H, cellIndex, S) {
  const sample = sampler(gray);
  const [x, y, s] = cellBox(cellIndex);
  const lum = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const [px, py] = project(H, x + ((i + 0.5) / S) * s, y + ((j + 0.5) / S) * s);
      lum[j * S + i] = sample(px, py);
    }
  }
  // 칸마다 종이 밝기를 추정(상위 퍼센타일)해 조명 차이를 보정
  const sorted = Float32Array.from(lum).sort();
  const bg = Math.max(40, sorted[Math.floor(sorted.length * 0.9)]);
  const ink = new Float32Array(S * S);
  const hi = 0.66 * bg, span = 0.2 * bg;
  const margin = Math.round(S * 0.025);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      if (i < margin || j < margin || i >= S - margin || j >= S - margin) continue;
      const v = (hi - lum[j * S + i]) / span;
      ink[j * S + i] = v <= 0 ? 0 : v >= 1 ? 1 : v;
    }
  }
  return ink;
}

/** 보정된 페이지 미리보기 이미지(ImageData) */
export function warpPreview(gray, H, width) {
  const height = Math.round((width * PAGE_H) / PAGE_W);
  const sample = sampler(gray);
  const img = new ImageData(width, height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const v = sample(...project(H, ((i + 0.5) / width) * PAGE_W, ((j + 0.5) / height) * PAGE_H));
      const k = (j * width + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  return img;
}

export { BOX };
