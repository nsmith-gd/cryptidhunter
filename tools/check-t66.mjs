// Determinism check (#66). Run: npm run check:t66 [outDir]
// 1) Same seed + same input trace, two fresh page loads -> identical world state after 30 s of sim.
// 2) A different seed gives a different world (so the check can fail).
// 3) Frame-rate independence: the same run drawn at 30 fps and at 144 fps ends in the same state.
// The sim is driven directly (sim.paused) with a tick-indexed input trace, so the browser's own
// frame timing can't leak in. Also captures both frame rates at the same moment for the report.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t66';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4373', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const errors = [];

// Load a world, pause the real-time loop, and install a tick-indexed input trace.
async function world(seed) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:4373/?seed=${seed}&nodebugai&simpaused`);
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.evaluate(() => {
    const g = __game;
    g.sim.paused = true;
    g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
    g.aiDebug?.setVisible(false);
    // Input trace by sim tick: walk north, turn, sprint, crouch, torch off/on, walk toward Bigfoot.
    const orig = g.sim.simulate;
    g.sim.simulate = (dt) => {
      const t = g.sim.tick, k = g.input.keys;
      k.clear();
      if (t < 240) k.add('KeyW');
      else if (t < 300) { k.add('KeyW'); k.add('KeyD'); }
      else if (t < 480) { k.add('KeyW'); k.add('ShiftLeft'); }
      else if (t < 600) { k.add('KeyW'); k.add('KeyC'); }
      else if (t < 1200) k.add('KeyW');
      if (t === 300) g.player.yaw -= 0.6;
      if (t === 700) g.player.yaw += 1.2;
      if (t === 900) g.flashlight.toggle();
      if (t === 1100) g.flashlight.toggle();
      orig(dt);
    };
  });
  return page;
}
// Everything the simulation owns that a player or AI could notice.
const snapshot = (page) => page.evaluate(() => {
  const g = __game, r = (v) => Math.round(v * 1e6) / 1e6;
  return {
    tick: g.sim.tick,
    player: { x: r(g.player.position.x), z: r(g.player.position.z), yaw: r(g.player.yaw), stamina: r(g.player.stamina ?? 0) },
    torch: { on: g.flashlight.on, battery: r(g.flashlight.battery) },
    cryptids: g.cryptids.cryptids.map((c) => ({ id: c.profile.id, x: r(c.agent.x), z: r(c.agent.z), state: c.state })),
    clues: g.clues.clues.map((c) => [c.type, r(c.x), r(c.z), r(c.age)]),
    hunt: { stage: g.hunt.stage, elapsed: r(g.hunt.elapsed) },
    fear: r(g.fear.value),
  };
});

// 1) Same seed twice.
const a = await world(4242);
await a.evaluate(() => { for (let i = 0; i < 1800; i++) __game.sim.step(); });
const sa = await snapshot(a);
const b = await world(4242);
await b.evaluate(() => { for (let i = 0; i < 1800; i++) __game.sim.step(); });
const sb = await snapshot(b);
const same = JSON.stringify(sa) === JSON.stringify(sb);
check('same seed + same input trace -> identical state after 30 s (1800 steps)', same && sa.clues.length > 0,
  { tick: sa.tick, player: sa.player, cryptids: sa.cryptids, clues: sa.clues.length, firstDiff: same ? null : diff(sa, sb) });
await b.close();

// 2) A different seed.
const c = await world(777);
await c.evaluate(() => { for (let i = 0; i < 1800; i++) __game.sim.step(); });
const sc = await snapshot(c);
check('a different seed gives a different world', JSON.stringify(sc.cryptids) !== JSON.stringify(sa.cryptids) || JSON.stringify(sc.clues) !== JSON.stringify(sa.clues),
  { seed4242: sa.cryptids, seed777: sc.cryptids });
await c.close();
await a.close();

// 3) 30 fps vs 144 fps: same seed, same trace, 10 s of frames, rendering skipped for speed.
async function atFps(fps, shotName) {
  const p = await world(4242);
  await p.evaluate((fps) => {
    const g = __game, present = g.sim.present;
    g.sim.present = () => {};                        // the sim is what's under test
    for (let i = 0; i < Math.round(10 * fps); i++) g.sim.frame(1 / fps);
    while (g.sim.tick < 600) g.sim.step();           // float rounding: top up to exactly 10 s
    g.sim.present = present;
  }, fps);
  const s = await snapshot(p);
  await p.evaluate(() => { __game.sim.frame(0); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${shotName}.png` });
  await p.close();
  return s;
}
const s30 = await atFps(30, '01-seed4242-10s-at-30fps');
const s144 = await atFps(144, '02-seed4242-10s-at-144fps');
const fpsSame = JSON.stringify(s30) === JSON.stringify(s144);
check('the same run at 30 fps and 144 fps ends in exactly the same state', fpsSame,
  { ticks: [s30.tick, s144.tick], player30: s30.player, player144: s144.player, torch: [s30.torch, s144.torch], firstDiff: fpsSame ? null : diff(s30, s144) });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

function diff(x, y, path = '') {
  if (JSON.stringify(x) === JSON.stringify(y)) return null;
  if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) return { path, a: x, b: y };
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = diff(x[k], y[k], `${path}.${k}`); if (d) return d; }
  return { path, a: '?', b: '?' };
}
