// Dread and stalking pass checks for the L01–L03 playtest (#134). Run: npm run check:t134 [outDir]
//   L02 Oro-Medonte  dread rises with time out and with distance from the car, and falls on return;
//                    the stalking creature (the Sidehill Gouger) is seen at least once; nothing attacks.
//   L01 tunnels      the tunnel creature is seen at least once; nothing attacks.
//   L03 Lake Simcoe  the Igopogo is seen at least once; nothing attacks.
// "Seen" is what a player would see: a scan (look around every few seconds) where the creature is in the
// camera's view, within 60 m, with nothing solid in the way. Results go to dread-and-stalking.json.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || '.ballast/media/t134';
mkdirSync(out, { recursive: true });
const PORT = 4434;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const report = {};
// In-page helpers: a player-eye visibility test and a look-around scan.
const HELPERS = `
  window.__seenTest = (g, getMesh, colliders) => {
    const THREE = g.THREE ?? window.THREE, cam = g.camera;
    const m = getMesh(); if (!m || !m.visible) return false;
    m.updateMatrixWorld(true);
    const c = new THREE.Vector3(); new THREE.Box3().setFromObject(m).getCenter(c);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const eye = cam.getWorldPosition(new THREE.Vector3());
    if (!f.containsPoint(c) || eye.distanceTo(c) > 60) return false;
    const dir = c.clone().sub(eye), len = dir.length(), ray = new THREE.Ray(eye, dir.normalize()), hit = new THREE.Vector3();
    for (const b of colliders) if (!b.containsPoint(eye) && !b.containsPoint(c) && ray.intersectBox(b, hit) && hit.distanceTo(eye) < len - 0.5) return false;
    return true;
  };
  window.__scan = (g, getMesh, colliders, setYaw, step) => { let seen = 0; for (let k = 0; k < 16; k++) { setYaw((k / 16) * Math.PI * 2); step(); if (__seenTest(g, getMesh, colliders)) seen++; } return seen; };
`;

