// 최소한의 TrueType(.ttf, glyf 아웃라인) 파일 작성기.

class Writer {
  constructor(size = 1024) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); this.pos = 0; }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.pos + n) s *= 2;
    const nb = new Uint8Array(s); nb.set(this.buf); this.buf = nb; this.view = new DataView(nb.buffer);
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; return this; }
  i8(v) { this.ensure(1); this.view.setInt8(this.pos, v); this.pos += 1; return this; }
  u16(v) { this.ensure(2); this.view.setUint16(this.pos, v); this.pos += 2; return this; }
  i16(v) { this.ensure(2); this.view.setInt16(this.pos, v); this.pos += 2; return this; }
  u32(v) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0); this.pos += 4; return this; }
  i32(v) { this.ensure(4); this.view.setInt32(this.pos, v); this.pos += 4; return this; }
  bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.pos); this.pos += arr.length; return this; }
  tag(s) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
  pad4() { while (this.pos % 4) this.u8(0); return this; }
  done() { return this.buf.slice(0, this.pos); }
}

const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
const f2dot14 = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 16384)));

function checksum(bytes) {
  const n = Math.ceil(bytes.length / 4) * 4;
  let sum = 0;
  for (let i = 0; i < n; i += 4) {
    const v = ((bytes[i] || 0) << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum;
}

function bboxOfContours(contours) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

function encodeSimple(contours, bbox) {
  const w = new Writer(256);
  w.i16(contours.length).i16(bbox[0]).i16(bbox[1]).i16(bbox[2]).i16(bbox[3]);
  let n = 0;
  for (const c of contours) { n += c.length; w.u16(n - 1); }
  w.u16(0); // instructions
  const flags = [], xs = new Writer(), ys = new Writer();
  let px = 0, py = 0;
  for (const c of contours) for (const p of c) {
    let f = p.on ? 1 : 0;
    const dx = p.x - px, dy = p.y - py;
    px = p.x; py = p.y;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) < 256) { f |= 0x02; if (dx > 0) f |= 0x10; xs.u8(Math.abs(dx)); }
    else xs.i16(dx);
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) < 256) { f |= 0x04; if (dy > 0) f |= 0x20; ys.u8(Math.abs(dy)); }
    else ys.i16(dy);
    flags.push(f);
  }
  for (const f of flags) w.u8(f);
  w.bytes(xs.done()).bytes(ys.done());
  w.pad4();
  return w.done();
}

function encodeComposite(components, bbox) {
  const w = new Writer(64);
  w.i16(-1).i16(bbox[0]).i16(bbox[1]).i16(bbox[2]).i16(bbox[3]);
  components.forEach((c, i) => {
    const scaled = c.sy !== undefined && c.sy !== 1;
    let flags = 0x0001 | 0x0002 | 0x1000; // 워드 인자, XY 오프셋, 오프셋 비스케일
    if (i < components.length - 1) flags |= 0x0020;
    if (scaled) flags |= 0x0040;
    w.u16(flags).u16(c.glyph).i16(clamp16(c.dx || 0)).i16(clamp16(c.dy || 0));
    if (scaled) w.i16(f2dot14(1)).i16(f2dot14(c.sy));
  });
  w.pad4();
  return w.done();
}

function utf16be(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out.push(c >> 8, c & 0xff); }
  return out;
}

function buildName(names) {
  const records = Object.entries(names)
    .map(([id, s]) => ({ id: +id, data: utf16be(s) }))
    .sort((a, b) => a.id - b.id);
  const w = new Writer();
  w.u16(0).u16(records.length).u16(6 + records.length * 12);
  let off = 0;
  for (const r of records) {
    w.u16(3).u16(1).u16(0x0409).u16(r.id).u16(r.data.length).u16(off);
    off += r.data.length;
  }
  for (const r of records) w.bytes(r.data);
  return w.done();
}

