// Sidehill Gouger (#130). Run: npm run check:t130 [outDir]
// Level 2, Oro-Medonte, fixed-step sim. The Gouger on the shared AI:
//   grazes along one height round the hills (a contour), one way, leaving lopsided paired prints;
//   shadows you from the slope while you look away, closer as dusk falls and as you go deeper;
//   freezes the moment you look at it (you see it stalking), then bolts along the slope; never attacks;
//   its trail predicts its route (the prints say which way, and it keeps on that way);
//   a photo of it walking across the slope is hillside-gait evidence (real camera buttons).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t130';
mkdirSync(out, { recursive: true });
const PORT = 4430;
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
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${n}.png` }); };

await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=oromedonte&seed=130&simpaused`);
await page.waitForFunction(() => window.__game, null, { timeout: 240000 });
await page.evaluate(() => {
  const g = __game; g.expedition.commit(); g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  window.__go = g.cryptids.cryptids.find((c) => c.profile.id === 'gouger');
  window.__look = (x, z) => { const p = g.player, e = g.camera.position; p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); p.pitch = Math.atan2((g.map.heightAt(x, z) + 0.6) - e.y, Math.hypot(x - e.x, z - e.z)); };
});
await page.evaluate(() => __game.aiDebug.setVisible(false));

// 1) Grazing along its contour, player far away at the car.
const graze = await page.evaluate(() => {
  const g = __game, go = __go, start = { x: go.agent.x, z: go.agent.z };
  const hs = [], dirs = [];
  for (let i = 0; i < 150 * 60; i++) { g.sim.step(); if (i % 60 === 0) hs.push(g.map.heightAt(go.agent.x, go.agent.z)); }
  const signs = g.clues.clues.filter((c) => c.cryptidId === 'gouger' && c.type === 'footprint' && c.age < 150);
  const lengths = [...new Set(signs.map((c) => Math.round(c.data.length * 100)))];
  return { travelled: Math.round(Math.hypot(go.agent.x - start.x, go.agent.z - start.z)), heightSpread: +(Math.max(...hs) - Math.min(...hs)).toFixed(1), hs: hs.length,
    prints: signs.length, lengthsCm: lengths, roamStyle: go.profile.roamStyle, contourY: +go.contourY?.toFixed(1), states: [...new Set(go.history.map((h) => h.to))] };
});
check('left alone it grazes along one height round the hill (a contour), leaving lopsided paired prints (one side shorter)',
  graze.travelled > 25 && graze.heightSpread < 5 && graze.prints > 10 && graze.lengthsCm.length === 2, graze);

// 2) The trail predicts its route: the newest prints point the way it keeps going.
const predict = await page.evaluate(() => {
  const g = __game, go = __go;
  const pr = g.clues.clues.filter((c) => c.cryptidId === 'gouger' && c.type === 'footprint').sort((a, b) => a.age - b.age).slice(0, 8);
  const a = pr[pr.length - 1], b = pr[0];
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
  const hint = g.trailReader.hintFor(b), desc = (g.journal.describe?.(b)) ?? null;
  for (let i = 0; i < 40 * 60; i++) g.sim.step();   // keep watching from afar
  const ex = go.agent.x - b.x, ez = go.agent.z - b.z, e = Math.hypot(ex, ez) || 1;
  return { hint, cos: +((dx * ex + dz * ez) / (d * e)).toFixed(2), moved: Math.round(e) };
});
check('its prints predict its route: 40 s later it is further along the way the newest prints point (and the trail reader says which way)',
  predict.cos > 0.3 && /heading/.test(predict.hint ?? ''), predict);

// 3) Stalking: you go deep into its hills near dusk and look away; it shadows you along the slope.
const setup = await page.evaluate(() => {
  const g = __game, go = __go;
  // Stand ~70 m from it on open ground, facing away from it; it's late afternoon.
  let spot = null;
  for (let r = 60; r < 90 && !spot; r += 5) for (let a = 0; a < 24 && !spot; a++) {
    const x = go.agent.x + Math.cos(a / 24 * 6.283) * r, z = go.agent.z + Math.sin(a / 24 * 6.283) * r;
    if (Math.abs(x) < 170 && Math.abs(z) < 170 && !g.map.colliders.some((b) => x > b.min.x - 1 && x < b.max.x + 1 && z > b.min.z - 1 && z < b.max.z + 1) && g.map.surfaceAt(x, z) === 'dry') spot = { x, z };
  }
  g.player.position.set(spot.x, g.map.heightAt(spot.x, spot.z), spot.z); g.player.velocity.set(0, 0, 0);
  g.player.yaw = Math.atan2(-(spot.x - go.agent.x), -(spot.z - go.agent.z)); g.player.pitch = 0;   // facing away
  g.hunt.elapsed = g.map.clock.seconds * 0.35;
  return { dist0: Math.round(go.playerDistance), ctx: g.cryptids.context() };
});
const track = [];
for (let k = 0; k < 6; k++) {
  await page.evaluate(() => { const g = __game, p = g.player, go = __go; p.yaw = Math.atan2(-(p.position.x - go.agent.x), -(p.position.z - go.agent.z)); for (let i = 0; i < 300; i++) g.sim.step(); });
  track.push(await page.evaluate(() => ({ d: Math.round(__go.playerDistance), state: __go.state, want: Math.round(__go.stalkWant ?? 0), observed: __go.perception.observed })));
}
const early = track.at(-1);
await page.evaluate(() => { __game.hunt.elapsed = __game.map.clock.seconds * 0.95; });
for (let k = 0; k < 4; k++) {
  await page.evaluate(() => { const g = __game, p = g.player, go = __go; p.yaw = Math.atan2(-(p.position.x - go.agent.x), -(p.position.z - go.agent.z)); for (let i = 0; i < 300; i++) g.sim.step(); });
  track.push(await page.evaluate(() => ({ d: Math.round(__go.playerDistance), state: __go.state, want: Math.round(__go.stalkWant ?? 0), observed: __go.perception.observed })));
}
const late = track.at(-1);
check('unwatched, it shadows you along the slope, and comes closer as dusk falls',
  track.some((t) => t.state === 'stalk') && early.d < setup.dist0 && late.want < early.want && late.d < early.d + 3 && !track.some((t) => t.state === 'aggress'), { setup, track });

