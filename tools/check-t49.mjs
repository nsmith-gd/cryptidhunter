// Night lighting baseline captures + checks on Pine Hollow (?map=forest).
// Frames landmark views with the flashlight OFF (can you find your way by silhouette?) and ON.
// Also measures that landmarks stand out from the sky/haze behind them without the flashlight.
// Run: npm run check:t49 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t49';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4328', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto('http://localhost:4328/?map=forest&nodebugai');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden');
  g.cryptids.update = () => {}; g.huntFailure.enabled = false;
  for (const c of g.cryptids.cryptids) c.mesh.visible = false;
  // Clean frames: hide the HUD and any overlays.
  const st = document.createElement('style');
  st.textContent = 'body > div, #hud, #crosshair, #trail-compass, #trail-hint, #journal { display: none !important; }';
  document.head.append(st);
});
const L = await page.evaluate(() => __game.map.landmarks);

const setLight = (on) => page.evaluate((on) => { if (__game.flashlight.on !== on) __game.flashlight.toggle(); __game.flashlight.battery = 1; }, on);
const view = async (name, x, z, lookX, lookZ, pitch = 0) => {
  await page.evaluate(([x, z, lookX, lookZ, pitch]) => {
    const p = __game.player; p.position.set(x, 0, z); p.velocity.set(0, 0, 0);
    p.yaw = Math.atan2(-(lookX - x), -(lookZ - z)); p.pitch = pitch;
  }, [x, z, lookX, lookZ, pitch]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png` });
};
// Mean luminance of a screen rectangle (fractions of the frame), from the canvas.
const lum = (x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => {
  const src = __game.renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const d = g.getImageData(Math.floor(x0 * c.width), Math.floor(y0 * c.height), Math.max(1, Math.floor((x1 - x0) * c.width)), Math.max(1, Math.floor((y1 - y0) * c.height))).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return +(s / (d.length / 4)).toFixed(1);
}, [x0, y0, x1, y1]);

// --- Flashlight OFF: navigate by silhouette ---
await setLight(false);
await view('01-trailhead-north-light-off', L.trailhead.x, L.trailhead.z, 0, 90, 0.04);
const trailheadSky = await lum(0.3, 0.05, 0.7, 0.25), trailheadGround = await lum(0.3, 0.75, 0.7, 0.95);
await view('02-cabin-light-off', L.cabin.x + 14, L.cabin.z + 9, L.cabin.x, L.cabin.z, 0.03);
await view('03-footbridge-creek-light-off', 35, 34, 35, 20, -0.12);
await view('04-ridge-pass-light-off', 19, -36, 19, -62, 0.06);
// Lookout tower against the moonlit northern sky: tower column vs the sky beside it.
await view('05-lookout-silhouette-light-off', 70, -76, 70, -88, 0.55);
const tower = await page.evaluate(() => {
  const g = __game, L = g.map.landmarks, v = new g.THREE.Vector3(L.lookout.x, 10, L.lookout.z).project(g.camera);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
});
const towerLum = await lum(tower.x - 0.012, tower.y - 0.03, tower.x + 0.012, tower.y + 0.03);
const besideLum = await lum(tower.x + 0.09, tower.y - 0.03, tower.x + 0.13, tower.y + 0.03);
await view('06-creek-trail-north-light-off', 28, -16, 22, -40, 0.08);
const deepSky = await lum(0.35, 0.02, 0.65, 0.2), deepTrees = await lum(0.02, 0.3, 0.2, 0.6);

// --- Flashlight ON ---
await setLight(true);
await view('07-trail-light-on', 31, 66, 38, 50, -0.2);
const lit = await lum(0.4, 0.5, 0.6, 0.75);
await setLight(false);
await view('07b-trail-light-off-same-view', 31, 66, 38, 50, -0.2);
const unlit = await lum(0.4, 0.5, 0.6, 0.75);
await setLight(true);
await view('08-cabin-porch-light-on', L.cabin.x + 9, L.cabin.z + 4, L.cabin.x + 4, L.cabin.z, -0.05);

check('sky is brighter than the ground at the trailhead (silhouettes have something to read against)', trailheadSky > trailheadGround + 4, { trailheadSky, trailheadGround });
check('the lookout tower reads as a dark silhouette against the sky beside it', besideLum - towerLum > 6, { towerLum, besideLum });
check('tree line stands out against the sky along the creek trail', deepSky - deepTrees > 4, { deepSky, deepTrees });
check('without the flashlight it is still dark (need the light for detail)', unlit < 40, { unlit });
// (The forest texture set made the moonlit trail brighter, so the ratio is a little lower.)
check('the flashlight clearly lights things up', lit > unlit * 1.8 && lit - unlit > 15, { lit, unlit });
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
