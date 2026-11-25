// Terrain path tool / z-fighting check (#61). Run: npm run check:t61
// Verifies Pine Hollow has no flat overlays stacked on the ground (the z-fighting source): trails,
// clearings, creek banks and ground patches are painted into the one terrain surface; the creek is
// a single ribbon; the swamp's deep water uses a depth-bias tier; the camera's near plane is sane.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const PORT = 4462;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai`);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
const forest = await page.evaluate(() => {
  const { THREE, scene, map, camera } = __game;
  const box = new THREE.Box3(), overlays = [], names = new Set();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
    names.add(o.name);
    if (o.name === 'forest-terrain') return;
    box.setFromObject(o);
    const flat = box.max.y - box.min.y < 0.05 && box.max.y < 0.1 && box.min.y > -0.05;
    const area = (box.max.x - box.min.x) * (box.max.z - box.min.z);
    const biased = [].concat(o.material).some((m) => m?.polygonOffset);
    if (flat && area > 1 && !biased && o.name !== 'creek') overlays.push({ name: o.name || '(unnamed)', y: +box.max.y.toFixed(3), area: Math.round(area) });
  });
  const creeks = [];
  scene.traverse((o) => { if (o.isMesh && o.name === 'creek') creeks.push(o); });
  const t = map.terrain;
  const trail = map.trails.flatMap((tr) => tr.slice(0, -1).map((a, i) => ({ x: (a.x + tr[i + 1].x) / 2, z: (a.z + tr[i + 1].z) / 2 })));
  const onTrail = trail.map((p) => t.sample(p.x, p.z, 'dirt'));
  const L = map.landmarks;
  const clearing = ['cabin', 'campsite', 'hollow', 'trailhead'].map((k) => t.sample(L[k].x, L[k].z, 'dirt'));
  return {
    overlays, creekMeshes: creeks.length, kitLitter: !!scene.getObjectByName('kit-litter:0'),
    hasTerrain: names.has('forest-terrain'), onTrailMin: Math.min(...onTrail), clearingMin: Math.min(...clearing),
    deepWoods: t.sample(120, -130, 'dirt'), near: camera.near,
  };
});
check('no flat strips, discs or patches laid over the ground (nothing to z-fight)', forest.hasTerrain && forest.overlays.length === 0 && !forest.kitLitter, { overlays: forest.overlays.slice(0, 5), kitLitter: forest.kitLitter });
check('the creek is one continuous ribbon (no overlapping strips at bends)', forest.creekMeshes === 1, { creekMeshes: forest.creekMeshes });
check('trails are painted into the terrain along their whole length', forest.onTrailMin > 0.9, { weakestTrailPoint: forest.onTrailMin });
check('clearings are painted dirt, deep woods are not', forest.clearingMin > 0.9 && forest.deepWoods < 0.05, { clearingMin: forest.clearingMin, deepWoods: forest.deepWoods });
check('camera near plane is 0.1 m or more (depth precision)', forest.near >= 0.1, { near: forest.near });

await page.goto(`http://localhost:${PORT}/?map=swamp&nodebugai`);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
const swamp = await page.evaluate(() => {
  const deep = []; __game.scene.traverse((o) => { if (o.isMesh && o.name === 'water-deep') deep.push(o.material.polygonOffset); });
  return { deep: deep.length, allBiased: deep.every(Boolean) };
});
check("swamp deep water uses a depth-bias tier over the shallow water", swamp.deep > 0 && swamp.allBiased, swamp);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
