// Boat handling and immersion / breath on the L05 Timiskaming greybox (#139). Plays it in the real game
// (?map=l05): walks out by the road and round the shore trail without the boat; boards at the dock,
// drives out, heels in a hard turn; gets bumped over (capsize); swims, dives (breath appears only under
// water), surfaces; rights the hull, climbs back in and steps onto the dock. Then the storm variant:
// a hard turn in the waves capsizes it. Captures go to the output folder.
// Run: npm run check:t139 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t139';
mkdirSync(out, { recursive: true });
const PORT = 4439;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

async function open(extra = '') {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?map=l05&simpaused${extra}`);
  await page.waitForFunction(() => window.__game?.lake, null, { timeout: 120000 });
  await page.evaluate(() => {
    const g = __game;
    g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
    // Test helpers: hold keys, step the sim, walk toward a point (steering the yaw), view.
    window.T = {
      hold(keys) { g.input.keys.clear(); for (const k of keys) g.input.keys.add(k); },
      steps(n) { for (let i = 0; i < n; i++) g.sim.step(); },
      walkTo(x, z, { r = 1.2, max = 6000, watch } = {}) {
        const P = g.player; T.hold(['KeyW']);
        for (let i = 0; i < max; i++) {
          const dx = x - P.position.x, dz = z - P.position.z;
          if (Math.hypot(dx, dz) < r) { T.hold([]); return true; }
          P.yaw = Math.atan2(-dx, -dz); g.sim.step(); watch?.();
        }
        T.hold([]); return false;
      },
      look(yaw, pitch = -0.1) { g.player.yaw = yaw; g.player.pitch = pitch; },
    };
  });
  return { page, errors };
}
const shot = async (page, name) => { await page.evaluate(() => { __game.sim.step(); __game.lake.render(); }); await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/${name}.png` }); };

