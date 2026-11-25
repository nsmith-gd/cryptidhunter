// Caught state: a cryptid touching the player ends the hunt; restart gives a fresh hunt.
// Run: npm run check:t13
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t13';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4323', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async () => {
  await page.goto('http://localhost:4323/');
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => { __game.overlay.classList.add('hidden'); __game.input.locked = true; });
};
const st = () => page.evaluate(() => {
  const h = __game.huntFailure, p = __game.player.position;
  return { caught: h.isCaught, by: h.caughtBy, screen: h.screen.style.display, x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
});

// 1. Let the Chupacabra reach you (stand still facing away from it).
await load();
await page.evaluate(() => {
  const g = __game; g.player.position.set(20, 0, 10); g.player.yaw = Math.PI; g.player.pitch = 0;
  const c = g.chupacabra; c.position.set(20, c.position.y, 1); c.enter('stalk');
});
const t0 = Date.now();
let s;
while (Date.now() - t0 < 8000) { s = await st(); if (s.caught) break; await page.waitForTimeout(100); }
check('letting the Chupacabra reach you ends the hunt', s.caught && s.by === 'The Chupacabra' && s.screen === 'flex', s);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/01-caught-by-chupacabra.png` });

// 2. The world freezes behind the screen (player can't keep moving).
await page.evaluate(() => __game.input.keys.add('KeyW'));
await page.waitForTimeout(600);
const frozen = await st();
check('world is frozen while caught', frozen.x === s.x && frozen.z === s.z, { before: s, after: frozen });
await page.evaluate(() => __game.input.keys.delete('KeyW'));

// 3. Space restarts a fresh hunt.
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__game && !__game.huntFailure.isCaught, null, { timeout: 8000 });
await page.waitForTimeout(300);
const fresh = await st();
check('Space starts a new hunt (back at the start)', !fresh.caught && fresh.screen === 'none' && Math.hypot(fresh.x, fresh.z) < 0.5, fresh);

// 4. Walking into Bigfoot also counts as a touch.
await page.evaluate(() => {
  __game.overlay.classList.add('hidden');
  if (__game.chupacabra) __game.chupacabra.update = () => {};
  const b = __game.cryptids.cryptids[0];
  b.update = () => {}; // hold it still so we can walk into it
  const p = __game.player; p.position.set(b.agent.x, 0, b.agent.z + 3); p.yaw = 0; p.pitch = -0.1;
});
await page.evaluate(() => __game.input.keys.add('KeyW'));
const t1 = Date.now();
while (Date.now() - t1 < 4000) { s = await st(); if (s.caught) break; await page.waitForTimeout(100); }
check('touching Bigfoot ends the hunt', s.caught && s.by === 'Bigfoot', s);
await page.screenshot({ path: `${out}/02-caught-by-bigfoot.png` });

// 5. A flyer overhead doesn't count.
await load();
await page.evaluate(() => {
  const g = __game; g.chupacabra.update = () => {}; g.cryptids.cryptids[0].update = () => {};
  g.mothman.update = () => {}; const m = g.mothman.mesh.position, p = g.player.position;
  m.set(p.x, 4, p.z);
});
await page.waitForTimeout(500);
const overhead = await st();
check('Mothman circling overhead is not a touch', !overhead.caught, overhead);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