// ---- L02 Oro-Medonte: dread and the Gouger -----------------------------------------------------------
await page.goto(`http://localhost:${PORT}/?map=oromedonte&simpaused&nodebugai&seed=21`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=oromedonte&simpaused&nodebugai&seed=21`);
await page.waitForFunction(() => window.__game?.dread, null, { timeout: 120000 });
await page.evaluate(HELPERS);
const l02 = await page.evaluate(() => {
  const g = __game, P = g.player, L = g.map.landmarks, D = g.dread, car = g.HUNT.exit;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = true;
  const steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  const comfort = () => { const s = g.survival; s.nutrition.energy = 90; s.thermo.core = 37; if (s.hydration) s.hydration.value = 90; s.fatigue.value = 10; };
  const health0 = g.survival.health.value, dmg0 = g.survival.health.log.length;
  const gouger = () => g.cryptids.cryptids[0]?.mesh;
  const dist = () => Math.hypot(P.position.x - car.x, P.position.z - car.z);
  let seenFrames = 0, scans = 0;
  const scanNow = () => { scans++; const y0 = P.yaw; seenFrames += __scan(g, gouger, g.map.colliders, (y) => { P.yaw = y; }, () => { g.sim.frame?.(0); P.camera?.updateMatrixWorld?.(); g.camera.updateMatrixWorld(); g.player.update?.(0); }); P.yaw = y0; };
  if (!g.flashlight.on) g.flashlight.toggle();
  const walk = (to, speed = 1.3, log) => { for (let i = 0; i < 60 * 600; i++) { const dx = to.x - P.position.x, dz = to.z - P.position.z, d = Math.hypot(dx, dz); if (d < 0.5) break; const k = Math.min(1, (speed / 60) / d); P.position.x += dx * k; P.position.z += dz * k; P.velocity.set(0, 0, 0); P.yaw = Math.atan2(-dx, -dz); steps(1); g.flashlight.battery = 1; if (i % 300 === 0) { comfort(); log?.(); } if (i % 600 === 0) scanNow(); } };
  const samples = [];
  const sample = (tag) => samples.push({ t: +D.time.toFixed(0), tag, dist: Math.round(dist()), dread: +D.value.toFixed(1) });
  // Near: 4 minutes standing 20 m from the car (outside its safe ring). Far: 4 minutes ~200 m out.
  P.position.set(car.x + 14, 0, car.z - 14); steps(5); sample('near start');
  for (let i = 0; i < 4; i++) { steps(60 * 60); comfort(); scanNow(); sample('near'); }
  const nearGain = samples.at(-1).dread - samples[0].dread;
  walk(L.meadow, 1.6, () => sample('walking out'));
  const farStart = D.value; sample('far start');
  for (let i = 0; i < 4; i++) { steps(60 * 60); comfort(); scanNow(); sample('far'); }
  const farGain = D.value - farStart;
  const peak = D.value;
  walk({ x: car.x + 2, z: car.z + 1 }, 2.2, () => sample('walking back'));
  const atCar0 = D.value;
  for (let i = 0; i < 6; i++) { steps(60 * 10); sample('at the car'); }
  const atCar1 = D.value;
  const harmed = g.survival.health.log.slice(dmg0).filter((e) => /gouger|creature|charge|attack|maul/i.test(e.cause ?? ''));
  return { nearGain: +nearGain.toFixed(1), farGain: +farGain.toFixed(1), peak: +peak.toFixed(1), atCar0: +atCar0.toFixed(1), atCar1: +atCar1.toFixed(1), samples, seenFrames, scans, caught: g.huntFailure.isCaught, harmed, health0, health: g.survival.health.value, stage: D.stage };
});
report.L02 = l02;
check('L02 dread rises with time out (it keeps climbing while you stay out)', l02.samples.filter((s) => s.tag === 'far').every((s, i, a) => i === 0 || s.dread >= a[i - 1].dread) && l02.farGain > 0, l02.samples.filter((s) => s.tag !== 'walking out' && s.tag !== 'walking back'));
check('L02 dread rises faster far from the car than near it (same 4 minutes)', l02.farGain > l02.nearGain * 1.3, { nearGain: l02.nearGain, farGain: l02.farGain });
check('L02 dread falls when you get back to the car', l02.atCar1 < l02.atCar0 - 5, { arrived: l02.atCar0, after60s: l02.atCar1, peak: l02.peak });
check('L02 the stalking creature (the Sidehill Gouger) is seen at least once in the run', l02.seenFrames >= 1, { seenFrames: l02.seenFrames, scans: l02.scans });
check('L02 no creature attacks', !l02.caught && l02.harmed.length === 0, { caught: l02.caught, harmed: l02.harmed });

// ---- L01 tunnels: the tunnel creature ------------------------------------------------------------------
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
  Element.prototype.requestPointerLock = function () { locked = this; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
  Document.prototype.exitPointerLock = function () { if (!locked) return; locked = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
});
await page.goto(`http://localhost:${PORT}/tunnel.html?gym&seed=101`);
await page.waitForFunction(() => window.__l01, null, { timeout: 90000 });
await page.click('#l01-overlay');
await page.waitForFunction(() => __l01.input.locked, null, { timeout: 10000 });
await page.evaluate(HELPERS);
const l01 = await page.evaluate(() => {
  const g = __l01, c = g.creature, CELL = 4, w = (cx, cy) => ({ x: (cx - 32 + 0.5) * CELL, z: (cy - 24 + 0.5) * CELL });
  const health0 = g.health;
  const p = w(38, 10); g.player.position.set(p.x, 0, p.z); g.player.yaw = -Math.PI / 2; g.player.pitch = 0;
  if (g.flashlight.on) g.flashlight.toggle();
  let seenFrames = 0, scans = 0;
  for (let t = 0; t < 60 * 150; t++) {
    g.sim.step();
    if (t % 180 === 0) { scans++; const y0 = g.player.yaw; seenFrames += __scan(g, () => c.mesh, g.map.colliders, (y) => { g.player.yaw = y; }, () => { g.player.update?.(0); g.camera.updateMatrixWorld(); }); g.player.yaw = y0; }
  }
  return { seenFrames, scans, showings: c.events.filter((e) => e.type === 'showing').length, health0, health: g.health };
});
report.L01 = l01;
check('L01 the tunnel creature is seen at least once in the run', l01.seenFrames >= 1, l01);
check('L01 no creature attacks (health untouched)', l01.health === l01.health0, { health0: l01.health0, health: l01.health });

// ---- L03 Lake Simcoe: the Igopogo ----------------------------------------------------------------------
await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=21&nozones`);
await page.waitForFunction(() => window.__game?.igopogo, null, { timeout: 120000 });
await page.evaluate(HELPERS);
const l03 = await page.evaluate(() => {
  const g = __game, P = g.player, I = g.igopogo;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = true;
  const o = g.map.observation[0]; P.position.set(o.x, g.map.heightAt(o.x, o.z), o.z);
  const dmg0 = g.survival.health.log.length;
  let seenFrames = 0, scans = 0;
  for (let t = 0; t < 60 * 600; t++) {
    g.sim.step(); P.velocity.set(0, 0, 0);
    if (t % 600 === 0) { const s = g.survival; s.nutrition.energy = 90; s.thermo.core = 37; if (s.hydration) s.hydration.value = 90; s.fatigue.value = 10; }
    if (t % 120 === 0) { scans++; const y0 = P.yaw; seenFrames += __scan(g, () => I.mesh, g.map.colliders, (y) => { P.yaw = y; }, () => { P.update?.(0); g.camera.updateMatrixWorld(); }); P.yaw = y0; }
  }
  const harmed = g.survival.health.log.slice(dmg0).filter((e) => /igopogo|creature|attack/i.test(e.cause ?? ''));
  return { seenFrames, scans, windows: I.schedule.windows.length, caught: g.huntFailure.isCaught, harmed };
});
report.L03 = l03;
check('L03 the Igopogo is seen at least once in the run (quiet waiting at the Point)', l03.seenFrames >= 1, l03);
check('L03 no creature attacks', !l03.caught && l03.harmed.length === 0, { caught: l03.caught, harmed: l03.harmed });

writeFileSync(`${out}/dread-and-stalking.json`, JSON.stringify(report, null, 1));
// A dread curve for the report (SVG; the check renders it).
const S = l02.samples, W = 760, H = 300, tMax = Math.max(...S.map((s) => s.t)), X = (t) => 50 + (t / tMax) * (W - 70), Y = (v) => H - 40 - (v / 100) * (H - 70);
const col = { 'near start': '#7fb0ff', near: '#7fb0ff', 'walking out': '#c8c8c8', 'far start': '#ff9a5a', far: '#ff9a5a', 'walking back': '#c8c8c8', 'at the car': '#7fdc8a' };
writeFileSync(`${out}/dread-curve.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#11151a;font-family:monospace"><rect width="${W}" height="${H}" fill="#11151a"/>
<polyline points="${S.map((s) => `${X(s.t)},${Y(s.dread)}`).join(' ')}" fill="none" stroke="#888" stroke-width="1.5"/>
${S.map((s) => `<circle cx="${X(s.t)}" cy="${Y(s.dread)}" r="4" fill="${col[s.tag]}"/>`).join('')}
<text x="50" y="22" fill="#ddd" font-size="11">L02 dread over one run: near the car (blue), far out at the meadow (orange), back at the car (green)</text>
<text x="10" y="${Y(0) + 4}" fill="#999" font-size="11">0</text><text x="4" y="${Y(100) + 4}" fill="#999" font-size="11">100</text>
<text x="${W - 120}" y="${H - 12}" fill="#999" font-size="11">time out (s) →</text></svg>`);
check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 340)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
