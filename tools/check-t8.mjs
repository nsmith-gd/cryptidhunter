// Chupacabra placeholder check: it freezes while watched, creeps closer when not,
// and charges you from 6 m if you look away. Run: npm run check:t8
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t8';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4320/');
await page.waitForFunction(() => window.__game);
// This check repeats hits on purpose; don't end the hunt on the first one.
await page.evaluate(() => { if (__game.huntFailure) __game.huntFailure.enabled = false; });

// Player stands in the open at (20,0,10) facing -z; the stalker is placed `d` metres ahead.
const setup = (d) => page.evaluate((d) => {
  const g = __game; g.overlay.classList.add('hidden');
  g.player.position.set(20, 0, 10); g.player.velocity.set(0, 0, 0); g.player.yaw = 0; g.player.pitch = -0.12;
  const c = g.chupacabra; c.position.set(20, c.position.y, 10 - d); c.enter('stalk'); c.hits = 0;
}, d);
const st = () => page.evaluate(() => {
  const c = __game.chupacabra, p = __game.player.position;
  return { state: c.state, hits: c.hits, watched: c.watched, dist: +Math.hypot(c.position.x - p.x, c.position.z - p.z).toFixed(2) };
});
const face = (yaw) => page.evaluate((y) => { __game.player.yaw = y; }, yaw);
const waitFor = async (pred, ms) => {
  const t = Date.now();
  while (Date.now() - t < ms) { const s = await st(); if (pred(s)) return s; await page.waitForTimeout(50); }
  return st();
};
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// 1. Watching it at 12 m: it stays put.
await setup(12);
await page.waitForTimeout(3000);
const watched = await st();
check('frozen while watched (12 m)', watched.watched && watched.state === 'stalk' && watched.dist > 11.9, watched);

// 2. Watching it inside charge range: still no charge.
await setup(5);
await page.waitForTimeout(3000);
const close = await st();
check('no charge while watched at 5 m', close.hits === 0 && close.state === 'stalk', close);
await page.screenshot({ path: `${out}/01-watching-it-at-5m.png` });

// 3. Look away from 12 m: it closes in, winds up and charges.
await setup(12);
await face(Math.PI);
await page.waitForTimeout(1200);
const creeping = await st();
check('creeps closer when you look away', creeping.dist < 11 && !creeping.watched, creeping);
const charging = await waitFor((s) => s.state === 'charge', 6000);
check('charges once within 6 m unseen', charging.state === 'charge' && charging.dist <= 6.5, charging);
await face(0); // turn back to see it coming — the charge is committed
await page.waitForTimeout(90);
await page.screenshot({ path: `${out}/02-mid-charge.png` });
const hit = await waitFor((s) => s.hits > 0, 3000);
check('charge hits the player', hit.hits === 1, hit);
await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/03-hit-flash.png` });
const retreat = await waitFor((s) => s.state === 'retreat' && s.dist > 6, 2000);
check('slinks away after the hit', retreat.state === 'retreat', retreat);

// 4. Behind a box it isn't "seen" even if you face it.
await page.evaluate(() => {
  const g = __game; g.player.position.set(12, 0, 0); g.player.velocity.set(0, 0, 0); g.player.yaw = Math.PI; g.player.pitch = 0;
  const c = g.chupacabra; c.position.set(12, c.position.y, 9); c.enter('stalk');
}); // box at (12, 6) sits between player and stalker
await page.waitForTimeout(400);
const hidden = await st();
check('not watched when hidden behind a box', !hidden.watched, hidden);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
