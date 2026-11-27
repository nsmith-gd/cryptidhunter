// L01 tunnel creature (#123): in the Cabbagetown tunnels (G01 gym, fixed seed) —
//   careful: wait in the dark, it creeps out to a lit vantage ahead of you and lingers; creep in
//            crouched and quiet, raise the camera and get a clear (graded) photo; escape and it pays.
//   careless: torch on and walking straight at it, it flinches, chitters and bolts; after a few
//            scares it stays hidden for good, the level carries on and you can still get out.
//   It never attacks (health never changes from it).
// Run: npm run check:t123 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t123';
mkdirSync(out, { recursive: true });
const PORT = 4423;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
  Element.prototype.requestPointerLock = function () { locked = this; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
  Document.prototype.exitPointerLock = function () { if (!locked) return; locked = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
});
const load = async () => {
  await page.evaluate(() => sessionStorage.clear()).catch(() => {});
  await page.goto(`http://localhost:${PORT}/tunnel.html?gym&seed=101`);
  await page.waitForFunction(() => window.__l01, null, { timeout: 90000 });
  await page.click('#l01-overlay');
  await page.waitForFunction(() => __l01.input.locked, null, { timeout: 10000 });
  await page.evaluate(() => {
    const g = __l01, CELL = 4;
    window.__w = (cx, cy) => ({ x: (cx - 32 + 0.5) * CELL, z: (cy - 24 + 0.5) * CELL });
    window.__aim = (x, y, z) => { const p = g.player, e = p.position.y + p.eyeHeight; p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); p.pitch = Math.atan2(y - e, Math.hypot(x - p.position.x, z - p.position.z)); };
    window.__steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
    window.__untilEvent = (type, maxS) => { const c = g.creature; for (let t = 0; t < maxS * 60; t++) { g.sim.step(); if (c.events.some((e) => e.type === type && !e.seen)) { const e = c.events.find((x) => x.type === type && !x.seen); e.seen = true; return e; } } return null; };
  });
};

// ---- careful ------------------------------------------------------------------------------------
await load();
const careful1 = await page.evaluate(() => {
  const g = __l01, c = g.creature, p = __w(38, 10);
  g.player.position.set(p.x, 0, p.z); g.player.yaw = -Math.PI / 2; g.player.pitch = 0;
  if (g.flashlight.on) g.flashlight.toggle();
  const health0 = g.health;
  const shown = __untilEvent('showing', 90);
  if (!shown) return { shown: null };
  // Creep in, crouched, re-aiming each step, until ~13 m (stop if it startles).
  const m = c.mesh.position;
  g.input.keys.add('ControlLeft');
  let t = 0;
  while (c.ai.playerDistance > 13 && t < 60 * 60 && c.state !== 'startled') {
    __aim(m.x, 0.9, m.z);
    g.input.keys.add('KeyW'); g.sim.step(); t++;
  }
  g.input.keys.delete('KeyW');
  __steps(30);                                             // settle (stand still a moment)
  return { shown, crept: +(t / 60).toFixed(1), dist: +c.ai.playerDistance.toFixed(1), state: c.state, startled: c.events.filter((e) => e.type === 'startled').length, health0 };
});
check('careful: it creeps out to a vantage ahead of you and shows itself in the light', !!careful1.shown && careful1.shown.light !== 'dark', careful1.shown);
check('careful: creeping in crouched and quiet, it stays (it does not bolt)', careful1.state !== 'startled' && careful1.startled === 0 && careful1.dist <= 14, careful1);
// Raise the camera and shoot (a real right-hold + left-click on the canvas).
await page.evaluate(() => { const c = __l01.creature, m = c.mesh.position; __aim(m.x, 1.0, m.z); dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true })); __steps(40); __aim(m.x, 1.0, m.z); __steps(20); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/01-careful-it-lingers-in-the-lamp-light-viewfinder.png` });
const shot1 = await page.evaluate(() => {
  const g = __l01, c = g.creature, m = c.mesh.position; __aim(m.x, 1.0, m.z);
  g.photo.snap(); __steps(60);
  const r = g.photo.records.filter((x) => x.kind === 'creature').at(-1);
  return { state: c.state, Q: r?.quality.Q ?? null, light: r?.quality.light ?? null, problems: r?.quality.problems ?? null };
});
// If the lamp light alone was too dim for a clear frame, use the flinch: torch on it and shoot at once.
let shot2 = null;
if ((shot1.Q ?? 0) < 40) {
  shot2 = await page.evaluate(() => {
    const g = __l01, c = g.creature, m = c.mesh.position; __aim(m.x, 1.0, m.z);
    if (!g.flashlight.on) g.flashlight.toggle();
    __steps(20);                                            // ~0.3 s: it rears in the beam
    const before = c.state;
    g.photo.cooldown = 0; g.photo.snap(); __steps(90);
    const r = g.photo.records.filter((x) => x.kind === 'creature').at(-1);
    return { stateWhenShot: before, after: c.state, Q: r?.quality.Q ?? null, light: r?.quality.light ?? null, problems: r?.quality.problems ?? null };
  });
}
await page.evaluate(() => dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true })));
const best = Math.max(shot1.Q ?? 0, shot2?.Q ?? 0);
check('careful: a clear photo of it (grade 2 or better)', best >= 40, { lampShot: shot1, flinchShot: shot2 });
const end1 = await page.evaluate(() => {
  const g = __l01; g.escape('the maintenance ladder');
  const esc = g.trace.find((e) => e.type === 'escaped');
  return { escaped: !!esc, evidence: esc?.evidence, text: document.querySelector('#l01-end')?.textContent ?? '', cash: g.career.ledger.cash, health: g.health };
});
check('careful: you get out and the photo is paid (it never hurt you)', end1.escaped && end1.evidence.includes('photo') && /Creature photo/.test(end1.text) && end1.health === careful1.health0, { evidence: end1.evidence, cash: end1.cash, health: end1.health });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/02-careful-escaped-with-a-graded-photo.png` });

