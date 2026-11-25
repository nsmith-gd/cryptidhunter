// Cinematic lighting captures (#36): the same views with the pass off (?nocine, "before") and on
// ("after"), plus frame-rate / draw-call numbers for both. Run: npm run capture:t36 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t36';
mkdirSync(out, { recursive: true });
const PORT = 4336;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const errors = [];
const perf = {};

const VIEWS = [
  // name, x, z, lookX, lookZ, pitch, flashlight
  ['01-trail-north-toward-moon', 22, -38, 19, -62, 0.12, false],
  ['02-cabin-clearing-window-light', -40, 79, -45, 66, 0.02, false],
  ['03-footbridge-creek-shafts', 38, 36, 33, 14, 0.05, false],
  ['04-campsite-embers', 70, 92, 78, 80, 0.0, false],
  ['05-lookout-tower-lamp', 62, -70, 70, -88, 0.32, false],
  ['06-trail-flashlight', 30, 66, 40, 45, -0.15, true],
];

for (const mode of ['before', 'after']) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push(`${mode}: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai${mode === 'before' ? '&nocine' : ''}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden');
    g.cryptids.update = () => {}; for (const c of g.cryptids.cryptids) c.mesh.visible = false;
    if (g.huntFailure) g.huntFailure.enabled = false;
    if (g.fear) { g.fear.update = () => {}; g.fear.applySway = () => {}; }
    const st = document.createElement('style');
    st.textContent = 'body > div, #hud, #crosshair { display: none !important; }';
    document.head.append(st);
    for (const c of g.camera.children) if (!c.isLight && c !== g.flashlight.light.target) { c.visible = false; Object.defineProperty(c, 'visible', { get: () => false, set: () => {} }); }
  });
  for (const [name, x, z, lx, lz, pitch, light] of VIEWS) {
    await page.evaluate(([x, z, lx, lz, pitch, light]) => {
      const g = __game, p = g.player;
      const blocked = (px, pz) => g.map.colliders.some((b) => px > b.min.x - 0.5 && px < b.max.x + 0.5 && pz > b.min.z - 0.5 && pz < b.max.z + 0.5 && b.min.y < 1.5);
      for (let i = 0; blocked(x, z) && i < 200; i++) { const a = i * 2.4; x += Math.cos(a) * 0.2; z += Math.sin(a) * 0.2; }
      p.position.set(x, 0, z); p.velocity.set(0, 0, 0);
      p.yaw = Math.atan2(-(lx - x), -(lz - z)); p.pitch = pitch;
      if (g.flashlight.on !== light) g.flashlight.toggle();
      g.flashlight.battery = 1;
    }, [x, z, lx, lz, pitch, light]);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${out}/${name}-${mode}.png` });
  }
  // Frame cost at the trail view (software renderer: compare before vs after, not absolute).
  await page.evaluate(() => { const p = __game.player; p.position.set(22, 0, -38); p.yaw = 0.12; p.pitch = 0.1; });
  await page.waitForTimeout(800);
  perf[mode] = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res({ fps: +(n / ((performance.now() - t0) / 1000)).toFixed(2), calls: __game.renderer.info.render.calls, tris: __game.renderer.info.render.triangles }); };
    requestAnimationFrame(f);
  }));
  await page.close();
}
writeFileSync(`${out}/perf.json`, JSON.stringify(perf, null, 1));
console.log(JSON.stringify({ perf, errors }, null, 1));
await browser.close();
server.kill();
