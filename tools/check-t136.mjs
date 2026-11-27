// Igopogo proxy check (#136, L03 Lake Simcoe). Run: npm run check:t136 [outDir]
// Quiet waiting on the Point through a whole night: the trace shows at least one surfacing window,
// and it never leaves the water. Wait for a rise and photograph it from shore. Then make noise on
// the beach while it's up: it dives at once (the window is cut short), and stays down a while.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t136';
mkdirSync(out, { recursive: true });
const PORT = 4536;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };



await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=31&nozones`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=31&nozones`);
await page.waitForFunction(() => window.__game?.igopogo, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  window.__stand = (x, z, yaw = 0, pitch = -0.05) => { const p = g.player; p.position.set(x, g.map.heightAt(x, z), z); p.velocity.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; };
  window.__faceTo = (x, z, tx, ty, tz) => { const y = g.map.heightAt(x, z) + 1.6; __stand(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - y, Math.hypot(tx - x, tz - z))); };
  // Keep you comfortable through a long wait (this check is about the lake, not survival).
  window.__comfort = () => { const s = g.survival; s.fatigue.value = 10; s.nutrition.energy = 90; s.thermo.core = 37; if (s.hydration) s.hydration.value = 90; };
  const o = g.map.observation[0];
  __stand(o.x, o.z, 0);
});
// 1. Quiet night on the Point: run the whole 15-minute night clock.
const night = await page.evaluate(() => {
  const g = __game, ig = g.igopogo, zones = g.map.surfacing;
  let inWater = true, maxNoise = 0;
  const dawn = 15 * 60;
  while (g.hunt.elapsed < dawn && g.hunt.stage !== 'ended') {
    steps(60); __comfort(); g.player.velocity.set(0, 0, 0);
    maxNoise = Math.max(maxNoise, g.player.noise);
    const p = ig.mesh.position;
    if (ig.mesh.visible && g.map.heightAt(p.x, p.z) > -1.5) inWater = false;
  }
  return { elapsed: Math.round(g.hunt.elapsed), windows: ig.schedule.windows, trace: ig.trace.filter((e) => e.type !== 'plan'), inWater, maxNoise };
});
console.log('TRACE (quiet night)\n' + night.trace.map((e) => `  ${String(e.t).padStart(6)} s  ${e.type.padEnd(8)} ${e.zone}${e.why ? `  (${e.why})` : ''}`).join('\n'));
check('quiet waiting yields at least one surfacing window in the night (trace)', night.windows.length >= 1 && night.windows.every((w) => !w.cut), { windows: night.windows, elapsed: night.elapsed });
check('it never leaves the water', night.inWater, night.inWater);

// 2. New night: wait on the Point for the first rise and photograph it.
await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=31&nozones`);
await page.waitForFunction(() => window.__game?.igopogo, null, { timeout: 120000 });
const rise = await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  window.__stand = (x, z, yaw = 0, pitch = -0.05) => { const p = g.player; p.position.set(x, g.map.heightAt(x, z), z); p.velocity.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; };
  window.__faceTo = (x, z, tx, ty, tz) => { const y = g.map.heightAt(x, z) + 1.6; __stand(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - y, Math.hypot(tx - x, tz - z))); };
  const ig = g.igopogo, z = ig.schedule.zone;
  const seeFrom = g.map.visibility.find((v) => v.id === z.id).seenFrom[0];
  const o = g.map.observation.find((x) => x.id === seeFrom);
  __stand(o.x, o.z);
  for (let i = 0; i < 20000 && ig.riseLevel < 1; i++) { steps(10); g.player.velocity.set(0, 0, 0); }
  const h = new g.THREE.Vector3(); ig.head.getWorldPosition(h);
  __faceTo(o.x, o.z, h.x, h.y - 0.6, h.z);
  window.__o = o;
  return { at: Math.round(g.hunt.elapsed), zone: z.id, from: o.id, up: ig.up, dist: Math.round(Math.hypot(h.x - o.x, h.z - o.z)) };
});
for (const el of await page.$$('body > *')) await el.evaluate((e) => { if (e.tagName !== 'CANVAS') e.dataset.v = e.style.visibility; });
// Zoom: binoculars-ish field of view so the head reads in the capture.
await page.evaluate(() => { const c = __game.camera; c.userData.fov0 = c.fov; c.fov = 20; c.updateProjectionMatrix(); __game.sim.frame?.(0); });
await page.screenshot({ path: `${out}/01-igopogo-surfaced-seen-from-shore.png` });
await page.evaluate(() => { const c = __game.camera; c.fov = c.userData.fov0; c.updateProjectionMatrix(); });
// Raise the camera and shoot.
const shot = await page.evaluate(() => {
  const g = __game; g.photo.wantRaised = true;
  for (let i = 0; i < 200 && !g.photo.raised; i++) steps(1);
  steps(20);
  const h = new g.THREE.Vector3(); g.igopogo.head.getWorldPosition(h);
  __faceTo(__o.x, __o.z, h.x, h.y - 0.5, h.z);
  const e = g.photo.snap();
  g.photo.wantRaised = false;
  return e && { result: e.result, subject: e.subject, Q: e.evidence?.quality?.Q, problems: e.evidence?.quality?.problems };
});
await page.screenshot({ path: `${out}/02-photograph-it-from-the-point.png` });
check('you can wait for a surfacing and photograph it from dry land', rise.up && shot?.result === 'HIT' && shot.subject === 'Igopogo', { rise, shot });

// 3. Noise on the beach while it's up: it dives at once and stays down a while.
const noisy = await page.evaluate(() => {
  const g = __game, ig = g.igopogo;
  // Wait for the next window, then run along the beach nearest it.
  const n0 = ig.schedule.windows.length;
  for (let i = 0; i < 40000 && !(ig.schedule.state === 'up' && ig.schedule.windows.length === n0 + 1); i++) steps(10);
  const w0 = ig.schedule.windows.length;
  const z = ig.schedule.zone, up = g.hunt.elapsed;
  const shoreX = z.x, shoreZ = z.z + 22;
  __stand(shoreX, shoreZ);
  g.input.keys?.add?.('KeyW'); g.input.keys?.add?.('ShiftLeft');
  g.player.noise = 1; g.player.noiseRadius = 20;
  let dived = null;
  for (let i = 0; i < 600 && !dived; i++) { g.player.noise = 1; g.player.noiseRadius = 20; steps(1); if (ig.schedule.state === 'down') dived = g.hunt.elapsed; }
  g.input.keys?.delete?.('KeyW'); g.input.keys?.delete?.('ShiftLeft');
  const w = ig.schedule.windows.at(-1), next = ig.schedule.next;
  return { zone: z.id, upFor: dived && +(dived - up).toFixed(1), window: w, last: ig.trace.filter((e) => e.type !== 'plan').slice(-2), nextRestS: Math.round(next.start - (dived ?? 0)) };
});
check('noise on the shore while it is up makes it dive at once (window cut short)', noisy.window?.cut && noisy.upFor != null && noisy.upFor < 3, noisy);
check('after being disturbed it stays down longer than a normal rest', noisy.nextRestS >= 150 + 80, noisy.nextRestS);

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
