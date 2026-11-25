// Bigfoot (#58) captures in the real game pipeline: a lit turntable (front, 3/4, side, back, face)
// and in-game night shots in Pine Hollow (torch + moon only). Run: npm run build && node tools/capture-t58.mjs [outDir] [only]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t58';
const only = process.argv[3] || 'all';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4358', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4358/?map=forest&nodebugai');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game;
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.overlay?.classList.add('hidden');
  g.huntFailure.enabled = false;
  g.cryptids.update = () => {};
  g.player.update = () => {};
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  for (const ch of g.camera.children) if (!ch.isLight && ch !== g.flashlight.light.target) Object.defineProperty(ch, 'visible', { get: () => false, set: () => {} });
  const c = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  g.bf = c; if (c.awarenessBar) c.awarenessBar.visible = false;
  const L = g.map.landmarks.trailhead;
  g.spot = { x: L.x, z: L.z - 6 };
  c.mesh.position.set(g.spot.x, 0, g.spot.z);
  for (let i = 0; i < 40; i++) c.mesh.userData.animate(1 / 30, 0, 'observe');
  // Camera placement helper: orbit the creature at a distance / height, looking at a target height.
  g.orbit = (heading, dist, camY, lookY) => {
    const s = g.spot; g.bf.mesh.rotation.y = heading;
    g.camera.position.set(s.x, camY, s.z + dist); g.camera.lookAt(s.x, lookY, s.z);
    g.flashlight.battery = 1;
  };
});
const snap = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); };
const shots = async (prefix, dist, list) => {
  for (const [n, h, camY, lookY, d] of list) {
    await page.evaluate(([h, d, camY, lookY]) => __game.orbit(h, d, camY, lookY), [h, d ?? dist, camY, lookY]);
    await snap(`${prefix}${n}`);
  }
};
if (only === 'all' || only === 'turntable') {
  // Studio: warm key, cool rim and a soft fill so the sculpt and the pixel texture can be judged.
  await page.evaluate(() => {
    const g = __game, THREE = g.THREE, s = g.spot;
    const key = new THREE.DirectionalLight(0xffe2c0, 2.4); key.position.set(s.x + 4, 7, s.z + 6); key.target.position.set(s.x, 2, s.z);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 1.6); rim.position.set(s.x - 5, 5, s.z - 6); rim.target.position.set(s.x, 2, s.z);
    const fill = new THREE.HemisphereLight(0x8a96a8, 0x2a2018, 0.9);
    g.scene.add(key, key.target, rim, rim.target, fill);
    if (g.flashlight.on) g.flashlight.toggle();
  });
  await shots('turntable-', 4.6, [
    ['0-front', Math.PI, 2.3, 2.0], ['1-three-quarter', Math.PI - 0.7, 2.3, 2.0], ['2-side', Math.PI / 2, 2.3, 2.0],
    ['3-back', 0, 2.3, 2.0], ['4-face', Math.PI - 0.3, 3.4, 3.3, 3.0],
  ]);
  await page.evaluate(() => { const g = __game; g.scene.children.filter((o) => o.isDirectionalLight && (o.color.getHex() === 0xffe2c0 || o.color.getHex() === 0x8fb4ff) || o.isHemisphereLight && o.intensity === 0.9).forEach((o) => g.scene.remove(o)); });
}
if (only === 'all' || only === 'game') {
  await page.evaluate(() => { if (!__game.flashlight.on) __game.flashlight.toggle(); });
  await shots('game-', 6, [
    ['torch-6m-front', Math.PI, 1.68, 2.4], ['torch-6m-three-quarter', Math.PI - 0.7, 1.68, 2.4],
    ['torch-14m-front', Math.PI, 1.68, 2.0, 14],
  ]);
}
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'ok');
await browser.close();
server.kill();
