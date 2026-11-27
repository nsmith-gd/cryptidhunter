// Point Pleasant greybox check (#146, GDD 12.2 L08). Run: npm run check:t146 [outDir]
// The reclaimed industrial woodland loads with its works roads, signposts, landmarks, overlooks and
// the gated Route 62 exit. The Mothman (placeholder) travels the pylon line and rail spur, and
// perches on the tall things once it's dark a while. Electronics near it fail; the paper map works.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t146';
mkdirSync(out, { recursive: true });
const PORT = 4546;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };



await page.goto(`http://localhost:${PORT}/?map=pointpleasant&simpaused&nodebugai&seed=8`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=pointpleasant&simpaused&nodebugai&seed=8`);
await page.waitForFunction(() => window.__game?.map, null, { timeout: 120000 });
const info = await page.evaluate(() => {
  const g = __game, m = g.map;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  steps(30);
  return { mapId: g.mapId, target: g.hunt.target, signs: m.signs.length, places: m.places.map((p) => p.name), mothVisible: g.mothman.mesh.visible, corridors: m.mothmanCorridors.length, perches: m.mothmanPerches.length };
});
check('Point Pleasant loads: target Mothman, signposted works roads, named landmarks and overlooks', info.mapId === 'pointpleasant' && info.target === 'Mothman' && info.signs >= 8 && info.mothVisible, info);
// The Mothman travels its corridors (torch off so it isn't drawn to you).
const travel = await page.evaluate(() => {
  const g = __game, mo = g.mothman, m = g.map;
  if (g.flashlight.on) g.flashlight.toggle();
  g.player.position.set(12, 0, 78);
  const segD = (p, line) => Math.min(...line.slice(1).map((b, i) => { const a = line[i], ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return a.clone().addScaledVector(ab, t).distanceTo(p); }));
  const samples = [], states = new Set();
  mo.dark = 0;
  for (let k = 0; k < 40; k++) { mo.dark = 0; steps(60); states.add(mo.state); const p = mo.mesh.position.clone(); samples.push({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), off: +Math.min(...m.mothmanCorridors.map((l) => segD(p, l))).toFixed(1) }); }
  return { states: [...states], maxOff: Math.max(...samples.slice(5).map((s) => s.off)), spanX: Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x)), first: samples[5], last: samples.at(-1) };
});
check('the Mothman travels along its corridors (pylon line, rail spur)', travel.maxOff < 3 && travel.spanX > 30, travel);
// Dark a while: it settles on a perch on one of the tall things.
const perch = await page.evaluate(() => {
  const g = __game, mo = g.mothman;
  for (let i = 0; i < 60 * 40 && !(mo.state === 'perch' && mo.perchedAt); i++) steps(1);
  const p = mo.mesh.position, near = Math.min(...g.map.mothmanPerches.map((q) => q.distanceTo(p)));
  return { state: mo.state, at: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) }, distToPerch: +near.toFixed(2) };
});
check('in the dark it perches on a tall landmark or pylon', perch.state === 'perch' && perch.distToPerch < 0.5 && perch.at.y > 15, perch);
// Near it: electronics fail; the paper map still works.
const near = await page.evaluate(() => {
  const g = __game, p = g.mothman.mesh.position;
  g.mothman.update = () => {};
  g.player.position.set(p.x + 4, g.map.heightAt(p.x + 4, p.z + 4), p.z + 4);
  if (!g.flashlight.on) g.flashlight.toggle(); g.flashlight.battery = 1;
  steps(60);
  g.fieldMap.toggle(true); steps(20);
  const r = { torch: g.interference.state.get('torch')?.status, light: +g.flashlight.light.intensity.toFixed(2), mapOpen: !!g.fieldMap.held };
  g.fieldMap.toggle(false);
  return r;
});
check('under its perch the torch fails, and the paper map and compass still work', near.torch === 'failed' && near.light === 0 && near.mapOpen, near);

// Captures.
await page.evaluate(() => { const g = __game; for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  for (const ch of g.camera.children) if (!ch.isLight) ch.visible = false; g.player.update = () => {}; if (g.flashlight.on) g.flashlight.toggle();
  window.__look = (x, z, tx, ty, tz, up = 1.7) => { const y = g.map.heightAt(x, z) + up; g.camera.position.set(x, y, z); g.camera.lookAt(tx, ty, tz); g.sim.frame(1 / 60); }; });
const snap = async (name, args) => { await page.evaluate((a) => __look(...a), args); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); };
await snap('01-from-the-gate-the-water-tower-over-the-trees', [12, 78, 10, 22, -8]);
await snap('02-junction-signpost-in-the-works-yard', [6, 4, 12.2, 2, 2.2]);
await snap('03-igloo-row-along-the-works-road', [-38, 26, -10, 1, 20]);
await snap('04-slag-hill-overlook', [-55, -25, 10, 8, -8]);
await snap('05-lookout-knob-overlook-pylon-line', [58, -52, 0, 14, -78]);
await snap('06-route-62-gate-and-exit-sign', [10, 72, 6, 2, 84]);
await snap('07-overview-from-above', [0, 150, 0, 0, -10, 90]);

// Exit through the gate.
await page.evaluate(() => { const g = __game; delete g.player.update; for (const el of document.body.children) el.style.visibility = ''; });
const out2 = await page.evaluate(() => { const g = __game, v = g.HUNT.exit; g.hunt.elapsed += 300; g.player.position.set(v.x + 1, g.map.heightAt(v.x + 1, v.z - 1), v.z - 1); steps(5); return { inZone: g.hunt.inZone, exit: g.map.exit.name }; });
await page.keyboard.press('KeyH'); await page.waitForTimeout(300); await page.keyboard.press('KeyH'); await page.waitForTimeout(500);
const end = await page.evaluate(() => { for (let i = 0; i < 30 && __game.hunt.stage !== 'ended'; i++) steps(2); return { stage: __game.hunt.stage }; });
check('the marked road exit (Route 62, through the gate) ends the trip', out2.inZone && end.stage === 'ended', { ...out2, ...end });

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 320)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
