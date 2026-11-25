// Forest kit captures: a lookdev lineup of every variant, then in-game Pine Hollow views.
// Run: node tools/capture-t39.mjs [outDir]   (uses the vite dev server so lookdev/ is served)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t39';
mkdirSync(out, { recursive: true });
const PORT = 4339;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// 1) Lookdev lineup.
await page.goto(`http://localhost:${PORT}/lookdev/forest-kit.html?light=dusk`);
await page.waitForFunction(() => window.__lookdev, null, { timeout: 60000 });
await page.addStyleTag({ content: '#label { display: none; }' });
const ld = async (name, yaw, pitch, dist, target) => {
  await page.evaluate(([y, p, d, t]) => __lookdev.setView(y, p, d, t), [yaw, pitch, dist, target]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png` });
};
await ld('01-kit-lineup-overview', 0.35, 0.42, 58, [0, 2, -6]);
await ld('02-kit-pines-snags', 0.15, 0.12, 34, [0, 6, -22]);
await ld('03-kit-undergrowth-close', 0.25, 0.3, 15, [0, 0.6, -3]);
await ld('04-kit-logs-rocks-close', -0.2, 0.28, 16, [0, 0.6, 6]);

// 2) In game, Pine Hollow at night.
await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai`);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
const stats = await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden');
  g.cryptids.update = () => {}; if (g.huntFailure) g.huntFailure.enabled = false;
  for (const c of g.cryptids.cryptids) c.mesh.visible = false;
  const st = document.createElement('style');
  st.textContent = 'body > div, #hud, #crosshair, #trail-compass, #trail-hint, #journal { display: none !important; }';
  document.head.append(st);
  return { kit: g.map.forestKit, trees: g.map.trees, colliders: g.map.colliders.length };
});
const L = await page.evaluate(() => __game.map.landmarks);
const setLight = (on) => page.evaluate((on) => { if (__game.flashlight.on !== on) __game.flashlight.toggle(); __game.flashlight.battery = 1; }, on);
const view = async (name, x, z, lookX, lookZ, pitch = 0) => {
  await page.evaluate(([x, z, lookX, lookZ, pitch]) => {
    // Step out of any tree/rock/log so the player isn't pushed on top of it.
    const blocked = (px, pz) => __game.map.colliders.some((b) => px > b.min.x - 0.5 && px < b.max.x + 0.5 && pz > b.min.z - 0.5 && pz < b.max.z + 0.5 && b.min.y < 1.5);
    for (let i = 0; blocked(x, z) && i < 200; i++) { const a = i * 2.4, d = 0.3 + i * 0.08; x += Math.cos(a) * d * 0.3; z += Math.sin(a) * d * 0.3; }
    const p = __game.player; p.position.set(x, 0, z); p.velocity.set(0, 0, 0);
    p.yaw = Math.atan2(-(lookX - x), -(lookZ - z)); p.pitch = pitch;
  }, [x, z, lookX, lookZ, pitch]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png` });
};
await setLight(false);
await view('05-trail-north-moonlight', 0, 112, 0, 80, 0.06);
await view('06-creek-banks-moonlight', 35, 33, 30, 12, -0.05);
await view('07-ridge-scree-moonlight', 22, -38, 0, -62, 0.1);
await setLight(true);
await view('08-trail-flashlight', 30, 66, 40, 45, -0.18);
// A mossy log a few metres off a trail: stand on the trail and light it up.
const spot = await page.evaluate(() => {
  const { THREE, scene, map } = __game;
  const pts = [];
  for (const t of map.trails) for (let i = 0; i < t.length - 1; i++) for (let s = 0; s <= 1; s += 0.1) pts.push({ x: t[i].x + (t[i + 1].x - t[i].x) * s, z: t[i].z + (t[i + 1].z - t[i].z) * s });
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  let best = null;
  for (const key of ['kit-log:1', 'kit-log:3', 'kit-log:2']) {
    const im = scene.getObjectByName(key);
    if (!im) continue;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      for (const q of pts) {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > 4.5 && d < 7 && (!best || d < best.d)) best = { d, x: q.x, z: q.z, lx: p.x, lz: p.z };
      }
    }
  }
  return best;
});
if (spot) await view('09-mossy-log-off-trail-flashlight', spot.x, spot.z, spot.lx, spot.lz, -0.32);
await view('10-hollow-log-flashlight', L.hollow.x + 1, L.hollow.z + 2, L.hollow.x + 6, L.hollow.z - 4, -0.25);
await view('11-ferns-creek-flashlight', 35, 30, 28, 26, -0.4);

console.log(JSON.stringify({ stats, errors }, null, 1));
await browser.close();
server.kill();
