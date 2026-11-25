// Automated check for the clue trail. Run: npm run check:t19 [outDir]
// Fast-forwards the cryptid AI in fixed steps, then verifies every clue sits on the route the
// cryptid really walked (the recorded debug path), that clue types vary, and that clues fade out.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t19';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4321', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4321/?debug');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => __game.overlay.classList.add('hidden'));

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// Simulate N seconds of cryptid + clue time in fixed steps (player positions scripted).
const simulate = (seconds, mode) => page.evaluate(([seconds, mode]) => {
  const { cryptids, clueTrails, clues, player } = __game;
  const bf = cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    if (mode === 'chase') {
      // Dog it at ~10 m so it keeps fleeing around the map.
      const dx = bf.agent.x - player.position.x, dz = bf.agent.z - player.position.z, d = Math.hypot(dx, dz) || 1;
      player.position.set(bf.agent.x - (dx / d) * 10, 0, bf.agent.z - (dz / d) * 10);
    } else player.position.set(-36, 0, 36);
    cryptids.update(dt);
    clueTrails.update();
    clues.update(dt);
  }
}, [seconds, mode]);

await simulate(60, 'far');
await simulate(25, 'chase');
await simulate(40, 'far');

const report = await page.evaluate(() => {
  const { cryptids, clueTrails, clues } = __game;
  const bf = cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  const trail = clueTrails.trailFor(bf);
  const reach = bf.profile.clues.scratch.reach;
  const rows = clues.clues.map((c) => ({
    type: c.type,
    originOff: trail.distanceToPath(c.origin.x, c.origin.z),
    posOff: trail.distanceToPath(c.x, c.z),
    fromOrigin: Math.hypot(c.x - c.origin.x, c.z - c.origin.z),
    y: c.y,
  }));
  let pathLen = 0;
  for (let i = 1; i < trail.path.length; i++) pathLen += Math.hypot(trail.path[i].x - trail.path[i - 1].x, trail.path[i].z - trail.path[i - 1].z);
  return { rows, pathLen, pathPoints: trail.path.length, reach, stride: bf.profile.clues.footprint.stride };
});
const by = (t) => report.rows.filter((r) => r.type === t);
const fp = by('footprint'), hair = by('hair'), scratch = by('scratch');
check('clue trail spawned along a long route', report.pathLen > 60, { pathLen: +report.pathLen.toFixed(1), points: report.pathPoints });
check('several clue types appear', fp.length > 20 && hair.length >= 2 && scratch.length >= 1, { footprints: fp.length, hair: hair.length, scratches: scratch.length });
check('footprint count matches distance walked / stride', Math.abs(fp.length - report.pathLen / report.stride) <= 3, { footprints: fp.length, expected: +(report.pathLen / report.stride).toFixed(1) });
const maxFp = Math.max(...fp.map((r) => r.posOff));
check('every footprint lies on the real route (< 0.3 m off)', maxFp < 0.3, { worst: +maxFp.toFixed(3) });
const maxHair = Math.max(...hair.map((r) => r.posOff));
check('every hair tuft lies on the real route (< 0.4 m off)', maxHair < 0.4, { worst: +maxHair.toFixed(3) });
const maxScrOrigin = Math.max(...scratch.map((r) => r.originOff)), maxScrReach = Math.max(...scratch.map((r) => r.fromOrigin));
check('scratches were made from the route, on a surface within reach', maxScrOrigin < 0.3 && maxScrReach <= report.reach + 0.01 && scratch.every((r) => r.y >= 1.7),
  { worstOriginOff: +maxScrOrigin.toFixed(3), farthest: +maxScrReach.toFixed(2) });

