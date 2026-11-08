// 템플릿에 들어갈 글자(칸) 정의와 한글 자모 테이블.
//
// 한글은 11,172자를 모두 손으로 쓰는 대신, 자모를 "음절 안에서 차지할 위치"에
// 직접 써 두고 이를 겹쳐(합성) 모든 음절을 만든다.
//  - 초성: 모음 형태(세로형 ㅏ / 가로형 ㅗ / 섞임형 ㅘ)별로 3가지
//  - 중성: 받침 없는 위치에 1번 (받침이 있으면 세로로 압축해 사용)
//  - 종성: 받침 위치에 1번

export const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
export const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
export const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 모음 형태: v = 세로형(ㅏ류), h = 가로형(ㅗ류), m = 섞임형(ㅘ류)
export const JUNG_CLASS = JUNG.map((j) => {
  if ('ㅗㅛㅜㅠㅡ'.includes(j)) return 'h';
  if ('ㅘㅙㅚㅝㅞㅟㅢ'.includes(j)) return 'm';
  return 'v';
});

export const VOWEL_CLASSES = ['v', 'h', 'm'];
const CLASS_SAMPLE_VOWEL = { v: 0 /*ㅏ*/, h: 8 /*ㅗ*/, m: 9 /*ㅘ*/ };
const CLASS_NAME = { v: 'ㅏ형', h: 'ㅗ형', m: 'ㅘ형' };

export function composeSyllable(l, v, t = 0) {
  return String.fromCharCode(0xac00 + (l * 21 + v) * 28 + t);
}

// 칸 안의 좌표계: u(가로), v(세로) 모두 0~1, 위가 0.
// 폰트 좌표로는 u*1000, (BASELINE - v)*1000 으로 변환된다.
export const BASELINE = 0.8;

// 한글 자모를 쓸 영역(칸 기준). 각 영역은 [u0, v0, u1, v1].
export const HANGUL_TOP = 0.08;
export const HANGUL_BOTTOM = 0.92;
export const JONG_TOP = 0.64; // 받침 영역 시작
export const WITH_JONG_BOTTOM = 0.6; // 받침이 있을 때 초성/중성이 차지할 하단

export const ZONES = {
  v: { cho: [[0.08, 0.14, 0.56, 0.86]], jung: [[0.56, 0.08, 0.92, 0.92]] },
  h: { cho: [[0.2, 0.08, 0.8, 0.5]], jung: [[0.08, 0.5, 0.92, 0.92]] },
  m: { cho: [[0.08, 0.08, 0.6, 0.46]], jung: [[0.08, 0.46, 0.7, 0.8], [0.7, 0.08, 0.92, 0.92]] },
  jong: [[0.2, JONG_TOP, 0.8, 0.92]],
};

// 받침이 있을 때 초성·중성에 적용할 세로 압축 비율 (윗선 고정)
export const JONG_SQUEEZE = (WITH_JONG_BOTTOM - HANGUL_TOP) / (HANGUL_BOTTOM - HANGUL_TOP);

const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
export const EXTRA_SYMBOLS = ['·', '“', '”', '‘', '’', '…', '※', '♥', '★', '☆', '○', '×', '→', '←', '↑', '↓', '♪', '~', '₩', '°'];

/**
 * 칸 하나의 정의.
 * kind: 'cho' | 'jung' | 'jong' | 'jamo' | 'latin'
 * id:   글리프 고유 이름
 * label: 칸 위에 인쇄되는 안내 문구
 * sample: 칸 위에 함께 인쇄되는 예시 글자
 */
function buildHangulCells() {
  const cells = [];
  for (const cls of VOWEL_CLASSES) {
    CHO.forEach((c, i) => {
      cells.push({
        kind: 'cho', id: `cho${i}_${cls}`, cho: i, cls,
        label: `초성 ${c}`, sample: `${CLASS_NAME[cls]} ${composeSyllable(i, CLASS_SAMPLE_VOWEL[cls])}`,
      });
    });
  }
  JUNG.forEach((j, i) => {
    cells.push({
      kind: 'jung', id: `jung${i}`, jung: i, cls: JUNG_CLASS[i],
      label: `중성 ${j}`, sample: composeSyllable(11, i),
    });
  });
  JONG.forEach((j, i) => {
    if (i === 0) return;
    cells.push({ kind: 'jong', id: `jong${i}`, jong: i, label: `받침 ${j}`, sample: composeSyllable(0, 0, i) });
  });
  CHO.forEach((c, i) => {
    cells.push({ kind: 'jamo', id: `jamo_${c}`, char: c, label: `낱자 ${c}`, sample: `${c}${c}` });
  });
  return cells;
}

function latinCell(ch) {
  return { kind: 'latin', id: `u${ch.codePointAt(0).toString(16).padStart(4, '0')}`, char: ch, label: ch === ' ' ? 'space' : ch, sample: '' };
}

export const COLS = 8;
export const ROWS = 9;
export const CELLS_PER_PAGE = COLS * ROWS;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function buildPages() {
  const hangul = chunk(buildHangulCells(), CELLS_PER_PAGE).map((cells) => ({ title: '한글', cells }));
  const alnum = [];
  for (let c = 48; c <= 57; c++) alnum.push(latinCell(String.fromCharCode(c)));
  for (let c = 65; c <= 90; c++) alnum.push(latinCell(String.fromCharCode(c)));
  for (let c = 97; c <= 122; c++) alnum.push(latinCell(String.fromCharCode(c)));
  const symbols = [...ASCII_PUNCT].map(latinCell).concat(EXTRA_SYMBOLS.filter((s) => !ASCII_PUNCT.includes(s)).map(latinCell));
  const pages = [
    ...hangul,
    ...chunk(alnum, CELLS_PER_PAGE).map((cells) => ({ title: '숫자 · 영문', cells })),
    ...chunk(symbols, CELLS_PER_PAGE).map((cells) => ({ title: '특수기호', cells })),
  ];
  pages.forEach((p, i) => { p.index = i; });
  return pages;
}

export const PAGES = buildPages();
