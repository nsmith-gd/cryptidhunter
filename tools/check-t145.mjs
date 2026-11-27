// Electrical interference check (#145, GDD 5.3/5.4 L08). Run: npm run check:t145 [outDir]
// Blackwater Swamp with the Mothman held perched over the boardwalk. Walking toward it: the torch
// flickers, then dies; night vision won't come on; the field recorder cuts out; a trail camera set
// near it goes dead while one far away keeps working (no global shutdown). The film camera still
// takes the picture and the paper map and compass still work. Walk back out: everything returns.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t145';
mkdirSync(out, { recursive: true });
const PORT = 4545;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };



await page.goto(`http://localhost:${PORT}/?map=swamp&simpaused&nodebugai&seed=5`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=swamp&simpaused&nodebugai&seed=5`);
await page.waitForFunction(() => window.__game?.interference, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  g.mothman.update = () => {}; g.chupacabra.update = () => {}; g.chupacabra.mesh.position.set(-45, 0.3, 45);
  window.M = { x: 0, y: 5, z: -2 };                 // perched over the north spine, near the island
  g.mothman.mesh.position.set(M.x, M.y, M.z); g.mothman.mesh.visible = true;
  if (!g.flashlight.on) g.flashlight.toggle();
  g.flashlight.battery = 1; g.fieldKit.carried.fieldRecorder = 1;
  window.at = (z) => { const p = g.player; p.position.set(0, 0.34, z); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = Math.atan2(M.y - 1.9, z - M.z); steps(30); };
  window.read = () => ({ level: +g.interference.level({ x: g.player.position.x, y: g.player.position.y + 1.4, z: g.player.position.z }).toFixed(2),
    torch: g.interference.state.get('torch')?.status, light: +g.flashlight.light.intensity.toFixed(2), nvg: g.nightVision.on, nvgJammed: !!g.nightVision.jammed, rec: !!g.fieldKit.recording });
});
// Two trail cameras: one by the island under the Mothman, one far south at the spawn dock.
const cams = await page.evaluate(() => {
  const g = __game, tc = g.trailCams;
  tc.carried = Math.max(2, tc.carried ?? 2);
  g.player.position.set(0, 0.34, 1); g.player.yaw = 0; tc.place?.(); 
  g.player.position.set(0, 0.34, 42); g.player.yaw = Math.PI; tc.place?.();
  return tc.cams.map((c) => ({ id: c.id, z: Math.round(c.group.position.z) }));
});
const far = await page.evaluate(() => { at(42); __game.fieldKit.toggleRecorder(true); steps(30); return read(); });
check('far from it (40 m+) everything works: torch on, recorder running', far.torch === 'ok' && far.light > 1 && far.rec, far);
const edge = await page.evaluate(() => { const out = []; for (let z = 40; z >= 6; z -= 2) { at(z); out.push({ z, ...read() }); } return out; });
const firstFlicker = edge.find((e) => e.torch === 'flicker'), firstFail = edge.find((e) => e.torch === 'failed');
check('walking toward it, the torch flickers at the edge of the field, then dies close in', firstFlicker && firstFail && firstFlicker.z > firstFail.z && edge.filter((e) => e.torch === 'flicker').some((e) => e.light < far.light * 0.3),
  { flickerFrom: firstFlicker?.z, failAt: firstFail?.z, sample: edge.filter((_, i) => i % 3 === 0).map((e) => [e.z, e.torch, e.light]) });
await page.screenshot({ path: `${out}/01-torch-dead-under-the-mothman.png` });
const near = await page.evaluate(() => { const g = __game; at(4); g.nightVision.toggle(true); steps(5); return { ...read(), trace: g.interference.trace.slice(0, 6) }; });
check('close to it night vision only shows static and the field recorder cuts out', !near.nvg && near.nvgJammed && !near.rec, near);
const camState = await page.evaluate(() => __game.trailCams.cams.map((c) => ({ id: c.id, z: Math.round(c.group.position.z), jammed: !!c.jammed })));
check('no global shutdown: the trail camera under it is dead, the one at the dock still works', camState.length === 2 && camState.find((c) => c.z < 10)?.jammed && !camState.find((c) => c.z > 30)?.jammed, camState);
// Analogue: film camera and paper map.
const analogue = await page.evaluate(() => {
  const g = __game; at(6);
  g.photo.wantRaised = true; for (let i = 0; i < 200 && !g.photo.raised; i++) steps(1); steps(20);
  const e = g.photo.snap(); g.photo.wantRaised = false; steps(5);
  g.fieldMap.toggle(true); steps(30);
  return { photo: e && { result: e.result, subject: e.subject }, mapOpen: !!g.fieldMap.held, torch: g.interference.state.get('torch').status };
});
await page.screenshot({ path: `${out}/02-paper-map-and-compass-still-work-under-it.png` });
await page.evaluate(() => __game.fieldMap.toggle(false));
check('analogue tools keep working in the field: the film camera takes the picture, the paper map and compass open', analogue.photo?.result === 'HIT' && analogue.photo.subject === 'Mothman' && analogue.mapOpen && analogue.torch === 'failed', analogue);
// Walk back out of range: everything returns.
const back = await page.evaluate(() => { const g = __game; at(44); steps(120); const camsWhileThere = g.trailCams.cams.map((c) => !!c.jammed);
  g.mothman.mesh.position.set(60, 12, -45); steps(120);   // then it flies off
 g.nightVision.toggle(true); steps(5); const r = read(); g.nightVision.toggle(false); g.fieldKit.toggleRecorder(true);
  return { ...r, recAgain: !!g.fieldKit.recording, camsWhileThere, cams: g.trailCams.cams.map((c) => !!c.jammed), trace: g.interference.trace.filter((e) => e.id === 'torch').map((e) => `${e.to}@${e.level}`) }; });
check('walking out of range restores your devices: torch, night vision, recorder', back.torch === 'ok' && back.light > 1 && back.nvg && back.recAgain, back);
check('the trail camera under it stays dead while the Mothman is there, and works again once it flies off', back.camsWhileThere[0] === true && back.cams.every((j) => !j), { whileThere: back.camsWhileThere, after: back.cams });
await page.evaluate(() => { at(44); });
await page.screenshot({ path: `${out}/03-back-out-of-range-torch-restored.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 320)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
