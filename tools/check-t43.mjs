// Bigfoot animation set: idle, walk, run, flee, investigate, look-around, knock.
// Records each as a GIF (side view, lit), checks cycles loop seamlessly, clips look distinct, and the
// knock plays from a real in-game wood knock. Run: npm run check:t43 [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t43';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4403', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
await page.goto('http://localhost:4403/?nodebugai');
await page.waitForFunction(() => window.__game);

// 1) A real wood knock plays the knock animation, and it finishes on its own.
const knock = await page.evaluate(async () => {
  const g = __game; g.overlay.classList.add('hidden'); g.huntFailure.enabled = false;
  const c = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  g.knocks.cryptidKnock(c, 'call');
  const started = c.mesh.userData.action;
  await new Promise((r) => setTimeout(r, 4500));
  return { started, after: c.mesh.userData.action };
});
check('a wood knock plays the knock animation, then returns to normal', knock.started === 'knock' && knock.after === null, knock);

// Studio setup: freeze the AI, park Bigfoot in the open, light it, hide the HUD.
await page.evaluate(() => {
  const g = __game;
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.cryptids.update = () => {};
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  for (const ch of g.camera.children) if (!ch.isLight && ch !== g.flashlight.light.target) Object.defineProperty(ch, 'visible', { get: () => false, set: () => {} });
  const c = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  g.bf = c; if (c.awarenessBar) c.awarenessBar.visible = false;
  c.mesh.position.set(0, 0, -5); c.mesh.rotation.y = 0;
  g.fill = new g.THREE.PointLight(0xffb070, 16, 18, 1.4); g.fill.position.set(3.5, 3.2, -3); g.scene.add(g.fill);
  const p = g.player; p.position.set(6.2, 0, -5); p.yaw = Math.PI / 2; p.pitch = 0.2; p.velocity.set(0, 0, 0);
});
await page.waitForTimeout(400);

// Pose signature: every bone's rotation, for loop and distinctness checks.
const pose = () => page.evaluate(() => {
  const b = __game.bf.mesh.userData.bones, v = [];
  for (const k of ['hips', 'spine', 'chest', 'neck', 'thighL', 'thighR', 'shinL', 'shinR', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR'])
    v.push(b[k].rotation.x, b[k].rotation.y, b[k].rotation.z);
  v.push(b.hips.position.y);
  return v;
});
const diff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
// Loop check: the stride-driven body only (head scanning / glancing runs on its own clock, so it never seams).
const NECK = [9, 10, 11];
const bodyDiff = (a, b) => Math.max(...a.map((x, i) => (NECK.includes(i) ? 0 : Math.abs(x - b[i]))));
const step = (dt, speed, state, n = 1) => page.evaluate(([dt, speed, state, n]) => {
  for (let i = 0; i < n; i++) __game.bf.mesh.userData.animate(dt, speed, state);
}, [dt, speed, state, n]);

const CLIPS = [
  // name, speed (m/s), AI state, cycle seconds (one full stride cycle: 2 * stride / speed)
  ['idle', 0, 'roam', 4.4],
  ['walk', 1.8, 'roam', 2 * 1.5 * 1.55 / 1.8],
  ['run', 8.5, 'flee', 2 * 1.5 * 1.55 * 1.9 / 8.5],
  ['investigate-walk', 1.3, 'investigate', 2 * 1.5 * 1.55 * 0.75 / 1.3],
  ['investigate-look', 0, 'investigate', 5.4],
  ['stare', 0, 'observe', 4.4],
];
const sigs = {};
for (const [name, speed, state, cycle] of CLIPS) {
  await step(1 / 30, speed, state, 120);                         // settle the blends
  const frames = 30, dt = cycle / frames, dir = `${out}/_f_${name}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const first = await pose();
  for (let i = 0; i < frames; i++) {
    await step(dt, speed, state);
    await page.waitForTimeout(40);
    await page.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: { x: 230, y: 0, width: 500, height: 540 } });
  }
  sigs[name] = first;
  if (speed > 0) { const end = await pose(); check(`${name} loops seamlessly (body pose after one stride cycle matches the start)`, bodyDiff(first, end) < 0.06, { maxBoneDelta: +bodyDiff(first, end).toFixed(3) }); }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(Math.round(frames / cycle)), '-i', `${dir}/%03d.png`,
    '-vf', 'scale=300:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none', `${out}/${name}.gif`]);
  rmSync(dir, { recursive: true, force: true });
}
// Knock (one-shot, 3 strikes), from idle.
{
  await step(1 / 30, 0, 'roam', 60);
  await page.evaluate(() => __game.bf.mesh.userData.play('knock', { count: 3 }));
  const dir = `${out}/_f_knock`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  let i = 0, peak = -Infinity;
  while (await page.evaluate(() => __game.bf.mesh.userData.action) && i < 120) {
    await step(1 / 20, 0, 'roam');
    peak = Math.max(peak, (await pose())[27]);                     // upperArmR.x
    await page.waitForTimeout(40);
    await page.screenshot({ path: `${dir}/${String(i++).padStart(3, '0')}.png`, clip: { x: 230, y: 0, width: 500, height: 540 } });
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '20', '-i', `${dir}/%03d.png`,
    '-vf', 'scale=300:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none', `${out}/knock.gif`]);
  rmSync(dir, { recursive: true, force: true });
  check('knock raises the arm overhead and finishes by itself', peak > 2.3 && i < 120, { frames: i, peakArm: +peak.toFixed(2) });
}
const names = Object.keys(sigs);
const minPair = Math.min(...names.flatMap((a, i) => names.slice(i + 1).map((b) => diff(sigs[a], sigs[b]))));
check('every clip has a visibly different pose', minPair > 0.05, { minDifference: +minPair.toFixed(3) });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
