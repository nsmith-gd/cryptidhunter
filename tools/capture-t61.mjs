// Terrain / z-fighting captures (#61): tree-heavy forest views, saved with a suffix so a "before" and an
// "after" set can sit side by side. Run: node tools/capture-t60.mjs <suffix> [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const suffix = process.argv[2] || 'after';
const out = process.argv[3] || '.ballast/media/t61';
mkdirSync(out, { recursive: true });
const PORT = 4461;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai`);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
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
const VIEWS = [
  // name, x, z, lookX, lookZ, pitch, flashlight
  ['01-trail-from-trailhead', 0, 128, 0, 100, -0.08, false],
  ['02-fork-trails-meet', 4, 108, -10, 90, -0.12, false],
  ['03-cabin-clearing-ground', -32, 76, -45, 66, -0.1, false],
  ['04-creek-and-banks', 44, 30, 20, 10, -0.12, false],
  ['05-trail-flashlight-close', 30, 66, 38, 50, -0.3, true],
  ['06-campsite-clearing', 64, 88, 78, 82, -0.12, false],
];
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
  await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
}
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'captured, no page errors');
await browser.close();
server.kill();
