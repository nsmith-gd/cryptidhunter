// Atmosphere captures (#37): forest at dusk and night, with and without the fog/mist layers. Run: npm run build && node tools/capture-t37.mjs [outDir]
// Hides the HUD and holds fear at zero so the frames show only the world.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t37';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4357', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const QUERY = process.argv[3] || 'time=night';
const TAG = process.argv[4] || 'night';
await page.goto(`http://localhost:4357/?map=forest&nodebugai&${QUERY}`);
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game;
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  if (g.chupacabra) { g.chupacabra.update = () => {}; g.chupacabra.mesh.visible = false; }
  g.mothman.update = () => {}; g.mothman.mesh.position.set(0, 80, 0);
  g.huntFailure.enabled = false;
  g.player.update = () => {};
  g.flashlight.batteryLifeHold = true;
  // Hide held props (photo camera etc.) so the frame shows the world.
  for (const c of g.camera.children) if (!c.isLight && c !== g.flashlight.light.target) { c.visible = false; Object.defineProperty(c, "visible", { get: () => false, set: () => {} }); }
});
const view = async (name, x, y, z, yaw, pitch, light = true) => {
  await page.evaluate(([x, y, z, yaw, pitch, light]) => {
    const g = __game, p = g.player;
    p.position.set(x, y, z); p.yaw = yaw; p.pitch = pitch; g.flashlight.battery = 1;
    g.camera.position.set(x, y + 1.68, z); g.camera.rotation.set(pitch, yaw, 0);
    g.night?.update(p.position, 5);
    if (g.flashlight.on !== light) g.flashlight.toggle();
  }, [x, y, z, yaw, pitch, light]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png` });
};
// Positions relative to the map's landmarks: long views so foreground / midground / background read.
const L = await page.evaluate(() => __game.map.landmarks);
await view(`${TAG}-01-trail-north-depth`, L.fork.x, 0, L.fork.z + 8, 0.12, 0.04, false);
await view(`${TAG}-02-creek-mist`, L.footbridge.x + 3, 0, L.footbridge.z + 14, 0.25, 0.0, false);
await view(`${TAG}-03-toward-ridge`, L.ridgePass.x - 2, 0, L.ridgePass.z + 40, 0.05, 0.08, false);
await view(`${TAG}-04-clearing-torch`, L.cabin.x + 14, 0, L.cabin.z + 4, 1.35, 0.02, true);
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'captured, no page errors');
await browser.close();
server.kill();