function buildCmap4(map) {
  const codes = [...map.keys()].filter((c) => c <= 0xfffe).sort((a, b) => a - b);
  const segs = [];
  for (const c of codes) {
    const g = map.get(c);
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1) { last.end = c; last.glyphs.push(g); }
    else segs.push({ start: c, end: c, glyphs: [g] });
  }
  segs.push({ start: 0xffff, end: 0xffff, glyphs: [0], terminal: true });
  const segX2 = segs.length * 2;
  let pow = 1, entrySelector = 0;
  while (pow * 2 <= segs.length) { pow *= 2; entrySelector++; }
  const searchRange = pow * 2;
  const glyphArray = [];
  const idDelta = [], idRangeOffset = [];
  segs.forEach((s, i) => {
    if (s.terminal) { idDelta.push(1); idRangeOffset.push(0); return; }
    const consecutive = s.glyphs.every((g, k) => g === s.glyphs[0] + k);
    if (consecutive) { idDelta.push((s.glyphs[0] - s.start) & 0xffff); idRangeOffset.push(0); }
    else {
      idDelta.push(0);
      idRangeOffset.push((segs.length - i + glyphArray.length) * 2);
      glyphArray.push(...s.glyphs);
    }
  });
  const w = new Writer();
  const length = 16 + segX2 * 4 + glyphArray.length * 2;
  if (length > 0xffff) throw new Error('cmap이 너무 큽니다');
  w.u16(4).u16(length).u16(0).u16(segX2).u16(searchRange).u16(entrySelector).u16(segX2 - searchRange);
  segs.forEach((s) => w.u16(s.end));
  w.u16(0);
  segs.forEach((s) => w.u16(s.start));
  idDelta.forEach((d) => w.u16(d));
  idRangeOffset.forEach((d) => w.u16(d));
  glyphArray.forEach((g) => w.u16(g));
  const sub = w.done();
  const t = new Writer();
  t.u16(0).u16(2);
  t.u16(0).u16(3).u32(20);
  t.u16(3).u16(1).u32(20);
  t.bytes(sub);
  return t.done();
}

function longDateTime(w, date) {
  const secs = Math.floor(date.getTime() / 1000) + 2082844800;
  w.u32(Math.floor(secs / 4294967296)).u32(secs % 4294967296);
}

/**
 * @param {object} font
 * @param {string} font.familyName
 * @param {Array} font.glyphs  { advance, contours?: [[{x,y,on}]], components?: [{glyph,dx,dy,sy}] }
 * @param {Map<number,number>} font.cmap 코드포인트 → 글리프 번호
 * @returns {Uint8Array}
 */
