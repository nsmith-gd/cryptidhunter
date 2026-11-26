// Sunken trail ruts (director answer on #61). Run: npm run check:ruts [outDir]
// Pine Hollow's trails are worn into the ground: checks the rut depth along the trails, flat
// clearings and woods, a crack-free terrain mesh, and that the player, Bigfoot, footprints and
// placed gear all stand on the rut floor (no floating, no sinking). Captures before/after views.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/mmwxp67tt';
mkdirSync(out, { recursive: true });
const PORT = 4491;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

const load = async (q) => {
  await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai${q}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
};
await load('&simpaused');

const terrain = await page.evaluate(() => {
  const { map, scene } = __game, t = map.terrain, L = map.landmarks;
  const mids = map.trails.flatMap((tr) => tr.slice(0, -1).map((a, i) => ({ x: (a.x + tr[i + 1].x) / 2, z: (a.z + tr[i + 1].z) / 2 })));
  const depths = mids.map((p) => -map.heightAt(p.x, p.z));
  const clear = ['cabin', 'campsite', 'hollow', 'trailhead', 'boulders', 'lookout'].map((k) => map.heightAt(L[k].x, L[k].z));
  const ground = scene.getObjectByName('forest-terrain');
  // Crack check: every edge used by only one triangle must lie on the map border.
  const idx = ground.geometry.index.array, pos = ground.geometry.attributes.position.array, H = map.bounds;
  const edges = new Map();
  for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = idx[i + k], b = idx[i + (k + 1) % 3], key = a < b ? a * 1e7 + b : b * 1e7 + a;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  let open = 0, openInside = 0, openInsideSunk = 0;
  for (const [key, n] of edges) {
    if (n !== 1) continue; open++;
    const a = Math.floor(key / 1e7), b = key % 1e7;
    const onBorder = (v) => Math.abs(Math.abs(pos[v * 3]) - H) < 1e-3 || Math.abs(Math.abs(pos[v * 3 + 2]) - H) < 1e-3;
    if (!(onBorder(a) && onBorder(b))) { openInside++; if (Math.abs(pos[a * 3 + 1]) > 1e-4 || Math.abs(pos[b * 3 + 1]) > 1e-4) openInsideSunk++; }
  }
  return {
    trailDepthMin: +Math.min(...depths).toFixed(3), trailDepthMax: +Math.max(...depths).toFixed(3),
    clearingDepthMax: +Math.max(...clear.map((h) => -h)).toFixed(3), deepWoods: map.heightAt(120, -130),
    verts: ground.geometry.attributes.position.count, tris: idx.length / 3, openInside, openInsideSunk,
    dirtAtRutFloor: t.sample(mids[1].x, mids[1].z, 'dirt'),
  };
});
check('trails are worn into the ground along their whole length (12-17 cm)', terrain.trailDepthMin > 0.11 && terrain.trailDepthMax <= 0.175, terrain);
check('clearings and the deep woods stay level (ruts fade out into clearings)', terrain.clearingDepthMax < 0.01 && Math.abs(terrain.deepWoods) < 1e-6, terrain);
check('the rut floor is still painted dirt (walls line up with the dirt edge)', terrain.dirtAtRutFloor > 0.9, terrain);
check('terrain mesh: no cracks where the detailed rut cells meet the plain ground (T-junctions only at height 0)', terrain.openInsideSunk === 0, { openInside: terrain.openInside, openInsideSunk: terrain.openInsideSunk });
check('terrain mesh stays light (under 150k vertices)', terrain.verts < 150000, { verts: terrain.verts, tris: terrain.tris });

// Walk across and along a trail: feet follow the rut down and back up, never float or sink.
const walk = await page.evaluate(() => {
  const g = __game, p = g.player, tr = g.map.trails[1];
  const a = tr[1], b = tr[2], mx = a.x + (b.x - a.x) * 0.35, mz = a.z + (b.z - a.z) * 0.35;
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
  p.position.set(mx - nx * 4, 0, mz - nz * 4); p.velocity.set(0, 0, 0); p.yaw = Math.atan2(nx, nz); p.pitch = 0;
  g.input.keys.clear?.();
  let maxGap = 0, minY = 0, airborne = 0, worst = null, onProps = 0;
  for (let i = 0; i < 360; i++) {
    p.position.x += nx * 0.025; p.position.z += nz * 0.025;   // a walking pace across the trail (1.5 m/s)
    g.sim.step();
    const gy = g.map.heightAt(p.position.x, p.position.z);
    if (p.position.y - gy > 0.3) { onProps++; continue; }   // stepped onto a log/rock: not the terrain
    const gap = Math.abs(p.position.y - gy);
    if (gap > maxGap) { maxGap = gap; worst = { i, y: +p.position.y.toFixed(3), gy: +gy.toFixed(3), onTerrain: p.onTerrain }; }
    minY = Math.min(minY, p.position.y);
    if (!p.grounded) airborne++;
  }
  return { stage: g.hunt.stage, caught: g.huntFailure.isCaught, pos: [p.position.x, p.position.z].map((v) => +v.toFixed(1)), start: [mx - nx * 4, mz - nz * 4].map((v) => +v.toFixed(1)), maxGapM: +maxGap.toFixed(4), worst, onProps, lowestFeetY: +minY.toFixed(3), airborneSteps: airborne, crossed: (p.position.x - mx) * nx + (p.position.z - mz) * nz > 2 };
});
check('walking across a trail: feet follow the rut down and back up (no floating, no falling in)', walk.crossed && walk.maxGapM < 0.01 && walk.lowestFeetY < -0.11 && walk.airborneSteps === 0, walk);

