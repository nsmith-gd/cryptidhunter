// Chupacabra (#93) captures in the real game pipeline, Blackwater Swamp: a lit turntable and face
// close-up, animation frame strips (idle, walk, run, crouch before the leap) plus GIFs, and an
// in-game night shot by torchlight. Run: npm run build && node tools/capture-t93.mjs [outDir]
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t93';
mkdirSync(out, { recursive: true });
const PORT = 4593;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?map=swamp&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
const info = await page.evaluate(() => {
  const g = __game;
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.overlay?.classList.add('hidden');
  g.huntFailure.enabled = false;
  g.player.update = () => {};
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  for (const ch of g.camera.children) if (!ch.isLight && ch !== g.flashlight.light.target) Object.defineProperty(ch, 'visible', { get: () => false, set: () => {} });
  const c = g.chupacabra;
  c.update = () => {};
  g.mothman.mesh.visible = false; g.mothman.update = () => {};
  const L = g.map.landmarks.island;
  g.spot = { x: L.x, z: L.z };
  c.mesh.position.set(L.x, 0.34 + 0.275, L.z);       // standing on the mud island deck
  c.mesh.visible = true;
  g.orbit = (heading, dist, camY, lookY) => {
    const s = g.spot; c.mesh.rotation.y = heading;
    g.camera.position.set(s.x, camY, s.z + dist); g.camera.lookAt(s.x, lookY, s.z);
    g.flashlight.battery = 1;
  };
  g.pose = (dt, speed, state, n = 1) => { for (let i = 0; i < n; i++) c.model.userData.animate(dt, speed, state); };
  g.pose(1 / 30, 0, 'idle', 30);
  let tris = 0; c.model.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { tris: Math.round(tris), skinned: c.model.children[0].children.some((o) => o.isSkinnedMesh), bones: Object.keys(c.model.userData.bones).length };
});
console.log('model', info);
const render = () => page.evaluate(() => { const g = __game; g.renderer.render(g.scene, g.camera); g.sim?.frame?.(0); });
const snap = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); };

// Studio light for the turntable.
await page.evaluate(() => {
  const g = __game, THREE = g.THREE, s = g.spot;
  const key = new THREE.DirectionalLight(0xffe2c0, 2.6); key.position.set(s.x + 3, 4, s.z + 4); key.target.position.set(s.x, 0.6, s.z);
  const rim = new THREE.DirectionalLight(0x8fd0b0, 1.8); rim.position.set(s.x - 3, 3, s.z - 4); rim.target.position.set(s.x, 0.6, s.z);
  const fill = new THREE.HemisphereLight(0x8a96a8, 0x2a2018, 1.0);
  g.studio = [key, key.target, rim, rim.target, fill];
  g.scene.add(...g.studio);
  if (g.flashlight.on) g.flashlight.toggle();
});
for (const [n, h, d, cy, ly] of [['0-side', Math.PI / 2, 2.4, 0.95, 0.65], ['1-three-quarter', 0.7, 2.2, 1.0, 0.65], ['2-front', 0, 2.0, 0.9, 0.7],
  ['3-back', Math.PI, 2.4, 1.1, 0.6], ['4-face', 0.35, 0.95, 1.0, 0.95]]) {
  await page.evaluate(([h, d, cy, ly]) => __game.orbit(h, d, cy, ly), [h, d, cy, ly]);
  await render(); await snap(`turntable-${n}`);
}

// Animation strips: side view, frames every 1/15 s.
const frames = `${out}/_frames`;
for (const [clip, speed, state, n] of [['idle', 0, 'idle', 16], ['walk', 1.8, 'stalk', 16], ['run', 9, 'charge', 12], ['crouch', 0, 'windup', 10]]) {
  rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
  await page.evaluate(() => __game.orbit(Math.PI / 2, 2.6, 0.9, 0.55));
  for (let i = 0; i < n; i++) {
    await page.evaluate(([sp, st]) => __game.pose(1 / 15, sp, st, 2), [speed, state]);
    await render();
    await page.screenshot({ path: `${frames}/${String(i).padStart(2, '0')}.png`, clip: { x: 230, y: 90, width: 500, height: 360 } });
  }
  execSync(`ffmpeg -loglevel error -y -framerate 12 -i ${frames}/%02d.png -vf "scale=400:-1:flags=neighbor,split[a][b];[a]palettegen[p];[b][p]paletteuse" ${out}/anim-${clip}.gif`);
  execSync(`convert ${frames}/0[0-7].png -resize 240x +append ${out}/strip-${clip}.png`);
}
rmSync(frames, { recursive: true, force: true });

// In game: night, torch only, 5 m away on the boardwalk.
await page.evaluate(() => { const g = __game; g.scene.remove(...g.studio); if (!g.flashlight.on) g.flashlight.toggle(); g.pose(1 / 30, 0, 'idle', 10); });
for (const [n, h, d] of [['game-torch-5m', 0.5, 5], ['game-torch-9m', 0.2, 9]]) {
  await page.evaluate(([h, d]) => __game.orbit(h, d, 1.6 + 0.34, 0.6), [h, d]);
  await render(); await snap(n);
}
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'ok');
await browser.close();
server.kill();
