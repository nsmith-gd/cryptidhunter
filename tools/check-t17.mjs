// Stamina + battery rules. Run: npm run check:t17
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t17';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4321', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4321/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true;
  if (g.chupacabra) g.chupacabra.update = () => {};
});
const st = () => page.evaluate(() => {
  const p = __game.player, f = __game.flashlight;
  return { stamina: +p.stamina.toFixed(2), exhausted: p.exhausted, sprinting: p.sprinting,
    speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(2), battery: +f.battery.toFixed(3), on: f.on, spares: f.spares };
});
const keys = (codes, down) => page.evaluate(([c, d]) => c.forEach((k) => d ? __game.input.keys.add(k) : __game.input.keys.delete(k)), [codes, down]);
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// --- Stamina: sprint down a clear lane until empty.
await page.evaluate(() => { const p = __game.player; p.position.set(-30, 0, 30); p.yaw = -Math.PI / 2; p.pitch = 0; });
await keys(['KeyW', 'ShiftLeft'], true);
await page.waitForTimeout(2500);
const mid = await st();
check('sprinting drains stamina', mid.sprinting && mid.stamina < 0.7 && mid.stamina > 0.2, mid);
await page.screenshot({ path: `${out}/01-sprinting-stamina-draining.png` });
await page.waitForTimeout(4500);
const empty = await st();
check('cannot sprint with empty stamina (Shift still held)', empty.exhausted && !empty.sprinting && empty.speed < 3.5, empty);
await page.screenshot({ path: `${out}/02-winded-cannot-sprint.png` });
await keys(['KeyW', 'ShiftLeft'], false);
await page.waitForTimeout(3000);
const rested = await st();
check('resting refills stamina', rested.stamina > 0.5 && !rested.exhausted, rested);

// --- Battery: drain to zero.
await page.evaluate(() => { const p = __game.player; p.position.set(-4, 0, -1.5); p.yaw = 0; p.pitch = -0.15; __game.flashlight.battery = 0.012; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-low-battery-dim.png` });
await page.waitForTimeout(2000);
const dead = await st();
check('light turns off at 0% battery', dead.battery === 0 && !dead.on, dead);
await page.keyboard.press('KeyF');
await page.waitForTimeout(150);
const stillDead = await st();
check('F does nothing with a dead battery', !stillDead.on, stillDead);
await page.screenshot({ path: `${out}/04-dead-battery-dark.png` });
await page.keyboard.press('KeyR');
await page.waitForTimeout(100);
const swapped = await st();
check('R swaps in a spare (spares 1 -> 0, battery full)', swapped.battery > 0.99 && swapped.spares === 0, swapped);
await page.keyboard.press('KeyF');
await page.waitForTimeout(150);
const relit = await st();
check('light works again after the swap', relit.on, relit);
await page.keyboard.press('KeyR');
const noSpare = await st();
check('no swap without spares', noSpare.spares === 0, noSpare);

// --- Pickup: walk over the battery at (3, -3).
await page.evaluate(() => { const p = __game.player; p.position.set(3, 0, 1); p.yaw = 0; p.pitch = -0.5; });
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/05-battery-pickup-on-ground.png` });
await keys(['KeyW'], true);
await page.waitForTimeout(1600);
await keys(['KeyW'], false);
const picked = await st();
check('walking over a battery pockets a spare', picked.spares === 1, picked);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