export function buildTTF({ familyName, glyphs, cmap, ascender = 800, descender = -200, lineGap = 200, xHeight = 420, capHeight = 600 }) {
  const numGlyphs = glyphs.length;
  // 글리프별 bbox 계산 (합성 글리프는 구성요소 bbox를 변환)
  const bboxes = new Array(numGlyphs).fill(null);
  const stats = new Array(numGlyphs).fill(null);
  glyphs.forEach((g, i) => {
    if (g.contours && g.contours.length) {
      bboxes[i] = bboxOfContours(g.contours);
      stats[i] = { points: g.contours.reduce((a, c) => a + c.length, 0), contours: g.contours.length };
    }
  });
  glyphs.forEach((g, i) => {
    if (!g.components) return;
    let bb = null, points = 0, contours = 0;
    for (const c of g.components) {
      const cb = bboxes[c.glyph];
      if (!cb) continue;
      const sy = c.sy ?? 1;
      const t = [cb[0] + (c.dx || 0), cb[1] * sy + (c.dy || 0), cb[2] + (c.dx || 0), cb[3] * sy + (c.dy || 0)];
      bb = bb ? [Math.min(bb[0], t[0]), Math.min(bb[1], t[1]), Math.max(bb[2], t[2]), Math.max(bb[3], t[3])] : t;
      points += stats[c.glyph].points; contours += stats[c.glyph].contours;
    }
    if (bb) { bboxes[i] = bb.map((v, k) => (k < 2 ? Math.floor(v) : Math.ceil(v))); stats[i] = { points, contours, components: g.components.length }; }
  });

  // glyf / loca
  const glyf = new Writer(1 << 16);
  const loca = [];
  glyphs.forEach((g, i) => {
    loca.push(glyf.pos);
    if (!bboxes[i]) return;
    if (g.components) glyf.bytes(encodeComposite(g.components.filter((c) => bboxes[c.glyph]), bboxes[i]));
    else glyf.bytes(encodeSimple(g.contours, bboxes[i]));
  });
  loca.push(glyf.pos);
  const locaW = new Writer();
  loca.forEach((o) => locaW.u32(o));

  let gx0 = 0, gy0 = 0, gx1 = 0, gy1 = 0, first = true;
  let maxPoints = 0, maxContours = 0, maxCPoints = 0, maxCContours = 0, maxComp = 0;
  let minLsb = 32767, minRsb = 32767, maxExtent = 0, maxAdv = 0, advSum = 0, advN = 0;
  glyphs.forEach((g, i) => {
    maxAdv = Math.max(maxAdv, g.advance);
    if (g.advance > 0) { advSum += g.advance; advN++; }
    const bb = bboxes[i];
    if (!bb) return;
    if (first) { [gx0, gy0, gx1, gy1] = bb; first = false; }
    else { gx0 = Math.min(gx0, bb[0]); gy0 = Math.min(gy0, bb[1]); gx1 = Math.max(gx1, bb[2]); gy1 = Math.max(gy1, bb[3]); }
    minLsb = Math.min(minLsb, bb[0]);
    minRsb = Math.min(minRsb, g.advance - bb[2]);
    maxExtent = Math.max(maxExtent, bb[2]);
    const s = stats[i];
    if (s.components) { maxCPoints = Math.max(maxCPoints, s.points); maxCContours = Math.max(maxCContours, s.contours); maxComp = Math.max(maxComp, s.components); }
    else { maxPoints = Math.max(maxPoints, s.points); maxContours = Math.max(maxContours, s.contours); }
  });
  if (minLsb === 32767) minLsb = minRsb = 0;

  const head = new Writer();
  const now = new Date();
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x0009).u16(1000);
  longDateTime(head, now); longDateTime(head, now);
  head.i16(gx0).i16(gy0).i16(gx1).i16(gy1).u16(0).u16(8).i16(2).i16(1).i16(0);

  const hhea = new Writer();
  hhea.u32(0x00010000).i16(ascender).i16(descender).i16(lineGap).u16(maxAdv).i16(minLsb).i16(minRsb).i16(maxExtent)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(numGlyphs);

  const hmtx = new Writer();
  glyphs.forEach((g, i) => hmtx.u16(Math.max(0, Math.round(g.advance))).i16(bboxes[i] ? bboxes[i][0] : 0));

  const maxp = new Writer();
  maxp.u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours).u16(maxCPoints).u16(maxCContours)
    .u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(maxComp).u16(maxComp ? 1 : 0);

  const codes = [...cmap.keys()].sort((a, b) => a - b);
  const has = (lo, hi) => codes.some((c) => c >= lo && c <= hi);
  let ur1 = 0, ur2 = 0;
  if (has(0x20, 0x7e)) ur1 |= 1 << 0;
  if (has(0x80, 0xff)) ur1 |= 1 << 1;
  if (has(0x2000, 0x206f)) ur1 |= 1 << 31;
  if (has(0x2190, 0x21ff)) ur2 |= 1 << (37 - 32);
  if (has(0x25a0, 0x25ff)) ur2 |= 1 << (45 - 32);
  if (has(0x2600, 0x26ff)) ur2 |= 1 << (46 - 32);
  if (has(0x3130, 0x318f)) ur2 |= 1 << (52 - 32);
  if (has(0xac00, 0xd7af)) ur2 |= 1 << (56 - 32);
  const winAscent = Math.max(gy1, ascender + 100), winDescent = Math.max(-gy0, -descender + 50);
  const os2 = new Writer();
  os2.u16(4).i16(Math.round(advN ? advSum / advN : 500)).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(300).i16(0)
    .bytes(new Uint8Array(10))
    .u32(ur1).u32(ur2).u32(0).u32(0)
    .tag('HWFS').u16(0x00c0)
    .u16(Math.min(0xffff, codes[0] ?? 0x20)).u16(Math.min(0xffff, codes[codes.length - 1] ?? 0x20))
    .i16(ascender).i16(descender).i16(lineGap).u16(winAscent).u16(winDescent)
    .u32((1 << 0) | (has(0xac00, 0xd7af) ? 1 << 19 : 0)).u32(0)
    .i16(xHeight).i16(capHeight).u16(0).u16(32).u16(2);

  const post = new Writer();
  post.u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0);

  const psName = (familyName.replace(/[^A-Za-z0-9-]/g, '') || 'HandwritingFont').slice(0, 60) + '-Regular';
  const name = buildName({
    1: familyName, 2: 'Regular', 3: `${psName};${now.toISOString().slice(0, 10)}`,
    4: familyName, 5: 'Version 1.000', 6: psName,
  });

  const tables = {
    'OS/2': os2.done(), cmap: buildCmap4(cmap), glyf: glyf.done(), head: head.done(), hhea: hhea.done(),
    hmtx: hmtx.done(), loca: locaW.done(), maxp: maxp.done(), name, post: post.done(),
  };
  const tags = Object.keys(tables).sort();
  const out = new Writer(glyf.pos + 65536);
  const n = tags.length;
  let sr = 1, es = 0;
  while (sr * 2 <= n) { sr *= 2; es++; }
  out.u32(0x00010000).u16(n).u16(sr * 16).u16(es).u16(n * 16 - sr * 16);
  let offset = 12 + n * 16;
  const offsets = {};
  for (const t of tags) {
    offsets[t] = offset;
    out.tag(t).u32(checksum(tables[t])).u32(offset).u32(tables[t].length);
    offset += Math.ceil(tables[t].length / 4) * 4;
  }
  for (const t of tags) { out.bytes(tables[t]); out.pad4(); }
  const bytes = out.done();
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(offsets.head + 8, adj);
  return bytes;
}
