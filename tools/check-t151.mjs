// Routine memory check (#151, GDD 5.4 L10 / 5.7). Run: npm run check:t151 [outDir]
// The test yard with the Dogman proxy (?dogman) standing watch. A tent pitched where it can see it
// is remembered and later checked. A route walked once in its view is learned; walked twice, it
// goes to wait on it. A route walked behind it (never seen) is never anticipated. Memories fade.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t151';
mkdirSync(out, { recursive: true });
const PORT = 4551;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };



await page.goto(`http://localhost:${PORT}/?map=test&dogman&simpaused&nodebugai&seed=11`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=test&dogman&simpaused&nodebugai&seed=11`);
await page.waitForFunction(() => window.__game?.dogman, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  g.cryptids.update = () => {}; for (const c of g.cryptids.cryptids) { c.mesh.visible = false; c.agent.x = 200; }
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  const D = g.dogman; D.position.set(0, 0, 0); D.heading = 0; D.mesh.rotation.y = 0;   // looking toward +z
  window.walkTo = (to, speed = 1.4) => { const p = g.player; for (let i = 0; i < 9000; i++) { const dx = to.x - p.position.x, dz = to.z - p.position.z, d = Math.hypot(dx, dz); if (d < 0.2) break; const k = Math.min(1, (speed / 60) / d); p.position.x += dx * k; p.position.z += dz * k; p.velocity.set(0, 0, 0); p.yaw = Math.atan2(-dx, -dz); steps(1); } };
  window.tp = (x, z) => { g.player.position.set(x, 0, z); g.player.velocity.set(0, 0, 0); steps(1); };
  window.routeA = [{ x: -15, z: 22 }, { x: 15, z: 22 }];        // in front of it: in view
  window.routeB = [{ x: -15, z: -24 }, { x: 15, z: -24 }];      // behind it: never in view
  window.st = () => { const D = g.dogman; return { state: D.state, at: { x: +D.position.x.toFixed(1), z: +D.position.z.toFixed(1) }, legs: D.memory.legs.length, camps: D.memory.spots.filter((s) => s.kind === 'camp').length, log: D.log.slice(-2) }; };
});
// 1. A tent pitched where it can see it: remembered, and later checked.
const camp = await page.evaluate(() => {
  const g = __game, fc = g.fieldCamp;
  g.fieldKit.carried.tent = 1;
  tp(8, 14); g.player.yaw = Math.PI;           // pitch toward +z (behind you)
  fc.use(); steps(60 * 7);
  const tent = fc.tent && { x: +fc.tent.x.toFixed(1), z: +fc.tent.z.toFixed(1) };
  tp(-30, 40);                                 // walk away out of its sight
  steps(60 * 50);
  const D = g.dogman;
  return { tent, saw: D.log.some((e) => e.what === 'saw a camp'), checked: D.log.some((e) => e.what === 'goes to check a camp it saw'), reached: tent && Math.hypot(D.position.x - tent.x, D.position.z - tent.z) < 2.5, ...st() };
});
check('a camp it saw is remembered, and it goes to check it later', camp.tent && camp.saw && camp.checked && camp.reached, camp);
await page.evaluate(() => { const g = __game, D = g.dogman; D.position.set(0, 0, 0); D.heading = 0; D.mesh.rotation.y = 0; D.state = 'watch'; D.target = null; D.campClock = 1e9; });
// 2. Route A once in its view: learned, but not yet worth waiting on.
const once = await page.evaluate(() => { tp(routeA[0].x, routeA[0].z); walkTo(routeA[1]); steps(60); const g = __game; return { ...st(), predict: g.dogman.memory.predictNext(-5, 22), ambush: g.dogman.memory.ambushSpot() }; });
check('a route walked once in its view is learned (it can predict your next leg) but it does not wait on it yet', once.legs >= 3 && once.predict && once.ambush === null && once.state === 'watch', once);
// 3. Route B, twice, behind it: never seen, never anticipated.
const unseen = await page.evaluate(() => { for (let k = 0; k < 2; k++) { tp(routeB[0].x, routeB[0].z); walkTo(routeB[1]); } steps(60); const g = __game; return { ...st(), predictB: g.dogman.memory.predictNext(-5, -24), ambush: g.dogman.memory.ambushSpot() }; });
check('a route it never saw you use (behind it, twice) is not anticipated', unseen.predictB === null && unseen.ambush === null && unseen.state === 'watch', unseen);
// 4. Route A a second time: it goes to wait on route A.
const twice = await page.evaluate(() => { tp(routeA[0].x, routeA[0].z); walkTo(routeA[1]); tp(-30, 60); steps(60 * 15); return st(); });
check('walked twice in its view, it goes and waits on that route (route A, not B)', twice.state === 'ambush' && Math.abs(twice.at.z - 22) < 3 && twice.at.x > -16 && twice.at.x < 16, twice);
await page.evaluate(() => { const g = __game; for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden'; g.player.update = () => {};
  const D = g.dogman.position; g.camera.position.set(D.x + 10, 4, D.z + 12); g.camera.lookAt(D.x, 1.5, D.z); g.sim.frame(1 / 60); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/01-waiting-on-the-route-it-watched-you-use.png` });
await page.evaluate(() => { const g = __game; delete g.player.update; for (const el of document.body.children) el.style.visibility = ''; });
// 5. Memories fade: after long enough unseen, it forgets and stops waiting.
const faded = await page.evaluate(() => { const g = __game; tp(-60, 70); steps(60 * 460); return { ...st(), legs: g.dogman.memory.legs.length }; });
check('route memories fade: long unseen, it forgets the route and stops waiting there', faded.state === 'watch' && faded.legs === 0, faded);
const log = await page.evaluate(() => __game.dogman.log);
console.log('LOG ' + JSON.stringify(log));
await page.evaluate((l) => {}, log);

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 320)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