// 4) Turn round: you see it stalking. It freezes, then bolts along the slope. Never attacks.
const before = await page.evaluate(() => ({ x: __go.agent.x, z: __go.agent.z, y: __game.map.heightAt(__go.agent.x, __go.agent.z), cy: __go.contourY }));
await page.evaluate(() => { __look(__go.agent.x, __go.agent.z); __game.sim.step(); __look(__go.agent.x, __go.agent.z); });
await steps(20);
const seen = await page.evaluate(() => ({ observed: __go.perception.observed, state: __go.state, speed: +(__go.agent.currentSpeed ?? 0).toFixed(2), event: __game.cryptidEvents.some((e) => e.type === 'stalk-seen'), d: Math.round(__go.playerDistance), toast: document.body.innerText.includes('froze the moment you looked') }));
await page.evaluate(() => { __game.aiDebug.setVisible(true); });
await shot('01-you-turn-round-it-freezes');
await page.evaluate(() => { __game.aiDebug.setVisible(false); });
// Keep looking (or walk at it): it bolts.
for (let k = 0; k < 8; k++) await page.evaluate(() => { __look(__go.agent.x, __go.agent.z); for (let i = 0; i < 40; i++) __game.sim.step(); });
const fled = await page.evaluate(() => ({ states: __go.history.slice(-6).map((h) => `${h.to}:${h.why}`), d: Math.round(__go.playerDistance), y: __game.map.heightAt(__go.agent.x, __go.agent.z) }));
await shot('02-it-bolts-along-the-slope');
check('look at it and it freezes (you saw it stalking), then it bolts along the slope, away from you, never at you',
  seen.observed && seen.event && seen.toast && seen.speed < 0.5 && fled.states.some((s) => s.startsWith('flee')) && fled.d > seen.d && Math.abs(fled.y - before.y) < 6
  && !(await page.evaluate(() => __go.history.some((h) => h.to === 'aggress'))), { seen, fled, before: { y: +before.y.toFixed(1) } });

// 5) Hillside gait photo: catch it walking across the slope, real camera buttons.
await page.evaluate(() => {
  const g = __game, go = __go;
  go.perception.reset(); go.enterRoam('test'); go.update = ((u) => function (dt) { u.call(this, dt); if (this.state !== 'roam') this.enterRoam('test'); this.perception.awareness = 0; this.perception.detected = false; })(Object.getPrototypeOf(go).update);
  for (let i = 0; i < 600 && !(go.agent.currentSpeed > 0.5 && go.slopeHere().slope > 0.2); i++) g.sim.step();
  const s = go.slopeHere(), a = go.agent;
  // 10 m off, across the slope, clear of trees.
  let spot = null;
  for (let r = 8; r < 16 && !spot; r += 1) for (let k = 0; k < 16 && !spot; k++) {
    const x = a.x + Math.cos(k / 16 * 6.283) * r, z = a.z + Math.sin(k / 16 * 6.283) * r;
    if (!g.map.colliders.some((b) => x > b.min.x - 0.8 && x < b.max.x + 0.8 && z > b.min.z - 0.8 && z < b.max.z + 0.8)) spot = { x, z };
  }
  g.player.position.set(spot.x, g.map.heightAt(spot.x, spot.z), spot.z); g.player.velocity.set(0, 0, 0);
  g.cryptids.update = () => {};   // it holds the pose for the frame (still mid-stride)
  g.sim.step(); __look(a.x, a.z); g.sim.step();
});
await page.mouse.move(450, 270);
await page.mouse.down({ button: 'right' }); await steps(30);
await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
await page.mouse.up({ button: 'right' }); await steps(5);
const gait = await page.evaluate(() => ({ log: __game.photo.log.at(-1) && { result: __game.photo.log.at(-1).result, subject: __game.photo.log.at(-1).subject }, ev: __game.evidence.items.map((i) => i.name) }));
await shot('03-hillside-gait-photo');
check('a photo of it walking across the slope (real camera buttons) is a hillside-gait photo: its distinctive locomotion evidence',
  gait.log?.subject === 'Sidehill Gouger' && gait.ev.includes('Hillside gait photo'), gait);

check('no page errors', errors.length === 0, errors);
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