// Captures. 1) Overhead of the recorded route (yellow) with clues marked.
const overhead = async (file, cx, cz, h) => {
  const data = await page.evaluate(([cx, cz, h]) => {
    const { THREE, renderer, scene, clues } = __game;
    const cam = new THREE.PerspectiveCamera(50, 960 / 540, 1, 300);
    cam.position.set(cx, h, cz); cam.lookAt(cx, 0, cz);
    const fill = new THREE.HemisphereLight(0xffffff, 0x666666, 2.5);
    const fog = scene.fog; scene.fog = null; scene.add(fill);
    const colors = { footprint: 0x33ccff, hair: 0xff66cc, scratch: 0xff3333 };
    const marks = clues.clues.map((c) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(c.type === 'footprint' ? 0.25 : 0.6, 10), new THREE.MeshBasicMaterial({ color: colors[c.type] }));
      m.rotation.x = -Math.PI / 2; m.position.set(c.x, 3.5, c.z); scene.add(m); return m;
    });
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setSize(960, 540, false);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.setSize(size.x, size.y, false);
    for (const m of marks) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    scene.remove(fill); scene.fog = fog;
    return url;
  }, [cx, cz, h]);
  (await import('node:fs')).writeFileSync(`${out}/${file}`, Buffer.from(data.split(',')[1], 'base64'));
};
await overhead('01-route-and-clues-overhead.png', 0, 0, 92);

// 2) Close overhead on a stretch of fresh footprints, no markers, so the prints themselves show.
const fresh = await page.evaluate(() => {
  const f = __game.clues.clues.filter((c) => c.type === 'footprint').slice(-6);
  return { x: f.reduce((a, c) => a + c.x, 0) / f.length, z: f.reduce((a, c) => a + c.z, 0) / f.length };
});
await page.evaluate(() => __game.clueTrails.setDebug(true));
const closeShot = async (file, cx, cz) => {
  const data = await page.evaluate(([cx, cz]) => {
    const { THREE, renderer, scene } = __game;
    const cam = new THREE.PerspectiveCamera(40, 960 / 540, 0.5, 100);
    cam.position.set(cx, 9, cz + 0.01); cam.lookAt(cx, 0, cz);
    const fill = new THREE.HemisphereLight(0xffffff, 0x666666, 2.2);
    scene.add(fill);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setSize(960, 540, false);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.setSize(size.x, size.y, false);
    scene.remove(fill);
    return url;
  }, [cx, cz]);
  (await import('node:fs')).writeFileSync(`${out}/${file}`, Buffer.from(data.split(',')[1], 'base64'));
};
await closeShot('02-footprints-on-debug-path.png', fresh.x, fresh.z);

// 3) First person: stand over the freshest prints with the flashlight, debug path off.
await page.evaluate(() => __game.clueTrails.setDebug(false));
const view = await page.evaluate(() => {
  const f = __game.clues.clues.filter((c) => c.type === 'footprint').slice(-4);
  const a = f[0], b = f[f.length - 1];
  const p = __game.player, bf = __game.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  bf.update = () => {}; // hold everything still for the shots
  // Stand a few metres back from the first print, looking along the trail.
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
  p.position.set(a.x - (dx / d) * 2.5, 0, a.z - (dz / d) * 2.5);
  p.velocity.set(0, 0, 0);
  p.yaw = Math.atan2(-dx, -dz); p.pitch = -0.55;
  return true;
});
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/03-footprints-fp.png` });

const scr = await page.evaluate(() => {
  const s = __game.clues.clues.filter((c) => c.type === 'scratch').pop();
  if (!s) return null;
  const p = __game.player;
  const nx = s.origin.x - s.x, nz = s.origin.z - s.z, d = Math.hypot(nx, nz) || 1;
  p.position.set(s.x + (nx / d) * 2.2, 0, s.z + (nz / d) * 2.2); p.velocity.set(0, 0, 0);
  p.yaw = Math.atan2(nx, nz); p.pitch = 0.22;
  return true;
});
if (scr) { await page.waitForTimeout(250); await page.screenshot({ path: `${out}/04-scratch-marks-fp.png` }); }

// Fade: advance only clue time. Mid-fade clues are partly transparent; all are gone after their lifetime.
const fade = await page.evaluate(() => {
  const { clues } = __game;
  const n = clues.clues.length;
  const fp = clues.clues.filter((c) => c.type === 'footprint').pop();
  const before = fp.object.children[0].material.opacity;
  clues.update(fp.lifetime * 0.85 - fp.age);
  const mid = fp.object.children[0].material.opacity;
  clues.update(1000);
  return { n, before, mid: +mid.toFixed(2), after: clues.clues.length };
});
check('clues fade over time (opacity drops late in life)', fade.before === 1 && fade.mid > 0 && fade.mid < 0.7, fade);
check('faded clues are removed', fade.after === 0, fade);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