const standing = await page.evaluate(() => {
  const g = __game, tr = g.map.trails[1], a = tr[1], b = tr[2];
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, gy = g.map.heightAt(x, z);
  const c = g.cryptids.cryptids[0]; c.agent.x = x; c.agent.z = z; c.syncMesh();
  const fp = g.clues.spawn('footprint', { cryptidId: 'bigfoot', position: { x: x + 0.4, y: 0, z }, rotationY: 0, data: { length: 0.4, width: 0.18, toes: 5 } });
  const cam = g.trailCams?.place?.(x + 1, z) ?? null;
  return { ground: +gy.toFixed(3), bigfootFeet: +c.mesh.position.y.toFixed(3), print: +fp.object.position.y.toFixed(3), printRecordY: +fp.y.toFixed(3) };
});
check('Bigfoot and his footprints stand on the rut floor, not on the old flat level', Math.abs(standing.bigfootFeet - standing.ground) < 1e-3 && Math.abs(standing.print - standing.ground) < 0.02 && standing.ground < -0.11, standing);

// Captures: the same low trail views without (before) and with the ruts.
const VIEWS = [
  ['01-trail-from-trailhead', 0, 128, 0, 100, -0.1, false],
  ['02-trail-flashlight-close', 30, 66, 38, 50, -0.32, true],
  ['03-ridge-trail-low', 22, -30, 18, -55, -0.14, true],
  ['04-crouched-at-the-trail-edge', 'side', 0, 0, 0, -0.28, true],
];
for (const [suffix, q] of [['before-flat', '&flattrails'], ['after-ruts', '']]) {
  await load(q);
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden');
    g.cryptids.update = () => {}; for (const c of g.cryptids.cryptids) c.mesh.visible = false;
    if (g.huntFailure) g.huntFailure.enabled = false;
    if (g.fear) { g.fear.update = () => {}; g.fear.applySway = () => {}; }
    const st = document.createElement('style');
    st.textContent = 'body > div, #hud, #crosshair, #viewfinder { display: none !important; }';
    document.head.append(st);
    if (g.viewmodel) g.viewmodel.update = () => {};
    for (const c of g.camera.children) if (!c.isLight && c !== g.flashlight.light.target) { c.visible = false; Object.defineProperty(c, 'visible', { get: () => false, set: () => {} }); }
  });
  for (const [name, x, z, lx, lz, pitch, light] of VIEWS) {
    await page.evaluate(([x, z, lx, lz, pitch, light]) => {
      const g = __game, p = g.player;
      g.input.keys.delete('KeyC');
      if (x === 'side') {                // crouched on the shoulder, torch along the rut
        const tr = g.map.trails[1], a = tr[1], b = tr[2], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        const mx = a.x + dx * 0.35, mz = a.z + dz * 0.35, nx = -dz / len, nz = dx / len;
        x = mx + nx * 2.3; z = mz + nz * 2.3; lx = mx + dx / len * 9; lz = mz + dz / len * 9;
        g.input.keys.add('KeyC');
      }
      p.position.set(x, g.map.heightAt(x, z), z); p.velocity.set(0, 0, 0);
      p.yaw = Math.atan2(-(lx - x), -(lz - z)); p.pitch = pitch;
      if (g.flashlight.on !== light) g.flashlight.toggle();
      g.flashlight.battery = 1;
    }, [x, z, lx, lz, pitch, light]);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  // Geometry reveal (not an in-game view): a raking low light over a trail from 3 m up.
  await page.evaluate(() => {
    const g = __game, { THREE } = g, p = g.player, tr = g.map.trails[1], a = tr[1], b = tr[2];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const mx = a.x + dx * 0.3, mz = a.z + dz * 0.3;
    if (g.flashlight.on) g.flashlight.toggle();
    g.scene.fog = null;
    const sun = new THREE.DirectionalLight(0xfff0d8, 6);
    sun.position.set(mx - uz * 20, 2.2, mz + ux * 20); sun.target.position.set(mx, 0, mz);
    g.scene.add(sun, sun.target, new THREE.AmbientLight(0x8090a0, 0.6));
    g.player.update = () => {};
    g.camera.position.set(mx - ux * 3 + uz * 1.5, 3, mz - uz * 3 - ux * 1.5);
    g.camera.lookAt(mx + ux * 8, -0.1, mz + uz * 8);
  });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/05-geometry-reveal-raking-light-${suffix}.png` });
}

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
