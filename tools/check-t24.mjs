// Check + captures for the blockout Bigfoot model. Run: npm run check:t24 [outDir]
// Verifies the model replaced the capsule and animates in game, then records walk / run / idle
// loops (side view, lit by the flashlight) as GIFs plus stills.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t24';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4364', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4364/?nodebugai');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { __game.overlay.classList.add('hidden'); __game.huntFailure.enabled = false; });

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// 1) In game: the Bigfoot is the model (no capsule) and its limbs move as the AI walks it.
await page.waitForTimeout(500);
const model = await page.evaluate(() => {
  const c = __game.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  let capsule = false, meshes = 0;
  c.mesh.traverse((o) => { if (o.isMesh) { meshes++; if (o.geometry.type === 'CapsuleGeometry') capsule = true; } });
  const box = new __game.THREE.Box3().setFromObject(c.mesh);
  return { capsule, meshes, bones: Object.keys(c.mesh.userData.bones ?? {}).length, height: +(box.max.y - box.min.y).toFixed(2) };
});
check('Bigfoot is the blockout model, not the capsule', !model.capsule && model.meshes > 15 && model.height > 3.1 && model.height < 3.8, model);
const swing = await page.evaluate(async () => {
  const c = __game.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  const b = c.mesh.userData.bones, seen = [];
  // Send it somewhere and sample its thigh while the real game loop runs.
  const p = c.agent.grid.randomPoint(c.agent.x, c.agent.z, 25, Math.random);
  c.agent.setDestination(p.x, p.z);
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); seen.push(b.thighL.rotation.x); }
  return { min: Math.min(...seen), max: Math.max(...seen), speed: c.agent.currentSpeed };
});
check('its legs swing while it moves in game', swing.max - swing.min > 0.3, swing);

// 2) Studio-style captures in the game scene: freeze the AI, park it in the open, light it.
await page.evaluate(() => {
  const g = __game;
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.cryptids.update = () => {};
  g.huntFailure.enabled = false;
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  if (g.chupacabra) g.chupacabra.update = () => {};
  for (const ch of g.camera.children) if (!ch.isLight && ch !== g.flashlight.light.target) Object.defineProperty(ch, 'visible', { get: () => false, set: () => {} });
  const c = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  g.bf = c;
  c.awarenessBar && (c.awarenessBar.visible = false);
  c.mesh.position.set(0, 0, -4);
  // Extra warm fill light so the shape reads (like a lantern off to the side).
  g.fill = new g.THREE.PointLight(0xffb070, 6, 14, 1.5); g.fill.position.set(2.5, 2.2, -1.5); g.scene.add(g.fill);
});
const cam = (x, y, z, tx, ty, tz) => page.evaluate(([x, y, z, tx, ty, tz]) => {
  const g = __game; g.flashlight.battery = 1; if (!g.flashlight.on) g.flashlight.toggle();
  // Pose the player so the normal camera follows: eye at (x, y, z) looking at the target.
  const p = g.player;
  p.position.set(x, 0, z); p.velocity.set(0, 0, 0);
  p.yaw = Math.atan2(-(tx - x), -(tz - z));
  p.pitch = Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
}, [x, y, z, tx, ty, tz]).then(() => page.waitForTimeout(250));

const record = async (name, { speed, heading, frames, cycle, view }) => {
  const dir = `${out}/_frames_${name}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  await cam(...view);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(([dt, speed, heading]) => {
      const c = __game.bf;
      c.mesh.rotation.y = heading;
      c.mesh.userData.animate(dt, speed, speed > 3 ? 'flee' : 'roam');
    }, [cycle / frames, speed, heading]);
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: { x: 240, y: 30, width: 480, height: 480 } });
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(Math.round(frames / cycle)), '-i', `${dir}/%03d.png`,
    '-vf', 'scale=360:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none', `${out}/${name}.gif`]);
  rmSync(dir, { recursive: true, force: true });
};
const side = [6.5, 1.7, -4, 0, 1.6, -4];
// Warm up the blend so the loop starts in stride.
await page.evaluate(() => { for (let i = 0; i < 60; i++) __game.bf.mesh.userData.animate(1 / 30, 1.8, 'roam'); });
await record('walk-cycle', { speed: 1.8, heading: 0, frames: 30, cycle: 2 * 1.5 / 1.8, view: side });
await page.evaluate(() => { for (let i = 0; i < 60; i++) __game.bf.mesh.userData.animate(1 / 30, 8.5, 'flee'); });
await record('run-cycle', { speed: 8.5, heading: 0, frames: 24, cycle: 2 * 1.5 * 1.9 / 8.5, view: side });
await page.evaluate(() => { for (let i = 0; i < 60; i++) __game.bf.mesh.userData.animate(1 / 30, 0, 'roam'); });
await record('idle', { speed: 0, heading: Math.PI + 0.6, frames: 30, cycle: 4, view: [4.0, 1.6, -0.6, 0, 1.9, -4] });

// Stills: front three-quarter, flashlight-only from player height (the in-game sighting), side run.
await page.evaluate(() => { const c = __game.bf; c.mesh.rotation.y = Math.PI + 0.4; for (let i = 0; i < 30; i++) c.mesh.userData.animate(1 / 30, 0, 'observe'); });
await cam(1.4, 1.6, -1.2, 0, 2.6, -4);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/01-face-three-quarter.png` });
await page.evaluate(() => { __game.scene.remove(__game.fill); const c = __game.bf; c.mesh.position.set(0, 0, -11); c.mesh.rotation.y = Math.PI - 0.15; });
await cam(0, 1.68, 0, 0, 1.4, -11);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-torchlight-sighting-11m.png` });
await page.evaluate(() => { const c = __game.bf; c.mesh.position.set(0, 0, -4); __game.scene.add(__game.fill); for (let i = 0; i < 9; i++) c.mesh.userData.animate(1 / 30, 8.5, 'flee'); });
await cam(...side);
await page.evaluate(() => { __game.bf.mesh.rotation.y = 0; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-run-pose-side.png` });

// Turnaround: idle pose, lit by the side lantern and the torch, four angles.
await page.evaluate(() => { const c = __game.bf; c.mesh.position.set(0, 0, -4); __game.scene.add(__game.fill); for (let i = 0; i < 40; i++) c.mesh.userData.animate(1 / 30, 0, 'observe'); });
await cam(0, 1.7, 2.6, 0, 1.75, -4);
for (const [i, a] of [[0, Math.PI], [1, Math.PI * 1.5], [2, 0], [3, Math.PI * 0.5]]) {
  await page.evaluate((a) => { __game.bf.mesh.rotation.y = a; }, a);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/turnaround-${i}-${['front', 'left', 'back', 'right'][i]}.png`, clip: { x: 230, y: 0, width: 500, height: 540 } });
}
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