// ---- calm --------------------------------------------------------------------------------------
{
  const { page, errors } = await open();
  // 1. The land exit without the boat: from the hub along the road; and from the far north bay
  //    shore round the trail, never stepping in deep water.
  const land = await page.evaluate(() => {
    const g = __game, m = g.map, P = g.player;
    let deepSteps = 0; const watch = () => { if (m.surfaceAt(P.position.x, P.position.z, P.position.y) === 'deep') deepSteps++; };
    const road = T.walkTo(m.exit.x, m.exit.z, { r: 2, watch });
    // Far shore: the north bay trail, then the shorter way round the trail to the hub, then out.
    const trail = m.shoreTrail;
    let iN = 0; trail.forEach((p, i) => { if (Math.hypot(p.x + 32, p.z + 92) < Math.hypot(trail[iN].x + 32, trail[iN].z + 92)) iN = i; });
    P.position.set(trail[iN].x, 0, trail[iN].z);
    const n = trail.length, home = trail.reduce((b, p, i) => (Math.hypot(p.x - 0, p.z - 11) < Math.hypot(trail[b].x, trail[b].z - 11) ? i : b), 0);
    const fwd = (home - iN + n) % n, step = fwd <= n / 2 ? 1 : -1, count = Math.min(fwd, n - fwd);
    let ok = true;
    for (let k = 1; k <= count && ok; k++) { const p = trail[(iN + step * k + n) % n]; ok = T.walkTo(p.x, p.z, { r: 1.5, max: 2000, watch }); }
    const fromNorth = ok && T.walkTo(m.landmarks.start.x, m.landmarks.start.z, { r: 2, watch }) && T.walkTo(m.exit.x, m.exit.z, { r: 2, watch });
    return { road, fromNorth, trailLegs: count, deepSteps, boatUsed: g.lake.log.some((e) => e.type === 'boarded'), at: [+P.position.x.toFixed(1), +P.position.z.toFixed(1)] };
  });
  check('the land exit works without the boat (the road out, and round the shore trail from the north bay)', land.road && land.fromNorth && land.deepSteps === 0 && !land.boatUsed, land);

  // 2. Board at the dock, start the outboard, drive out; a hard turn at speed heels it (warning).
  const drive = await page.evaluate(() => {
    const g = __game, L = g.lake, b = L.boat, P = g.player, m = g.map;
    P.position.set(0, 0, 20);
    T.walkTo(0.9, 0.6, { r: 0.5 }); T.steps(30);   // stop on the dock beside the boat
    const onDock = m.surfaceAt(P.position.x, P.position.z, P.position.y);
    const boarded = L.use() === 'boarded';
    const engine = L.engine();
    const fuel0 = b.tank.fuel;
    T.hold(['KeyW']); T.steps(60 * 8);
    const out = { z: +b.z.toFixed(1), speed: +b.speed.toFixed(2) };
    T.hold(['KeyW', 'KeyA']); let maxHeel = 0;
    for (let i = 0; i < 60 * 7; i++) { g.sim.step(); maxHeel = Math.max(maxHeel, b.heel); }
    return { onDock, boarded, engine, out, fuelUsed: +(fuel0 - b.tank.fuel).toFixed(4), maxHeel: +maxHeel.toFixed(2), state: b.state, seatedY: P.position.y, mode: L.aquatic.mode, wet: g.survival.thermo.wetness };
  });
  check('board at the dock, start the outboard, drive out (fuel burns; you stay dry)', drive.onDock === 'dry' && drive.boarded && drive.engine && drive.out.z < -10 && drive.fuelUsed > 0 && drive.mode === 'aboard' && drive.wet < 1, drive);
  check('a hard turn at full speed heels the boat hard but it holds in calm water', drive.maxHeel > 0.7 && drive.state === 'aboard', drive);
  await page.evaluate(() => { const g = __game, b = g.lake.boat; T.look(b.heading + 0.4, -0.25); });
  await shot(page, 'calm-01-driving-out-heeling-in-a-hard-turn');
  // 3. Something bumps the hull mid-turn: it capsizes and throws you in.
  const cap = await page.evaluate(() => {
    const g = __game, L = g.lake, b = L.boat, P = g.player;
    b.seat(P); T.hold(['KeyW', 'KeyA']); T.steps(60 * 3);
    b.bump(1); T.steps(2); T.hold([]);
    T.steps(60); L.render();
    return { state: b.state, mode: L.aquatic.mode, surface: g.map.surfaceAt(P.position.x, P.position.z, P.position.y), showBreath: L.aquatic.showBreath, breath: L.aquatic.breath, hudBreath: getComputedStyle(document.querySelector('#water-breath')).display, why: L.log.find((e) => e.type === 'capsized')?.why };
  });
  check('a bump during a hard turn capsizes the boat and throws you into deep water', cap.state === 'capsized' && cap.why === 'bumped from below' && cap.mode === 'swimming' && cap.surface === 'deep', cap);
  check('swimming at the surface: no breath meter, breath stays full', !cap.showBreath && cap.breath === 100 && cap.hudBreath === 'none', cap);
  await page.evaluate(() => { const g = __game, b = g.lake.boat; T.look(Math.atan2(-(b.x - g.player.position.x), -(b.z - g.player.position.z)), -0.12); });
  await shot(page, 'calm-03-capsized-swimming-beside-the-upturned-hull');

  // 4. Dive: breath appears and runs down; immersion soaks you through and chills you faster.
  const dive = await page.evaluate(() => {
    const g = __game, L = g.lake, th = g.survival.thermo;
    const eqSwim = th.equilibrium;
    T.hold(['KeyC']); T.steps(60 * 6); L.render();
    return { mode: L.aquatic.mode, showBreath: L.aquatic.showBreath, breath: +L.aquatic.breath.toFixed(1), hudBreath: getComputedStyle(document.querySelector('#water-breath')).display,
      tint: getComputedStyle(document.querySelector('#underwater-tint')).display, wet: th.wetness, eqSwim: +eqSwim.toFixed(2), eqUnder: +th.equilibrium.toFixed(2), submerged: th.submerged };
  });
  check('diving: the breath bar appears only under water and runs down', dive.mode === 'under' && dive.showBreath && dive.hudBreath === 'block' && dive.breath < 85, dive);
  check('immersion drives wetness and cold: soaked through, and colder under than at the surface', dive.wet === 100 && dive.submerged && dive.eqUnder < dive.eqSwim, dive);
  await shot(page, 'calm-04-under-water-the-breath-bar');
  const drown = await page.evaluate(() => {
    const g = __game, L = g.lake, h = g.survival.health;
    const h0 = h.value; T.steps(60 * 22);
    const drowning = L.aquatic.drowning, hDrown = h.value;
    T.hold([]); T.steps(60 * 2); L.render();
    return { drowning, lost: +(h0 - hDrown).toFixed(1), causes: [...new Set(h.log.map((e) => e.cause))], afterSurface: { mode: L.aquatic.mode, breath: L.aquatic.breath, drowning: L.aquatic.drowning, hud: getComputedStyle(document.querySelector('#water-breath')).display } };
  });
  check('out of air: drowning hurts through health only; surfacing stops it and the breath bar goes away', drown.drowning && drown.lost > 0 && drown.causes.includes('Drowning') && !drown.afterSurface.drowning && drown.afterSurface.breath === 100 && drown.afterSurface.hud === 'none', drown);

  // 5. Right the hull (hold E beside it), climb in, motor back, step out onto the dock.
  const back = await page.evaluate(() => {
    const g = __game, L = g.lake, b = L.boat, P = g.player, M = g.map.landmarks.mooring;
    T.walkTo(b.x, b.z, { r: 2.2, max: 3000 });
    T.hold(['KeyE']); T.steps(60 * 3); T.hold([]);
    const righted = b.state;
    const boarded = L.use() === 'boarded';
    const engine = L.engine();
    let arrived = false;
    for (let i = 0; i < 60 * 90 && !arrived; i++) {
      const dx = M.x - b.x, dz = M.z - 2 - b.z, want = Math.atan2(-dx, -dz);
      let diff = want - b.heading; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
      T.hold(['KeyW', ...(Math.abs(diff) > 0.08 ? [diff > 0 ? 'KeyA' : 'KeyD'] : [])]);
      g.sim.step(); arrived = Math.hypot(dx, dz) < 2.5;
    }
    T.hold([]); T.steps(90);
    const how = L.use();
    return { righted, boarded, engine, arrived, how, surface: g.map.surfaceAt(P.position.x, P.position.z, P.position.y), capsizes: b.capsizes };
  });
  check('hold E beside the upturned hull to right it, climb back in, motor home and step onto the dock', back.righted === 'adrift' && back.boarded && back.engine && back.arrived && back.how === 'stepped ashore' && back.surface === 'dry', back);
  await page.evaluate(() => { const g = __game, b = g.lake.boat, P = g.player; P.position.set(-0.2, 0, 7); T.look(Math.atan2(-(b.x - P.position.x), -(b.z - P.position.z)), -0.18); });
  await shot(page, 'calm-02-back-at-the-dock-the-rental-boat');
  check('no page errors (calm)', errors.length === 0, errors.slice(0, 3));
  await page.close();
}

