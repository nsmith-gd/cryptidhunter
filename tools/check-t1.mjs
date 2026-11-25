// Automated check for the movement controller. Run: npm run build && node tools/check-t1.mjs [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t1';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4317', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4317/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { __game.overlay.classList.add('hidden'); });

const hold = async (codes, ms) => {
  await page.evaluate((c) => c.forEach((k) => __game.input.keys.add(k)), codes);
  await page.waitForTimeout(ms);
  await page.evaluate((c) => c.forEach((k) => __game.input.keys.delete(k)), codes);
  await page.waitForTimeout(100);
};
const state = () => page.evaluate(() => {
  const p = __game.player;
  return { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2), crouch: p.crouching, eye: +p.eyeHeight.toFixed(2) };
});
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); };

await page.waitForTimeout(500);
await shot('01-start');
const t0 = await state();
await hold(['KeyW'], 1000);
const walk = await state();
await page.evaluate(() => { const p = __game.player; p.position.set(0, 0, 0); p.velocity.set(0, 0, 0); });
await hold(['KeyW', 'ShiftLeft'], 1000);
const sprint = await state();
check('sprint covers more ground than walk', Math.abs(sprint.z) > Math.abs(walk.z) * 1.5, { walk: walk.z, sprint: sprint.z });

// Standing: blocked by the low slab at z=-11 (front face z=-9.5).
await page.evaluate(() => { const p = __game.player; p.position.set(0, 0, -5); p.velocity.set(0, 0, 0); });
await hold(['KeyW'], 3000);
const blocked = await state();
check('standing player is stopped by low slab', blocked.z > -9.3, blocked);
await shot('02-blocked-standing');

// Crouched: passes under it.
await page.evaluate(() => __game.input.keys.add('ControlLeft'));
await page.waitForTimeout(400);
await shot('03-crouched-at-slab');
await hold(['KeyW'], 1500);
const under = await state();
check('crouched player moves under slab', under.z < -9.6 && under.crouch, under);
await shot('04-crouched-under-slab');
// Release crouch while under: should stay crouched.
await page.evaluate(() => __game.input.keys.delete('ControlLeft'));
await page.waitForTimeout(300);
const stay = await state();
check('stays crouched under slab when Ctrl released', stay.crouch, stay);
await hold(['KeyW'], 2500);
const out2 = await state();
check('stands up after leaving slab', !out2.crouch && out2.z < -12.5, out2);

// Obstacle collision: walk into the 2x2 box at (-4,-6).
await page.evaluate(() => { const p = __game.player; p.position.set(-4, 0, -2); p.velocity.set(0, 0, 0); p.yaw = 0; });
await hold(['KeyW'], 2000);
const wall = await state();
check('box obstacle blocks movement', wall.z > -5.0 && wall.z < -4.6, wall);

// Mouse look turns the view.
await page.evaluate(() => { const p = __game.player; p.position.set(6, 0, 2); p.yaw = 0.6; p.pitch = -0.1; });
await page.waitForTimeout(300);
await shot('05-overview');

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