// ---- careless --------------------------------------------------------------------------------------
await load();
const careless = await page.evaluate(() => {
  const g = __l01, c = g.creature;
  const home = __w(38, 10);
  g.player.position.set(home.x, 0, home.z); g.player.yaw = -Math.PI / 2;
  if (!g.flashlight.on) g.flashlight.toggle();
  const health0 = g.health;
  for (let round = 0; round < 6 && c.state !== 'hidden'; round++) {
    const shown = __untilEvent('emerging', 150);
    if (!shown) break;
    // Torch on, walking straight at it.
    let t = 0;
    while (c.state !== 'startled' && c.state !== 'hidden' && t < 30 * 60) {
      const m = c.mesh.position; __aim(m.x, 0.9, m.z);
      g.input.keys.add('KeyW'); g.sim.step(); t++;
    }
    g.input.keys.delete('KeyW');
    // Back to where we started (the walk itself is not the test).
    g.player.position.set(home.x, 0, home.z); g.player.yaw = -Math.PI / 2;
  }
  __steps(60);
  const why = c.events.filter((e) => e.type === 'startled').map((e) => e.why);
  return { why, scares: c.ai.scares, state: c.state, gone: c.events.some((e) => e.type === 'gone'), flinches: c.events.filter((e) => e.type === 'flinch').length, ended: g.ended, health0, health: g.health };
});
check('careless: torch on and walking at it scares it off (it bolts, with a reason)', careless.why.length >= 1 && careless.why.every(Boolean), careless);
check('careless: scared off enough times, it stays hidden for good', careless.gone && careless.state === 'hidden', { scares: careless.scares, state: careless.state });
check('careless: the level carries on (not ended), and it never hurt you', !careless.ended && careless.health === careless.health0, { ended: careless.ended, health: careless.health });
const end2 = await page.evaluate(() => { const g = __l01; g.escape('the maintenance ladder'); return { escaped: g.trace.some((e) => e.type === 'escaped'), cleared: g.career.s.cleared }; });
check('careless: you can still get out and clear the level', end2.escaped && end2.cleared, end2);
const trace = await page.evaluate(() => __l01.trace.filter((e) => e.type.startsWith('creature-')));
writeFileSync(`${out}/runs.json`, JSON.stringify({ careful1, shot1, shot2, end1, careless, end2, carelessCreatureEvents: trace }, null, 2));

check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
