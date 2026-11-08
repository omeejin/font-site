// 브라우저 엔드투엔드 테스트: 예시 템플릿 → 인식 → 폰트 생성 → TTF 저장
// 사용법: (사이트를 http://localhost:8123 에서 서빙한 뒤) node tests/e2e.mjs
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.SITE_URL || 'http://localhost:8123/';
const out = new globalThis.URL('./out/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL);
await page.waitForSelector('.page-card:nth-child(4)', { timeout: 60000 });
await page.click('#demoBtn');
await page.waitForFunction(() => document.querySelectorAll('.result').length === 4 &&
  [...document.querySelectorAll('.meta-note')].every((n) => /인식됨/.test(n.textContent)), null, { timeout: 180000 });
const notes = await page.$$eval('.result', (rs) => rs.map((r) => r.querySelector('select').value + ': ' + r.querySelector('.meta-note').textContent));
console.log(notes.join('\n'));
await page.click('#buildBtn');
await page.waitForFunction(() => window.__lastFont || document.querySelector('#buildStatus.err'), null, { timeout: 120000 });
const failed = await page.$('#buildStatus.err');
if (failed) { const b = await page.evaluate(() => window.__lastTtf && Array.from(window.__lastTtf)); if (b) fs.writeFileSync(out + 'demo.ttf', Buffer.from(b)); console.log('BUILD FAILED:', await failed.textContent(), errors); await browser.close(); process.exit(1); }
console.log(await page.textContent('#buildStatus'));
const bytes = await page.evaluate(() => Array.from(window.__lastFont));
fs.writeFileSync(out + 'demo.ttf', Buffer.from(bytes));
await page.screenshot({ path: out + 'page.png', fullPage: true });
await page.locator('#previewBox').screenshot({ path: out + 'preview.png' });
console.log('errors:', errors);
await browser.close();
