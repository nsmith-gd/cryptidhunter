// Art captures for the swamp (textured pass). Run: npm run build && node tools/capture-t32.mjs [outDir]
// Hides the HUD and holds fear at zero so the frames show only the world.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t32';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4342', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4342/?map=swamp');
await page.waitForFunction(() => window.__game);
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
await view('01-spawn-dock-north', 0, 0.34, 43.5, 0, 0.0);
await view('02-boardwalk-reeds', 0.4, 0.34, 27, 0.35, -0.42);
await view('03-old-bridge-from-island', -5, 0.34, -3, -0.3, 0.12);
await view('04-on-the-bridge', 0, 2.44, -14.5, 0, -0.08);
await view('05-ranger-shack', -12, 0.34, 17, Math.PI / 2 + 0.2, -0.04);
await view('06-wading-under-bridge', -5, 0, -18.5, -1.25, 0.18);
await view('07-water-tower', 0, 0.34, -33, 0.15, 0.3);
await view('08-moonlight-no-torch', 8, 0, 34, -0.5, 0.02, false);
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'captured, no page errors');
await browser.close();
server.kill();
