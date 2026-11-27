// Tagging state machine in game (#148). Run: npm run check:t148 [outDir]
// Pine Barrens: the Jersey Devil perches, you tag it (slot 4, Q): Untracked -> Tagged. Staying in
// receiver range, fixes come every 15 s; three make a valid interval (IntervalRecorded). Going out
// of range shows a gap. Drive out: Recovered, and the interval sells as tracking telemetry (EV13).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t148';
mkdirSync(out, { recursive: true });
const PORT = 4448;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 540 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(results.at(-1).slice(0, 420)); };
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const track = () => page.evaluate(() => { const t = __game.tagTrack; return { state: t.state, fixes: t.fixes.map((f) => `${Math.round(f.t)}:${f.counted ? 'ok' : f.why}`), intervals: t.intervals.length, gaps: t.gaps.length }; });

await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=pinebarrens&seed=148&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game, null, { timeout: 240000 });
await page.evaluate(() => { const g = __game; g.expedition.commit(); g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false); g.huntFailure.enabled = false; });
const t0 = await track();

// It perches (after a swoop elsewhere); you're across the nest clearing.
await page.evaluate(() => { const d = __game.jerseyDevil; d.setState('climb', 'test'); d.stateTime = 5; d.pos.set(__game.map.nest.x, 24, __game.map.nest.z + 30); });
for (let i = 0; i < 120; i++) { await steps(15); if (await page.evaluate(() => __game.jerseyDevil.tagWindow)) break; }
await page.evaluate(() => { const g = __game, p = g.player, per = g.jerseyDevil.perch, n = g.map.nest, dx = n.x - per.x, dz = n.z - per.z, d = Math.hypot(dx, dz) || 1;
  p.position.set(per.x + (dx / d) * 18, 0, per.z + (dz / d) * 18); p.velocity.set(0, 0, 0); g.sim.step();
  const e = g.camera.position; p.yaw = Math.atan2(-(per.x - e.x), -(per.z - e.z)); p.pitch = Math.atan2(per.y - e.y, Math.hypot(per.x - e.x, per.z - e.z)); });
await page.keyboard.press('Digit4'); await page.keyboard.press('KeyQ'); await steps(3);
const t1 = await track();
check('before tagging: Untracked; tagging it on the perch (slot 4, Q): Tagged', t0.state === 'Untracked' && t1.state === 'Tagged', { t0: t0.state, t1 });

// Stay near (it patrols the barrens nearby): fixes every 15 s; three make an interval.
await page.evaluate(() => { const d = __game.jerseyDevil; d.patrolPts = [__game.map.nest]; });
await steps(50 * 60);
const t2 = await track();
await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/01-telemetry-interval-recorded.png` });
check('in receiver range, three fixes 15 s apart make one valid telemetry interval (IntervalRecorded)', t2.state === 'IntervalRecorded' && t2.intervals === 1, t2);

// Out of range: the next fixes fail and a gap shows.
await page.evaluate(() => { const g = __game, p = g.player; p.position.set(-140, 0, 140); p.velocity.set(0, 0, 0); g.jerseyDevil.pos.set(g.map.nest.x, 24, g.map.nest.z);   // ~280 m: beyond the 250 m receiver g.jerseyDevil.patrolPts = [g.map.nest]; });
await steps(80 * 60);
const t3 = await track();
check('out of receiver range the fixes fail ("out of receiver range") and the broken watch is recorded as a gap', t3.fixes.some((f) => /out of receiver range/.test(f)) && t3.gaps >= 1, t3);

// Drive out: Recovered; the interval sells as tracking telemetry.
await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); });
await steps(5);
await page.keyboard.press('KeyH'); await steps(2); await page.keyboard.press('KeyH'); await steps(2);
const end = await page.evaluate(() => ({ state: __game.tagTrack.state, payable: __game.tagTrack.payable, sold: (__game.camp.lastHunt?.evidenceSold ?? []).map((e) => `${e.name} $${e.value}`), stage: __game.hunt.stage }));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/02-recovered-telemetry-sold.png` });
check('driving out with it: Recovered, and the valid interval sells as tracking telemetry', end.stage === 'ended' && end.state === 'Recovered' && end.payable && end.sold.some((s) => /Tracking telemetry/.test(s)), end);

check('no page errors', errors.length === 0, errors);
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
