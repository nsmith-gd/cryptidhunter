// Igopogo and Old Yellow Top stalking behaviours (#133, GDD 5.4 rows 03 and 04). Run: npm run check:t133 [outDir]
// Lake Simcoe: walking the beach quietly at night, the Igopogo shadows you from deep water; its surfacing
// calls (recorded) and leaves a shore trace; it can be photographed; disturbed, it dives and pulls away.
// Cobalt gym: Old Yellow Top abandons a path once disturbed twice, follows you between two camera sites
// (and is caught on camera), and explores your unattended camp. Neither ever attacks.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t133';
mkdirSync(out, { recursive: true });
const PORT = 4533;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };



const setup = async (map) => {
  await page.goto(`http://localhost:${PORT}/?map=${map}&simpaused&nodebugai&seed=33&nozones`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${PORT}/?map=${map}&simpaused&nodebugai&seed=33&nozones`);
  await page.waitForFunction(() => window.__game?.map, null, { timeout: 120000 });
  await page.evaluate(() => {
    const g = __game;
    g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
    window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
    window.comfort = () => { const s = g.survival; s.fatigue.value = 10; s.nutrition.energy = 90; s.thermo.core = 37; if (s.hydration) s.hydration.value = 90; s.health.value = Math.max(s.health.value, 100); };
    window.walkTo = (to, speed = 1.2) => { const p = g.player; for (let i = 0; i < 60 * 300; i++) { const dx = to.x - p.position.x, dz = to.z - p.position.z, d = Math.hypot(dx, dz); if (d < 0.3) break; const k = Math.min(1, (speed / 60) / d); p.position.x += dx * k; p.position.z += dz * k; p.position.y = g.map.heightAt ? g.map.heightAt(p.position.x, p.position.z) : 0; p.velocity.set(0, 0, 0); p.yaw = Math.atan2(-dx, -dz); g.player.noise = 0; steps(1); if (i % 600 === 0) comfort(); } };
    window.health0 = g.survival.health.value;
  });
};

// ---- A. Igopogo, Lake Simcoe -------------------------------------------------------------------------
await setup('simcoe');
const ig = await page.evaluate(() => {
  const g = __game, I = g.igopogo, shoreZ = (x) => { for (let z = -60; z < 60; z += 0.5) if (g.map.heightAt(x, z) > 0.05) return z; return 0; };
  g.fieldKit.carried.fieldRecorder = 1; g.fieldKit.toggleRecorder(true);
  const samples = [];
  // Walk the beach back and forth, quietly, for a good while.
  const legs = [[-40, 30], [30, -40], [-40, 30]];
  for (const [a, b] of legs) for (let x = a; a < b ? x <= b : x >= b; x += a < b ? 5 : -5) {
    walkTo({ x, z: shoreZ(x) + 3 });
    const p = I.pos, P = g.player.position;
    samples.push({ px: +P.x.toFixed(1), ix: +p.x.toFixed(1), d: +Math.hypot(p.x - P.x, p.z - P.z).toFixed(1), deep: g.map.heightAt(p.x, p.z) < -1.5, up: I.schedule.state === 'up' });
  }
  const recs = g.evidence.items.filter((i) => i.type === 'audioRecording').map((i) => ({ name: i.name, cryptid: i.cryptid }));
  const traces = g.clues.clues.filter((c) => c.type === 'shoreTrace').map((c) => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1) }));
  return { samples, recs, traces, log: (I.log ?? []).slice(0, 8), windows: I.schedule.windows.length };
});
const follow = ig.samples.filter((s) => !s.up);
const tracked = follow.filter((s) => s.d <= 30).length / Math.max(1, follow.length);
const corr = (() => { const n = follow.length, mx = follow.reduce((a, s) => a + s.px, 0) / n, my = follow.reduce((a, s) => a + s.ix, 0) / n; let c = 0, vx = 0, vy = 0; for (const s of follow) { c += (s.px - mx) * (s.ix - my); vx += (s.px - mx) ** 2; vy += (s.ix - my) ** 2; } return c / Math.sqrt(vx * vy); })();
check('Igopogo follows your shoreline movement from the water at night (its position along the shore tracks yours; always in deep water)', tracked > 0.8 && corr > 0.8 && ig.samples.every((s) => s.deep), { tracked: +tracked.toFixed(2), correlation: +corr.toFixed(2), sample: ig.samples.slice(0, 5) });
check('its listed evidence: calls (recorded on the field recorder) and shore traces at the water\'s edge', ig.recs.some((r) => r.cryptid === 'Igopogo') && ig.traces.length >= 1, { recordings: ig.recs, traces: ig.traces, windows: ig.windows });
// Surface photo, then disturb it.
const ph = await page.evaluate(() => {
  const g = __game, I = g.igopogo;
  for (let i = 0; i < 60 * 600 && I.riseLevel < 1; i++) { steps(1); if (i % 600 === 0) comfort(); g.player.noise = 0; }
  const h = new g.THREE.Vector3(); I.mesh.updateMatrixWorld(true); I.head.getWorldPosition(h);
  const P = g.player.position, eye = P.y + 1.6;
  g.player.yaw = Math.atan2(-(h.x - P.x), -(h.z - P.z)); g.player.pitch = Math.atan2(h.y - 0.5 - eye, Math.hypot(h.x - P.x, h.z - P.z));
  g.photo.wantRaised = true; for (let i = 0; i < 200 && !g.photo.raised; i++) steps(1); steps(20);
  const e = g.photo.snap(); g.photo.wantRaised = false;
  const d0 = Math.hypot(I.pos.x - P.x, I.pos.z - P.z);
  for (let i = 0; i < 60 * 3; i++) { g.player.noise = 1; g.player.noiseRadius = 20; steps(1); }
  for (let i = 0; i < 60 * 20; i++) steps(1);
  const d1 = Math.hypot(I.pos.x - P.x, I.pos.z - P.z);
  return { photo: e && { result: e.result, subject: e.subject }, d0: +d0.toFixed(1), d1: +d1.toFixed(1), withdrew: (I.log ?? []).some((x) => x.type === 'withdraw'), state: I.schedule.state };
});
check('a surface photo is possible from shore', ph.photo?.result === 'HIT' && ph.photo.subject === 'Igopogo', ph.photo);
check('disturbed (a noisy shore), it dives and pulls away from you', ph.withdrew && ph.state === 'down' && ph.d1 > ph.d0 + 10, ph);
const igSafe = await page.evaluate(() => ({ caught: __game.huntFailure.isCaught, health: __game.survival.health.value }));
check('the Igopogo never attacks', !igSafe.caught && igSafe.health >= 99, igSafe);
await page.evaluate(() => { const g = __game, I = g.igopogo; for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden'; g.player.update = () => {}; });

// ---- B. Old Yellow Top, Cobalt gym --------------------------------------------------------------------
await setup('cobaltgym');
const oy1 = await page.evaluate(() => {
  const g = __game, O = g.oyt;
  // It starts on the logging road. Stand on the road ahead of it twice: the road is disturbed twice.
  const road = O.routes.find((r) => r.id === 'road');
  for (let k = 0; k < 2; k++) {
    O.position.set(-30, 0, -31); O.state = 'roam'; O.route = road; O.i = 1; O.dir = 1; O.t += 40;
    g.player.position.set(-18, 0, -32); g.player.noise = 0; steps(60 * 3);
    g.player.position.set(0, 0, 44); steps(30);
  }
  steps(60 * 5);
  return { route: O.route?.name, disturbance: Object.fromEntries(O.routes.map((r) => [r.name, r.disturbance])), log: O.log.slice(-4) };
});
check('Old Yellow Top avoids a route disturbed twice: it switches to another path', oy1.disturbance['the logging road'] >= 2 && oy1.route !== 'the logging road', oy1);
const oy2 = await page.evaluate(() => {
  const g = __game, O = g.oyt, tc = g.trailCams, C = g.map.camSites;
  tc.carried = 2;
  tc.place({ x: C[0].x, z: C[0].z }, -Math.PI / 2);       // camera A faces east, along the line between the sites
  tc.place({ x: C[1].x, z: C[1].z }, Math.PI / 2);        // camera B faces west
  g.player.position.set(C[0].x + 4, 0, C[0].z); steps(5);
  O.position.set(C[0].x - 18, 0, C[0].z + 1); O.state = 'roam'; steps(30);
  const startState = O.state;
  const ds = [];
  for (let x = C[0].x + 4; x <= C[1].x - 3; x += 3) { walkTo({ x, z: C[0].z }); ds.push(+Math.hypot(O.position.x - g.player.position.x, O.position.z - g.player.position.z).toFixed(1)); }
  steps(60 * 20);
  const camEvents = tc.cams.flatMap((c) => c.photos.filter((p) => p.subject === 'Old Yellow Top').map(() => c.id));
  return { startState, state: O.state, ds, camEvents };
});
check('with cameras set out, it follows you between the camera sites at a distance (never closing in)', oy2.startState === 'stalk' && Math.min(...oy2.ds) >= 15 && Math.max(...oy2.ds) <= 50, oy2);
check('its evidence: remote camera events (a trail camera caught it)', oy2.camEvents.length >= 1, oy2.camEvents);
const oy3 = await page.evaluate(() => {
  const g = __game, O = g.oyt, fc = g.fieldCamp, C = g.map.landmarks.camp;
  O.state = 'roam'; O.pickRoute();
  g.fieldKit.carried.tent = 1;
  g.player.position.set(C.x, 0, C.z + 2); g.player.yaw = Math.PI; fc.use(); steps(60 * 7);
  const tent = !!fc.tent;
  g.player.position.set(40, 0, 46); g.player.noise = 0;                          // walk well away (out of sight)
  O.position.set(C.x - 25, 0, C.z - 10);
  for (let i = 0; i < 60 * 90 && !O.campDone; i++) { steps(1); if (i % 600 === 0) comfort(); }
  return { tent, tentStill: !!fc.tent, explored: O.log.some((e) => /explores the camp/.test(e.what)), left: !!O.campDone, hairNearCamp: O.hair.some((h) => Math.hypot(h.x - C.x, h.z - C.z) < 6), prints: O.prints.length, hair: O.hair.length };
});
check('it explores your unattended camp, touches nothing, and leaves (hair by the tent)', oy3.tent && oy3.tentStill && oy3.explored && oy3.left && oy3.hairNearCamp, oy3);
check('its evidence: tracks and hair along its paths', oy3.prints >= 10 && oy3.hair >= 2, { prints: oy3.prints, hair: oy3.hair });
const oySafe = await page.evaluate(() => ({ caught: __game.huntFailure.isCaught, health: __game.survival.health.value }));
check('Old Yellow Top never attacks', !oySafe.caught && oySafe.health >= 99, oySafe);
await page.evaluate(() => { const g = __game, O = g.oyt.position, C = g.map.landmarks.camp; for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.player.update = () => {}; g.oyt.position.set(C.x + 1.5, 0, C.z + 1.5); g.camera.position.set(C.x + 7, 2.5, C.z + 8); g.camera.lookAt(C.x, 1.2, C.z); g.sim.frame(1 / 60); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/02-old-yellow-top-at-your-unattended-camp.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 330)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
