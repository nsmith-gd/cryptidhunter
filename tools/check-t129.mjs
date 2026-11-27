// Level 2 Oro-Medonte woods (#129). Run: npm run check:t129 [outDir]
// One daylight trip, fixed-step sim, real keys for movement and extraction:
//   the $75 trip from the map picker's Level 2; afternoon light and a 2:30 PM -> dusk clock;
//   the parked car, two campsites (warm), the den, the meadow, the camera post, the lake shore
//   (wade in and refill), deer tracks (ordinary-animal false trace) and the Sidehill Gouger;
//   real hills (you climb, slopes slow you); sprinting down a steep slope turns an ankle (S08);
//   wander deep into the woods, dusk falls (darker), walk back to the car holding W along a route,
//   and get in with E (manifest) and E again (drive out).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t129';
mkdirSync(out, { recursive: true });
const PORT = 4429;
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
const tp = (x, z, yaw = null, pitch = null) => page.evaluate(([x, z, yaw, pitch]) => {
  const g = __game, p = g.player; p.position.set(x, g.map.heightAt(x, z), z); p.velocity.set(0, 0, 0);
  if (yaw != null) p.yaw = yaw; if (pitch != null) p.pitch = pitch;
}, [x, z, yaw, pitch]);

await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=oromedonte&seed=129&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game && document.getElementById('prep-panel'), null, { timeout: 240000 });
const prep = await page.evaluate(() => ({ prep: document.getElementById('prep-panel').innerText.split('\n').slice(0, 3).join(' | '), picker: document.getElementById('map-picker')?.innerText ?? '' }));
await page.screenshot({ path: `${out}/01-prep-level2.png` });
await page.evaluate(() => {
  const g = __game; g.expedition.commit(); g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
});
await steps(5);
const s0 = await page.evaluate(() => {
  const g = __game, L = g.map.landmarks;
  return { trip: g.camp.ledger.tx.filter((t) => t.kind === 'trip').map((t) => t.cents), clock: g.hunt.clock.textContent, hud: g.hunt.hud.textContent.split('\n')[0],
    light: +g.daylight?.hemi.intensity.toFixed(2), cryptid: g.cryptids.cryptids.map((c) => c.profile.name), deer: g.clues.clues.filter((c) => c.type === 'deerTrack').length,
    gougerSigns: g.clues.clues.filter((c) => c.cryptidId === 'gouger').length, carDist: +Math.hypot(g.player.position.x - g.HUNT.exit.x, g.player.position.z - g.HUNT.exit.z).toFixed(1),
    landmarks: Object.keys(L), scene: ['lower-camp-firering', 'upper-camp-firering', 'gouger-den', 'camera-post', 'shore-slab', 'lake', 'extraction-van'].filter((n) => g.scene.getObjectByName(n)) };
});
await shot('02-at-the-car');
check('Level 2 opens on the prep screen ($75 trip); the trip starts at 2:30 PM in daylight by the parked car, with the Gouger, its signs and deer tracks in the woods',
  /Oro-Medonte/.test(prep.prep) && /\$75/.test(prep.prep) && s0.trip[0] === -7500 && /2:30 PM/.test(s0.clock) && /dusk in/.test(s0.clock) && s0.light > 1
  && s0.cryptid.includes('Sidehill Gouger') && s0.deer > 20 && s0.gougerSigns > 5 && s0.carDist < 12 && s0.scene.length === 7, { ...s0, prep: prep.prep });

// Hills: climb the north ridge; slopes slow you.
const hills = await page.evaluate(() => {
  const g = __game; let top = { y: -99 }, steep = { s: 0 };
  for (let x = -170; x < 170; x += 4) for (let z = -170; z < 170; z += 4) {
    const y = g.map.heightAt(x, z), s = g.map.slopeAt(x, z);
    if (y > top.y) top = { x, z, y }; if (s > steep.s && !g.map.colliders.some((b) => x > b.min.x - 1 && x < b.max.x + 1 && z > b.min.z - 1 && z < b.max.z + 1)) steep = { x, z, s };
  }
  return { top: { ...top, y: +top.y.toFixed(1) }, steep: { ...steep, s: +steep.s.toFixed(2), speed: +g.map.speedAt(steep.x, steep.z, g.map.heightAt(steep.x, steep.z)).toFixed(2) } };
});
check('real hills: the ridges rise well above the car park, and steep slopes slow you down', hills.top.y > 10 && hills.steep.speed < 0.8, hills);

// Terrain injury: sprint down the steepest open slope (deterministic roll).
await page.evaluate(() => { __game.terrainInjury.rand = () => 0; });
const st = hills.steep;
await page.evaluate((st) => {
  const g = __game, e = 1.5, gx = g.map.heightAt(st.x + e, st.z) - g.map.heightAt(st.x - e, st.z), gz = g.map.heightAt(st.x, st.z + e) - g.map.heightAt(st.x, st.z - e);
  const p = g.player; p.position.set(st.x, g.map.heightAt(st.x, st.z), st.z); p.velocity.set(0, 0, 0); p.stamina = 1;
  p.yaw = Math.atan2(gx, gz);   // face downhill (forward is -z rotated by yaw)
}, st);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await steps(90);
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
await page.evaluate(() => { __game.terrainInjury.rand = Math.random; });
const inj = await page.evaluate(() => ({ count: __game.terrainInjury.count, health: Math.round(__game.survival.health.value), log: __game.survival.health.log.map((l) => `${l.cause}:${l.wound}`) }));
check('rushing (Shift) down a steep slope turns an ankle: a light "Rough ground" injury through the health system', inj.count === 1 && inj.health < 100 && inj.log.includes('Rough ground:sprain'), inj);

