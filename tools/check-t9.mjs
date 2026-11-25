// Automated check for the Pine Hollow Forest greybox. Run: npm run check:t9 [outDir]
// 1) The map is 300 x 300 m with trees, landmarks, creek and ridge.
// 2) The player controller (W held, steering only) walks it end to end: trailhead in the far
//    south to Bigfoot's hollow in the far north, and west edge to east edge.
// 3) The AI navmesh routes Bigfoot around the ridge (through a gap) and it actually gets there.
// Also writes captures of each landmark.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t9';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4339', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4339/?map=forest');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true;
  g.hunt?.start?.();
  if (g.huntFailure) g.huntFailure.enabled = false;
  for (const c of [g.chupacabra, g.mothman]) if (c) c.update = () => {};
});
await page.waitForTimeout(500);

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

// 1) Map contents.
const info = await page.evaluate(() => {
  const { map, scene } = __game;
  const names = new Set(); scene.traverse((o) => o.name && names.add(o.name));
  return { bounds: map.bounds, trees: map.trees, colliders: map.colliders.length, landmarks: Object.keys(map.landmarks),
    has: ['footbridge', 'creek', 'ridge', 'cabin-roof', 'lookout-cab', 'bigfoot-nest', 'tree-trunks'].filter((n) => names.has(n)) };
});
check('map is 300 x 300 m', info.bounds === 150, info.bounds);
check('dense forest of blockout trees', info.trees > 1200, info.trees);
check('cabin, creek, footbridge, ridge, lookout, nest all present', info.has.length === 7, info.has);

// 2) Walk end to end with the real controller: plan a route on a player-sized nav grid, then
// hold W and only steer (fast-forwarded in fixed 1/30 s steps; collisions are the game's own).
const walk = (from, to, maxSeconds) => page.evaluate(([from, to, maxSeconds]) => {
  const { player, input, cryptids, map } = __game;
  const grid = cryptids.gridFor({ radius: 0.35, height: 1.8 });
  const path = grid.findPath(from.x, from.z, to.x, to.z);
  if (!path) return { ok: false, reason: 'no player path' };
  player.position.set(from.x, 0, from.z); player.velocity.set(0, 0, 0); player.pitch = 0;
  input.keys.clear(); input.keys.add('KeyW');
  let i = 0, t = 0, waded = 0, dist = 0, stuck = 0, last = { x: from.x, z: from.z }, maxDev = 0;
  for (; t < maxSeconds && i < path.length; t += 1 / 30) {
    const p = player.position, wp = path[i];
    if (Math.hypot(wp.x - p.x, wp.z - p.z) < 1.0) { i++; continue; }
    player.yaw = -Math.atan2(wp.x - p.x, -(wp.z - p.z));
    player.update(1 / 30);
    const step = Math.hypot(p.x - last.x, p.z - last.z);
    dist += step; last = { x: p.x, z: p.z };
    stuck = step < 0.01 ? stuck + 1 : 0;
    if (stuck > 90) break; // 3 s without moving
    if (map.surfaceAt(p.x, p.z, p.y) === 'shallow') waded++;
  }
  input.keys.clear();
  const p = player.position;
  return { ok: Math.hypot(to.x - p.x, to.z - p.z) < 3, end: { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }, metres: Math.round(dist),
    seconds: Math.round(t), wadedSeconds: +(waded / 30).toFixed(1), waypoints: `${i}/${path.length}` };
}, [from, to, maxSeconds]);

const L = await page.evaluate(() => __game.map.landmarks);
const ns = await walk(L.trailhead, L.hollow, 400);
check('walks from the trailhead (far south) to Bigfoot\'s hollow (far north)', ns.ok && Math.abs(L.trailhead.z - L.hollow.z) > 230, ns);
const we = await walk({ x: -140, z: 40 }, { x: 140, z: 40 }, 400);
check('walks from the west edge to the east edge (wading the creek on the way is allowed)', we.ok, we);
const ford = await walk({ x: 35, z: 40 }, { x: 35, z: 0 }, 60);
check('the footbridge carries the trail over the creek without wading', ford.ok && ford.wadedSeconds === 0, ford);
const wade = await walk({ x: 60, z: 30 }, { x: 60, z: -12 }, 60);
check('wading the creek away from the bridge is slower', wade.ok && wade.wadedSeconds > 1 && wade.seconds > ford.seconds, { wade, bridge: ford });