// ---- storm -------------------------------------------------------------------------------------
{
  const { page, errors } = await open('&storm');
  const storm = await page.evaluate(() => {
    const g = __game, L = g.lake, b = L.boat, P = g.player;
    P.position.set(0, 0, 20); T.walkTo(0.9, 0.6, { r: 0.5 }); T.steps(30);   // stop on the dock beside the boat
    L.use(); L.engine();
    T.hold(['KeyW']); T.steps(60 * 6);
    T.hold(['KeyW', 'KeyA']);
    let t = 0; for (; t < 60 * 40 && b.state === 'aboard'; t++) g.sim.step();
    T.hold([]);
    return { state: b.state, after: +(t / 60).toFixed(1), why: L.log.find((e) => e.type === 'capsized')?.why, mode: L.aquatic.mode, rain: g.weather.rain };
  });
  check('storm: a hard turn at speed in the waves capsizes the boat', storm.state === 'capsized' && storm.mode === 'swimming', storm);
  await page.evaluate(() => { const g = __game, b = g.lake.boat; T.look(Math.atan2(-(b.x - g.player.position.x), -(b.z - g.player.position.z)), -0.1); });
  await shot(page, 'storm-01-capsized-in-the-waves');
  check('no page errors (storm)', errors.length === 0, errors.slice(0, 3));
  await page.close();
}

writeFileSync(`${out}/results.txt`, results.join('\n') + '\n');
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
