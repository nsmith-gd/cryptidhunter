// Flashlight check: in the dark map, F toggles a light that brightens the boxes ahead.
// Run: npm run check:t2
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t2';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4318', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4318/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  __game.overlay.classList.add('hidden');
  __game.input.locked = true; // stand-in for pointer lock in headless mode
  const p = __game.player; p.position.set(-4, 0, -1.5); p.yaw = 0; p.pitch = -0.15; // facing the 2x2 box
});
await page.waitForTimeout(500);

// Mean brightness of the centre of the canvas (where the box sits).
const brightness = () => page.evaluate(() => {
  const src = __game.renderer.domElement;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const w = Math.floor(src.width / 3), h = Math.floor(src.height / 3);
  const d = g.getImageData(w, h, w, h).data;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return +(sum / (d.length / 4)).toFixed(1);
});
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

const onStart = await page.evaluate(() => __game.flashlight.on);
await page.screenshot({ path: `${out}/01-flashlight-on.png` });
const lit = await brightness();
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
const offState = await page.evaluate(() => __game.flashlight.on);
await page.screenshot({ path: `${out}/02-flashlight-off.png` });
const dark = await brightness();
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
const backOn = await page.evaluate(() => __game.flashlight.on);

check('flashlight starts on', onStart, onStart);
check('F turns it off, F again turns it on', !offState && backOn, { offState, backOn });
check('map is dark with the light off', dark < 25, { dark });
check('flashlight clearly lights the box ahead', lit > dark * 3 && lit > 40, { lit, dark });

// Wider view of the field for the report.
await page.evaluate(() => { const p = __game.player; p.position.set(6, 0, 2); p.yaw = 0.6; p.pitch = -0.1; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-field-flashlight-on.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
