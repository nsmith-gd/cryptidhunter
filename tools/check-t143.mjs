// Scent trail following check (#143, GDD 5.3/5.4 L07). Run: npm run check:t143 [outDir]
// In the test yard with the scent-follower proxy (?howler): carrying sealed food leaves nothing,
// so it notices nothing. Bleeding, you walk an L-shaped route: blood drops every few seconds. The
// proxy strikes the old end of the trail downwind and follows it drop by drop round the corner -
// your actual route, not a beeline to you. Bandage the wound and walk on: the trail breaks and it
// casts about at the last drop, then loses you. Water (on the swamp) carries scent off.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t143';
mkdirSync(out, { recursive: true });
const PORT = 4543;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };



await page.goto(`http://localhost:${PORT}/?map=test&howler&simpaused&nodebugai&seed=4`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=test&howler&simpaused&nodebugai&seed=4`);
await page.waitForFunction(() => window.__game?.howler, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  g.cryptids.update = () => {}; for (const c of g.cryptids.cryptids) c.mesh.visible = false;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  g.scent.setWind({ x: 1, z: 0, speed: 1.5 });     // blowing east
  window.S = { x: 10, z: 10 };                    // the route: west 28 m, then north 28 m
  window.route = [S, { x: S.x - 28, z: S.z }, { x: S.x - 28, z: S.z - 28 }];
  g.howler.position.set(S.x + 9, 0, S.z);         // just downwind of where you set off
  window.walkTo = (to, speed = 1.4) => {
    const p = g.player;
    for (let i = 0; i < 6000; i++) {
      const dx = to.x - p.position.x, dz = to.z - p.position.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      const k = Math.min(1, (speed / 60) / d);
      p.position.x += dx * k; p.position.z += dz * k; p.velocity.set(0, 0, 0);
      p.yaw = Math.atan2(-dx, -dz);
      steps(1);
    }
  };
  const p = g.player; p.position.set(S.x, 0, S.z);
});
// 1. Sealed food in the pack, no wound: walk the route; nothing for it to smell.
const quiet = await page.evaluate(() => {
  const g = __game;
  walkTo(route[1]); walkTo(route[0]);
  return { traces: g.scent.traces.length, state: g.howler.state, food: g.survival.nutrition?.food ?? null };
});
check('carrying food in your pack (not eating) and not bleeding leaves no scent: it notices nothing', quiet.traces === 0 && quiet.state === 'idle', quiet);

// 2. Bleeding: walk the L. It follows the actual trail.
const follow = await page.evaluate(() => {
  const g = __game, p = g.player;
  p.position.set(S.x, 0, S.z);
  g.survival.health.injure({ cause: 'a fall onto rock', damage: 5, wound: 'bleeding', severity: 'light' });
  g.survival.health.firstAid = Math.max(1, g.survival.health.firstAid ?? 0);
  walkTo(route[1]); walkTo(route[2]);
  const drops = g.scent.records().filter((r) => r.kind === 'blood');
  // Wait (standing still, bleeding) while it works the trail.
  for (let i = 0; i < 60 * 40 && g.howler.state !== 'lost' && g.howler.state !== 'casting'; i++) { steps(1); if (i % 60 === 0) g.survival.health.value = 100; }
  const H = g.howler;
  return { drops: drops.length, state: H.state, path: H.tracker.path.length, trail: H.trail, log: H.tracker.log.slice(0, 4).concat(H.tracker.log.slice(-2)) };
});
const dist = (p, a, b) => { const abx = b.x - a.x, abz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz))); return Math.hypot(p.x - a.x - abx * t, p.z - a.z - abz * t); };
const route = [{ x: 10, z: 10 }, { x: -18, z: 10 }, { x: -18, z: -18 }];
const off = Math.max(...follow.trail.filter((p) => p.x < 10).map((p) => Math.min(dist(p, route[0], route[1]), dist(p, route[1], route[2]))));
const corner = Math.min(...follow.trail.map((p) => Math.hypot(p.x - route[1].x, p.z - route[1].z)));
console.log('LOG', JSON.stringify(follow.log));
check('bleeding leaves a trail of blood drops along your route', follow.drops >= 12, follow.drops);
check('it strikes the trail downwind and follows it drop by drop, round the corner: your route, not a beeline', follow.path >= 10 && corner < 2 && off < 2.5, { checked: follow.path, cornerDist: +corner.toFixed(2), maxOffRoute: +off.toFixed(2), state: follow.state });
await page.evaluate(() => { const g = __game; for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.player.update = () => {}; const h = g.howler.position; g.camera.position.set(h.x + 6, 4, h.z + 8); g.camera.lookAt(h.x, 0.5, h.z); g.sim.frame(1 / 60); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/01-following-the-blood-trail.png` });
await page.evaluate(() => { const g = __game; delete g.player.update; for (const el of document.body.children) el.style.visibility = ''; });

// 3. Bandage the wound and walk on: the trail breaks; it casts about at the last drop, then loses you.
const broke = await page.evaluate(() => {
  const g = __game, h = g.survival.health;
  h.bandage(); steps(120);
  const stillBleeding = h.bleeding.length;
  walkTo({ x: -18, z: -50 });
  for (let i = 0; i < 60 * 30 && g.howler.state !== 'lost'; i++) steps(1);
  const H = g.howler.position, P = g.player.position;
  return { stillBleeding, state: g.howler.state, gap: +Math.hypot(H.x - P.x, H.z - P.z).toFixed(1), last: g.howler.tracker.log.slice(-2) };
});
check('bandage the wound and walk on: the trail breaks, it casts about at the last drop and loses you', broke.stillBleeding === 0 && broke.state === 'lost' && broke.gap > 20, broke);
const recs = await page.evaluate(() => __game.scent.records().slice(0, 3));
check('scent records carry kind, place, strength, age and expiry (wind and decay applied)', recs.length && recs.every((r) => r.kind && r.strength > 0 && r.age >= 0 && r.expiresIn > 0), recs);

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