// Campsites are warm; the lake shore is water you can wade into.
const L = await page.evaluate(() => __game.map.landmarks);
await tp(L.lowerCamp.x + 1, L.lowerCamp.z + 1); await steps(3);
const warm1 = await page.evaluate(() => __game.survival.thermo.nearHeat);
await tp(L.upperCamp.x + 1, L.upperCamp.z + 1); await steps(3);
const warm2 = await page.evaluate(() => __game.survival.thermo.nearHeat);
await tp(L.shore.x + 4, L.shore.z - 1, -Math.PI / 2, -0.1); await steps(3);
const shore = await page.evaluate(() => ({ water: __game.survival.thermo.inWater }));
await shot('03-lake-shore');
await tp(L.cameraPost.x + 1.5, L.cameraPost.z + 2.5, 0.2, -0.1); await steps(3);
await shot('04-camera-post-over-the-meadow');
check('two campsites with a fire to warm up at, a lake shore to wade in (water), a den, a meadow and a camera post',
  /lower campsite/.test(warm1 ?? '') && /upper campsite/.test(warm2 ?? '') && shore.water === 'shallow', { warm1, warm2, shore });

// Lost: deep in the woods by the den, far from the car and off the trail.
await tp(L.den.x + 3, L.den.z + 8, Math.PI, 0); await steps(5);
const lost = await page.evaluate(() => { const g = __game, p = g.player.position; return { carDist: Math.round(Math.hypot(p.x - g.HUNT.exit.x, p.z - g.HUNT.exit.z)), y: +p.y.toFixed(1) }; });
await page.keyboard.press('KeyM'); await steps(20);
await shot('05-lost-by-the-den-map-up');
await page.keyboard.press('KeyM'); await steps(5);
// Dusk falls.
const light0 = await page.evaluate(() => __game.daylight.hemi.intensity);
await page.evaluate(() => { __game.hunt.elapsed = __game.map.clock.seconds + 60; });
await steps(5);
const dusk = await page.evaluate(() => ({ clock: __game.hunt.clock.textContent, hud: __game.hunt.hud.textContent.split('\n')[1], light: +__game.daylight.hemi.intensity.toFixed(2), fog: __game.scene.fog.color.getHexString() }));
await shot('06-dusk-falls');
check('far from the car (over 250 m) at the den, dusk falls: the clock says DUSK, it gets dark, and the HUD says to find the way back with map and compass',
  lost.carDist > 250 && /DUSK/.test(dusk.clock) && /map and compass/.test(dusk.hud) && dusk.light < light0 * 0.8, { lost, dusk, light0: +light0.toFixed(2) });

// Walk back to the car: hold W, steer along a route between the trees (real collisions and hills).
const route = await page.evaluate(() => {
  const g = __game, grid = g.cryptids.gridFor({ radius: 0.5, height: 1.8 }), p = g.player.position, e = g.HUNT.exit;
  const s = grid.sample(p.x, p.z, 4), d = grid.sample(e.x, e.z - 3, 6);
  return grid.findPath(s.x, s.z, d.x, d.z);
});
let walked = 0;
if (route?.length) {
  await page.keyboard.down('KeyW');
  for (let i = 1; i < route.length; i++) {
    const wp = route[i];
    for (let k = 0; k < 400; k++) {
      const d = await page.evaluate((wp) => {
        const g = __game, p = g.player; p.yaw = Math.atan2(-(wp.x - p.position.x), -(wp.z - p.position.z)); p.pitch = 0;
        for (let j = 0; j < 20; j++) g.sim.step();
        return Math.hypot(wp.x - p.position.x, wp.z - p.position.z);
      }, wp);
      if (d < 1.2) break;
    }
  }
  await page.keyboard.up('KeyW');
  walked = route.length;
}
await steps(5);
const back = await page.evaluate(() => ({ inZone: __game.hunt.inZone, carDist: +Math.hypot(__game.player.position.x - __game.HUNT.exit.x, __game.player.position.z - __game.HUNT.exit.z).toFixed(1), elapsed: Math.round(__game.hunt.elapsed) }));
await page.evaluate(() => { const g = __game, e = g.HUNT.exit, p = g.player; p.yaw = Math.atan2(-(e.x - p.position.x), -(e.z + 4.2 - p.position.z)); });
await shot('07-back-at-the-car-at-dusk');
check('walking back on foot (W held, around the trees and over the hills) reaches the car', back.inZone && walked > 2, { ...back, waypoints: walked });
await page.keyboard.press('KeyE'); await steps(2);
const review = await page.evaluate(() => document.getElementById('extraction-review')?.textContent ?? '');
await page.keyboard.press('KeyE'); await steps(2);
const end = await page.evaluate(() => ({ stage: __game.hunt.stage, outcome: __game.hunt.outcome, title: __game.hunt.endTitle.textContent, cls: __game.camp.lastHunt?.outcomeClass }));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/08-drove-out.png` });
check('at the car, E opens the extraction review and E again drives out: the trip ends on the results screen', /EXTRACTION/.test(review) && end.stage === 'ended' && /HUNT/.test(end.title), end);

check('no page errors', errors.length === 0, errors);
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
