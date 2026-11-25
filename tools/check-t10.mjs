// Automated check for the swamp greybox. Run: npm run check:t10 [outDir]
// Wading slows you; the boardwalks connect every landmark without touching water; the player
// can actually walk the boardwalk route from the spawn dock over the bridge to the north platform.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t10';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4330', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4330/?map=swamp');
await page.waitForFunction(() => window.__game);
// Park the stalker so it can't interfere with this check.
await page.evaluate(() => { if (__game.chupacabra) __game.chupacabra.update = () => {}; __game.overlay.classList.add('hidden'); });
await page.waitForTimeout(500);

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const place = (x, z, yaw = 0, pitch = 0, y = 0) => page.evaluate(([x, z, yaw, pitch, y]) => {
  const p = __game.player; p.position.set(x, y, z); p.velocity.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch;
}, [x, z, yaw, pitch, y]);
const state = () => page.evaluate(() => {
  const p = __game.player;
  return { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2),
    v: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(2), surface: __game.map.surfaceAt(p.position.x, p.position.z, p.position.y) };
});
const keys = (add, codes) => page.evaluate(([add, c]) => c.forEach((k) => add ? __game.input.keys.add(k) : __game.input.keys.delete(k)), [add, codes]);

// 1) Walking speed on boardwalk vs shallow vs deep water.
const speedAt = async (x, z, y, sprint) => {
  await place(x, z, 0, 0, y);
  await page.waitForTimeout(200);
  await keys(true, sprint ? ['KeyW', 'ShiftLeft'] : ['KeyW']);
  await page.waitForTimeout(1500);   // long enough to reach top speed even at low software-render frame rates
  const s = await state();
  await keys(false, ['KeyW', 'ShiftLeft']);
  return s;
};
const dock = await speedAt(0, 38, 0.35);
const shallow = await speedAt(10, 40, 0);
const deep = await speedAt(10, -18, 0);
const shallowSprint = await speedAt(10, 40, 0, true);
check('boardwalk is full walking speed', dock.surface === 'dry' && dock.v > 3.0, dock);
check('wading in shallow water is slower', shallow.surface === 'shallow' && shallow.v < dock.v * 0.7, shallow);
check('deep water is slower still', deep.surface === 'deep' && deep.v < shallow.v * 0.75, deep);
check('cannot sprint while wading', shallowSprint.v < dock.v * 0.7, shallowSprint);

// 2) Boardwalk connectivity: flood-fill over dry tops (step-up limit, blocked by walls/railings).
const reach = await page.evaluate(() => {
  const { decks, colliders, landmarks, bounds } = __game.map;
  const STEP = 0.36, cell = 0.25, r = 0.3, n = Math.ceil(bounds * 2 / cell);
  const top = (x, z) => {
    let h = -1;
    for (const b of decks) if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) h = Math.max(h, b.max.y);
    return h;
  };
  // Player body standing at (x,z) on height h must fit (a radius-wide box, 1.8 m tall).
  const fits = (x, z, h) => !colliders.some((b) => b.max.y > h + STEP && b.min.y < h + 1.8 &&
    x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z);
  const idx = (ix, iz) => iz * n + ix, cx = (i) => -bounds + (i + 0.5) * cell;
  const heights = new Float32Array(n * n).fill(-1);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = cx(ix), z = cx(iz), h = top(x, z);
    // Only dry cells where the whole body footprint is on a deck count (no foot in the water).
    if (h > 0.3 && top(x - r, z - r) > 0.3 && top(x + r, z - r) > 0.3 && top(x - r, z + r) > 0.3 && top(x + r, z + r) > 0.3 && fits(x, z, h)) heights[idx(ix, iz)] = h;
  }
  const toI = (v) => Math.floor((v + bounds) / cell);
  const seen = new Uint8Array(n * n), q = [idx(toI(landmarks.spawnDock.x), toI(landmarks.spawnDock.z))];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), ix = i % n, iz = (i / n) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx, jz = iz + dz, j = idx(jx, jz);
      if (jx < 0 || jz < 0 || jx >= n || jz >= n || seen[j] || heights[j] < 0) continue;
      if (Math.abs(heights[j] - heights[i]) > STEP && heights[j] > heights[i]) continue; // too tall to step up
      seen[j] = 1; q.push(j);
    }
  }
  const res = {};
  for (const [k, p] of Object.entries(landmarks)) res[k] = !!seen[idx(toI(p.x), toI(p.z))];
  return res;
});
check('boardwalks connect every landmark without wading', Object.values(reach).every(Boolean), reach);