// 3) AI pathing: send Bigfoot from south of the ridge to a point straight north of it.
const ai = await page.evaluate(() => {
  const { cryptids, map } = __game;
  const bf = cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  bf.update = () => {}; // take manual control of its nav agent
  const a = bf.agent, from = { x: -60, z: -30 }, to = { x: -60, z: -100 };
  a.x = from.x; a.z = from.z;
  a.setDestination(to.x, to.z);
  const planned = a.path ? a.path.length : 0;
  let travelled = 0, inside = 0, t = 0, px = a.x, pz = a.z, gapUsed = null;
  let replans = 0;
  for (; t < 300; t += 1 / 30) {
    if (!a.hasPath) {
      if (Math.hypot(a.x - to.x, a.z - to.z) < 2 || replans >= 20) break;
      // The agent drops its path if a step would clip a blocked cell; the AI re-plans, so do we.
      a.setDestination(to.x, to.z); replans++;
    }
    a.update(1 / 30);
    travelled += Math.hypot(a.x - px, a.z - pz); px = a.x; pz = a.z;
    if (Math.abs(a.z + 62) < 3) gapUsed = Math.round(a.x);
    for (const c of map.colliders) if (c.max.y > 0.4 && a.x > c.min.x && a.x < c.max.x && a.z > c.min.z && a.z < c.max.z) { inside++; break; }
  }
  return { arrived: Math.hypot(a.x - to.x, a.z - to.z) < 2, planned, straight: 70, travelled: Math.round(travelled), seconds: Math.round(t), crossedRidgeAtX: gapUsed, stepsInsideObstacles: inside, replans };
});
check('Bigfoot paths around the ridge through a gap and arrives', ai.arrived && ai.travelled > ai.straight * 1.3 && ai.crossedRidgeAtX !== null && ai.stepsInsideObstacles === 0, ai);
const hollowToTrailhead = await page.evaluate(() => {
  const g = __game.cryptids.gridFor(__game.cryptidProfiles.bigfoot);
  const L = __game.map.landmarks;
  const p = g.findPath(L.hollow.x, L.hollow.z, L.trailhead.x, L.trailhead.z);
  return { found: !!p, points: p?.length ?? 0 };
});
check('Bigfoot can reach the trailhead from its hollow', hollowToTrailhead.found, hollowToTrailhead);

// 4) Captures: stand at landmarks and look at them.
const view = async (name, x, z, lookX, lookZ, pitch = 0, y = 0) => {
  await page.evaluate(([x, z, lookX, lookZ, pitch, y]) => {
    const p = __game.player; p.position.set(x, y, z); p.velocity.set(0, 0, 0);
    p.yaw = -Math.atan2(lookX - x, -(lookZ - z)); p.pitch = pitch;
  }, [x, z, lookX, lookZ, pitch, y]);
  await page.waitForTimeout(700);
  await shot(name);
};
await view('01-trailhead-start', L.trailhead.x, L.trailhead.z, 0, 100);
await view('02-cabin', L.cabin.x + 12, L.cabin.z + 7, L.cabin.x, L.cabin.z, 0.05);
await view('03-creek-footbridge', 35, 33, 35, 20, -0.15);
await view('04-ridge-pass', 19, -40, 19, -62, 0.1);
await view('05-lookout-tower', 60, -70, 70, -88, 0.35);
await view('06-bigfoot-hollow', L.hollow.x, L.hollow.z + 14, L.hollow.x - 3, L.hollow.z, -0.1);
await page.evaluate(() => { __game.flashlight.on && __game.flashlight.toggle?.(); });
await view('07-forest-flashlight-off', -20, 30, -20, 0);
await page.evaluate(() => { !__game.flashlight.on && __game.flashlight.toggle?.(); });
// Overhead map: lift the camera high above the centre for one frame.
await page.evaluate(() => {
  const { player, camera, renderer, scene } = __game;
  player.update = () => {};
  scene.fog.far = 1000;
  camera.position.set(0, 330, 0); camera.rotation.set(-Math.PI / 2, 0, 0); camera.far = 1000; camera.updateProjectionMatrix();
  scene.add(new __game.THREE.AmbientLight(0xffffff, 1.2));
});
await page.waitForTimeout(800);
await shot('08-overhead-map');

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
