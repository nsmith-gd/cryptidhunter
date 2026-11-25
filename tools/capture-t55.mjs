// Bigfoot turnarounds in the real game pipeline, in Pine Hollow at night (torch + moon only),
// close (6 m) and at distance (25 m). Run: npm run build && node tools/capture-t55.mjs [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t55';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4385', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4385/?map=forest&nodebugai');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game;
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.overlay.classList.add('hidden');
  g.huntFailure.enabled = false;
  g.cryptids.update = () => {};
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  for (const ch of g.camera.children) if (!ch.isLight && ch !== g.flashlight.light.target) Object.defineProperty(ch, 'visible', { get: () => false, set: () => {} });
  const c = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  g.bf = c; if (c.awarenessBar) c.awarenessBar.visible = false;
  // Stand it in the trailhead clearing, idling and staring.
  const L = g.map.landmarks.trailhead;
  g.spot = { x: L.x, z: L.z - 6 };
  c.mesh.position.set(g.spot.x, 0, g.spot.z);
  for (let i = 0; i < 40; i++) c.mesh.userData.animate(1 / 30, 0, 'observe');
});
// Player stands `dist` m south of it at eye height, looking at its chest.
const shot = async (name, heading, dist, north = false) => {
  await page.evaluate(([heading, dist, north]) => {
    const g = __game, p = g.player, s = g.spot;
    g.bf.mesh.rotation.y = heading;
    p.position.set(s.x, 0, s.z + (north ? -dist : dist)); p.velocity.set(0, 0, 0);
    p.yaw = north ? Math.PI : 0; p.pitch = Math.atan2(1.9 - 1.68, dist);
    g.flashlight.battery = 1; if (!g.flashlight.on) g.flashlight.toggle();
  }, [heading, dist, north]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
};
// heading 0 faces -Z (away from the camera); PI faces the player.
for (const [n, h] of [['front', Math.PI], ['three-quarter', Math.PI - 0.7], ['side', Math.PI / 2], ['back', 0]]) await shot(`forest-6m-${n}`, h, 6);
await shot('forest-25m-front', 0, 25, true);       // from the north; heading 0 faces it
await shot('forest-25m-side', Math.PI / 2, 25, true);
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'captured, no page errors');
await browser.close();
server.kill();