// 3) Actually walk it: steer the player along the boardwalk from the dock, over the bridge, to the north platform.
const walkRoute = async (route, shots = {}) => {
  let wet = 0, maxY = 0;
  for (const [i, [wx, wz]] of route.entries()) {
    await keys(true, ['KeyW']);
    for (let t = 0; t < 400; t++) {
      const s = await page.evaluate(([wx, wz]) => {
        const p = __game.player;
        p.yaw = Math.atan2(-(wx - p.position.x), -(wz - p.position.z));
        return { d: Math.hypot(wx - p.position.x, wz - p.position.z), y: p.position.y,
          surface: __game.map.surfaceAt(p.position.x, p.position.z, p.position.y) };
      }, [wx, wz]);
      if (s.surface !== 'dry') wet++;
      maxY = Math.max(maxY, s.y);
      if (s.d < 0.4) break;
      await page.waitForTimeout(50);
    }
    if (shots[i]) { await keys(false, ['KeyW']); await page.waitForTimeout(150); await shots[i](); }
  }
  await keys(false, ['KeyW']);
  return { end: await state(), wet, maxY: +maxY.toFixed(2) };
};
await place(0, 42, 0, 0, 0.35);
const north = await walkRoute([[0, 17], [0, -8], [0, -21], [0, -36], [0, -44]], {
  2: async () => { await page.evaluate(() => { __game.player.pitch = -0.05; }); await page.waitForTimeout(100); await shot('05-on-the-bridge'); },
});
check('walked dock -> bridge -> north platform staying dry', north.wet === 0 && north.end.z < -43 && north.maxY > 2.3, north);
await place(0, 17, 0, 0, 0.35);
const west = await walkRoute([[-24.5, 17], [-24.5, 15], [-28, 15]]);
check('walked junction -> ranger shack staying dry', west.wet === 0 && west.end.x < -27, west);
await place(0, 17, 0, 0, 0.35);
const east = await walkRoute([[19, 17], [19, -5]]);
check('walked junction -> fishing platform staying dry', east.wet === 0 && east.end.z < -4.5, east);

// 4) Captures (first-person, flashlight on).
await place(0, 43.5, 0, 0.02, 0.35); await page.waitForTimeout(300); await shot('01-spawn-dock');
await place(8, 34, -0.5, -0.1); await page.waitForTimeout(300); await shot('02-wading-shallows');
await place(-5, -3, -0.3, 0.15, 0.35); await page.waitForTimeout(300); await shot('03-old-bridge-from-island');
await place(-4, -20, -0.9, 0.25); await page.waitForTimeout(300); await shot('04-under-bridge-deep-water');
await place(-12, 17, Math.PI / 2 + 0.25, -0.05, 0.35); await page.waitForTimeout(300); await shot('06-ranger-shack');
await page.evaluate(() => { __game.flashlight.toggle(); }); await place(0, -36, 0, 0.35, 0.35);
await page.waitForTimeout(300); await shot('07-north-platform-light-off');
await page.evaluate(() => { __game.flashlight.toggle(); });

// Overhead map with fog lifted and a bright sky light, so the layout reads.
await page.evaluate(() => {
  const g = __game; g.flashlight.light.visible = false;
  g.saved = { fog: g.scene.fog };
  g.scene.fog = null;
  g.sun = new g.THREE.HemisphereLight(0xffffff, 0x404040, 2.5); g.scene.add(g.sun);
  g.player.update = () => {};
  g.camera.position.set(0, 95, 0); g.camera.rotation.set(-Math.PI / 2, 0, 0);
});
await page.waitForTimeout(400);
await shot('08-overhead');

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
