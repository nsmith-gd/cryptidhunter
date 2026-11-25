// Palette-only rendering check + grade mockups. Run: node tools/check-t34.mjs [outDir]
// Renders the Pine Hollow test diorama in each grade through the palette pass, reads back every
// pixel and checks it is a master-palette colour. Also saves an unquantised comparison.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { PALETTE } from '../src/art/palette.js';

const out = process.argv[2] || '.ballast/media/t34';
mkdirSync(out, { recursive: true }); mkdirSync('docs/art/palette', { recursive: true });
const server = spawn('npx', ['vite', '--port', '4394', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const pal = new Set(PALETTE.map((h) => h.slice(1)));

const render = async (query, file) => {
  await page.goto(`http://localhost:4394/tools/styleboard/index.html?board=diorama&${query}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${file}.png` });
  // Read the canvas's own pixels (the low-res drawing buffer, before the browser upscales it).
  return page.evaluate(() => {
    const r = window.__renderer, gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const counts = {};
    for (let i = 0; i < px.length; i += 4) {
      const k = [px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return { w, h, counts };
  });
};

for (const grade of ['forest-dusk', 'forest-night', 'forest-dawn', 'swamp-night']) {
  const { w, h, counts } = await render(`grade=${grade}&view=0&quantize`, `grade-${grade}`);
  const colours = Object.keys(counts);
  const off = colours.filter((c) => !pal.has(c));
  check(`${grade}: every pixel is a palette colour`, off.length === 0, { pixels: w * h, distinctColours: colours.length, offPalette: off.slice(0, 5) });
}
// Comparison: same view without the palette pass (smooth-lit, many off-palette shades).
const raw = await render('grade=forest-night&view=0', 'compare-forest-night-unquantised');
check('without the pass the renderer produces off-palette shades (so the pass is doing the work)',
  Object.keys(raw.counts).some((c) => !pal.has(c)), { distinctColours: Object.keys(raw.counts).length });
await render('grade=forest-night&view=1&quantize', 'grade-forest-night-torch');
for (const f of ['grade-forest-dusk', 'grade-forest-night', 'grade-forest-dawn', 'grade-swamp-night']) copyFileSync(`${out}/${f}.png`, `docs/art/palette/${f}.png`);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
