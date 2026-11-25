// Mothman placeholder check: the flashlight draws the flyer in; darkness lets it drift away.
// Run: npm run check:t7
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t7';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4319/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  __game.overlay.classList.add('hidden');
  const p = __game.player; p.position.set(20, 0, 15); p.yaw = 0; p.pitch = 0;
  if (__game.flashlight.on) __game.flashlight.toggle();
});
const dist = () => page.evaluate(() => +__game.mothman.distanceToPlayer().toFixed(1));
// Point the camera at the flyer (stand-in for the player looking up at it).
const lookAtIt = () => page.evaluate(() => {
  const g = __game, m = g.mothman.mesh.position, c = g.camera.position;
  const d = m.clone().sub(c);
  g.player.yaw = Math.atan2(-d.x, -d.z);
  g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
});
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.waitForTimeout(4000);
const darkFar = await dist();
await lookAtIt(); await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/01-light-off-circling-far.png` });

await page.evaluate(() => __game.flashlight.toggle());
const samples = [];
for (let i = 0; i < 6; i++) { await page.waitForTimeout(2000); samples.push(await dist()); }
await lookAtIt(); await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/02-light-on-drawn-in.png` });
const litNear = samples.at(-1);

await page.evaluate(() => __game.flashlight.toggle());
await page.waitForTimeout(10000);
const afterDark = await dist();

check('circles far away while the light is off', darkFar > 15, { darkFar });
check('light on draws it in close', litNear < 7, { samples });
check('it closes in steadily, not instantly', samples[0] > litNear + 5, { first: samples[0], last: litNear });
check('turning the light off lets it drift away', afterDark > litNear + 8, { litNear, afterDark });
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
