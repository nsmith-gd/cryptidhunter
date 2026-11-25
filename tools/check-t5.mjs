// Automated check for the roam/flee cryptid capsule. Run: npm run check:t5 [outDir]
// Makes first-person screenshots, overhead debug frames and a GIF (needs ffmpeg for the GIF).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t5';
mkdirSync(out, { recursive: true });
const frames = `${out}/_frames`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4319/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  __game.overlay.classList.add('hidden');
  // Test the shared AI on the generic capsule, whatever the level spawns.
  __game.cryptids.clear();
  __game.cryptids.spawn(__game.cryptidProfiles.default, 10, -25);
  // Overhead debug camera with flat fill light, only used for the capture frames.
  const T = __game.camera.constructor; // PerspectiveCamera
  window.__top = new T(50, 960 / 540, 1, 200);
  window.__top.position.set(0, 92, 0);
  window.__top.lookAt(0, 0, 0);
});

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const state = () => page.evaluate(() => {
  const c = __game.cryptids.cryptids[0], p = __game.player.position;
  return { x: +c.agent.x.toFixed(2), z: +c.agent.z.toFixed(2), state: c.state, dist: +c.playerDistance.toFixed(2),
    speed: +c.agent.currentSpeed.toFixed(2), px: +p.x.toFixed(2), pz: +p.z.toFixed(2) };
});
const placePlayer = (x, z, yaw = 0) => page.evaluate(([x, z, yaw]) => {
  const p = __game.player; p.position.set(x, 0, z); p.velocity.set(0, 0, 0); p.yaw = yaw; p.pitch = -0.05;
}, [x, z, yaw]);
const facePlayerAtCryptid = () => page.evaluate(() => {
  const p = __game.player, c = __game.cryptids.cryptids[0].agent;
  p.yaw = Math.atan2(-(c.x - p.position.x), -(c.z - p.position.z)); p.pitch = -0.05;
});
let frameNo = 0;
const overheadFrame = async () => {
  const data = await page.evaluate(() => {
    const { renderer, scene } = __game;
    const fill = new (scene.children.find((o) => o.isHemisphereLight).constructor)(0xffffff, 0x666666, 2.5);
    const fog = scene.fog; scene.fog = null;
    scene.add(fill);
    // Debug-only markers: cryptid = disc (orange roam / red flee) + 10 m flee ring, player = cyan disc.
    const THREEns = __game.THREE;
    const markers = [];
    const disc = (x, z, r, color, ring = false) => {
      const g = ring ? new THREEns.RingGeometry(r - 0.25, r, 48) : new THREEns.CircleGeometry(r, 24);
      const m = new THREEns.Mesh(g, new THREEns.MeshBasicMaterial({ color, transparent: true, opacity: ring ? 0.6 : 1 }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 3.2, z); scene.add(m); markers.push(m);
    };
    for (const c of __game.cryptids.cryptids) {
      disc(c.agent.x, c.agent.z, 1.1, c.state === 'flee' ? 0xff3322 : 0xffaa33);
      disc(c.agent.x, c.agent.z, c.profile.fleeTriggerDistance, 0xff6644, true);
      if (c.agent.path) for (let i = c.agent.index; i < c.agent.path.length; i++) disc(c.agent.path[i].x, c.agent.path[i].z, 0.35, 0xffff66);
    }
    disc(__game.player.position.x, __game.player.position.z, 0.9, 0x33ddff);
    const size = renderer.getSize(new THREEns.Vector2());
    renderer.setSize(960, 540, false);
    renderer.render(scene, window.__top);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.setSize(size.x, size.y, false);
    for (const m of markers) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    scene.remove(fill); scene.fog = fog;
    return url;
  });
  writeFileSync(`${frames}/${String(frameNo++).padStart(4, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
};

// 1) Roam: player parked far away in a corner; the capsule should wander on its own.
await placePlayer(-36, 36);
await page.waitForTimeout(300);
const r0 = await state();
let travelled = 0, prev = r0, stillRoam = true;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(250);
  const s = await state();
  travelled += Math.hypot(s.x - prev.x, s.z - prev.z);
  stillRoam &&= s.state === 'roam';
  prev = s;
  if (i % 2 === 0) await overheadFrame();
}
check('capsule roams on its own (moved > 4 m in 10 s)', travelled > 4, { travelled: +travelled.toFixed(1) });
check('stays calm while player is far away', stillRoam, prev);

// First-person look at it roaming (flashlight on, about 12 m away).
const rs = await state();
await placePlayer(rs.x + 9, rs.z + 9);
await facePlayerAtCryptid();
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/01-roaming-fp.png` });
await placePlayer(-36, 36);
await page.waitForTimeout(500);

// 2) Approach: put the player 7 m away. It should switch to flee and gain distance quickly.
const a0 = await state();
await placePlayer(a0.x + 7, a0.z);
await facePlayerAtCryptid();
await page.waitForTimeout(120);
const fleeStart = await state();
check('switches to FLEE when player is within 10 m', fleeStart.state === 'flee', fleeStart);
await page.screenshot({ path: `${out}/02-flee-start-fp.png` });
let maxSpeed = 0;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  maxSpeed = Math.max(maxSpeed, (await state()).speed);
  await overheadFrame();
}
await facePlayerAtCryptid();
await page.waitForTimeout(100);
await page.screenshot({ path: `${out}/03-fled-fp.png` });
const fleeEnd = await state();
check('runs away (distance grew by > 6 m in 3 s)', fleeEnd.dist - fleeStart.dist > 6, { from: fleeStart.dist, to: fleeEnd.dist });
check('flees faster than it roams', maxSpeed > 4, { maxSpeed });

// 3) Chase: follow it at sprint pace for a while; it should keep running, not get pinned.
for (let i = 0; i < 16; i++) {
  const s = await state();
  const dx = s.x - s.px, dz = s.z - s.pz, d = Math.hypot(dx, dz) || 1;
  // Close in to ~6 m each step.
  await placePlayer(s.x - (dx / d) * 6, s.z - (dz / d) * 6);
  await page.waitForTimeout(250);
  if (i % 2 === 0) await overheadFrame();
}
const chase = await state();
check('keeps fleeing while chased', chase.state === 'flee', chase);

// 4) Calm down: player leaves; it should go back to roaming.
await placePlayer(-36, 36);
await page.waitForTimeout(600);
const calm = await state();
check('returns to ROAM once player is far away', calm.state === 'roam', calm);
for (let i = 0; i < 6; i++) { await page.waitForTimeout(250); await overheadFrame(); }

await page.evaluate(() => {
  const { renderer, scene } = __game;
  scene.fog = null;
});
await overheadFrame();
const fs = await import('node:fs');
fs.copyFileSync(`${frames}/${String(frameNo - 1).padStart(4, '0')}.png`, `${out}/04-overhead.png`);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();

const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '6', '-i', `${frames}/%04d.png`,
  '-vf', 'scale=480:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse', `${out}/roam-flee-overhead.gif`]);
if (ff.status !== 0) console.log('GIF skipped (ffmpeg missing or failed)');
rmSync(frames, { recursive: true, force: true });
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
