// Bigfoot animation on the new body (#59). Run: npm run check:t59 [outDir]
// Checks, on the real in-game Bigfoot (the #58 skinned model with the #78 procedural body):
//   1. every behaviour state the AI can enter plays its matching clip (at rest, walking, running);
//   2. no missing bones: every bone the clips and the procedural body drive exists on the skeleton,
//      and the skinned mesh binds only to real bones;
//   3. wood knocks: each knock sound lands on a strike frame (the fist's lowest point on the trunk);
//   4. records a torchlit GIF of every clip in the forest for review.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const args = process.argv.slice(2), gifs = args.includes('--gif'), only = args.find((a) => a.startsWith('--only='))?.slice(7);
const out = args.find((a) => !a.startsWith('--')) || '.ballast/media/t59';
mkdirSync(out, { recursive: true });
const PORT = 4359;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// States the AI can put Bigfoot in (read from the source, so a new state without a clip fails here).
const src = ['src/cryptids/cryptidAI.js', 'src/cryptids/brains/bigfootBrain.js'].map((f) => readFileSync(f, 'utf8')).join('\n');
const states = [...new Set([...src.matchAll(/setState\('([a-z]+)'/g)].map((m) => m[1]).concat('roam'))].sort();
// The design: what each state should look like (GDD behaviour -> clip). Locomotion picks by speed.
const EXPECT = {
  roam: ['idle', 'walk', 'run'], investigate: ['investigate', 'investigate', 'investigate'], flee: ['flee', 'flee', 'flee'],
  shadow: ['prowl', 'prowl', 'prowl'], observe: ['stare', 'stare', 'run'], warn: ['stare', 'stare', 'run'], aggress: ['stare', 'stare', 'run'],
};
const SPEEDS = [0, 1.5, 5];
// Bones the clips and the procedural body drive (bones.name and bones[`name${side}`] forms).
const animSrc = ['src/cryptids/bigfootAnim.js', 'src/cryptids/bigfootBody.js'].map((f) => readFileSync(f, 'utf8')).join('\n');
const used = new Set([...animSrc.matchAll(/bones\.([a-zA-Z]+[LR0-9]?)\b/g)].map((m) => m[1]));
// Template names: ${side}/${s} stand for L and R, ${f} for finger 0-3 (as the rig builds them).
const expand = (name) => {
  const m = name.match(/\$\{([\w.]+)\}/);
  if (!m) return [name];
  const vals = m[1] === 'f' ? ['0', '1', '2', '3'] : ['L', 'R'];
  return vals.flatMap((v) => expand(name.replace(m[0], v)));
};
for (const m of animSrc.matchAll(/bones\[`([^`]+)`\]/g)) for (const n of expand(m[1])) used.add(n);

await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.huntFailure.enabled = false;
  g.cryptids.update = () => {};
  window.__bf = g.cryptids.cryptids.find((c) => /bigfoot/i.test(c.profile.id ?? c.profile.name));
});

// 1. State -> clip, on the in-game model.
const mapping = await page.evaluate(([states, speeds]) => {
  const ud = __bf.mesh.userData, got = {};
  for (const s of states) {
    got[s] = speeds.map((sp) => { for (let i = 0; i < 40; i++) ud.animate(1 / 60, sp, s); return ud.clip; });
  }
  return got;
}, [states, SPEEDS]);
const wrong = states.filter((s) => !EXPECT[s] || EXPECT[s].some((c, i) => mapping[s][i] !== c));
check('every AI state plays its matching clip at rest, walking and running', wrong.length === 0, { states, wrong: wrong.map((s) => ({ s, got: mapping[s], want: EXPECT[s] })) });
const reached = new Set(Object.values(mapping).flat().concat('knock'));
const ALL = ['idle', 'walk', 'run', 'flee', 'investigate', 'prowl', 'stare', 'knock'];
check('all eight clips are in use (idle, walk, run, flee, investigate, prowl, stare, knock)', ALL.every((c) => reached.has(c)), [...reached]);

// 2. Bones.
const bones = await page.evaluate((used) => {
  const root = __bf.mesh, b = root.userData.bones, missing = used.filter((n) => !b[n]);
  const skinned = []; root.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  let badRefs = 0, maxIdx = 0, outside = 0;
  for (const m of skinned) {
    badRefs += m.skeleton.bones.filter((x) => !x).length;
    const si = m.geometry.attributes.skinIndex.array; for (const i of si) maxIdx = Math.max(maxIdx, i);
    if (maxIdx >= m.skeleton.bones.length) badRefs++;
    for (const x of m.skeleton.bones) { let p = x; while (p && p !== root) p = p.parent; if (!p) outside++; }
  }
  return { used: used.length, missing, skinnedMeshes: skinned.length, bones: skinned[0]?.skeleton.bones.length, maxSkinIndex: maxIdx, badRefs, outside };
}, [...used]);
check('no missing bones: every bone the clips drive exists, and the skin binds only to real bones', bones.missing.length === 0 && bones.skinnedMeshes > 0 && bones.badRefs === 0 && bones.outside === 0, bones);

// 3. Knock timing: the sound schedule vs the fist's strike frames.
const knock = await page.evaluate(() => {
  const g = __game, c = __bf, ud = c.mesh.userData, { THREE } = g;
  g.player.position.set(c.agent.x + 10, 0, c.agent.z);
  let sched = null;
  const orig = g.knocks.audio.knock.bind(g.knocks.audio);
  g.knocks.audio.knock = (o) => { if (o.heavy) sched = o; };
  g.knocks.rand = () => 0.99;                              // three knocks
  for (let i = 0; i < 30; i++) ud.animate(1 / 60, 0, 'roam');
  g.knocks.cryptidKnock(c, 'call');
  g.knocks.audio.knock = orig;
  const kt = ud.knockTiming, dt = 1 / 240, hand = ud.bones.handR, v = new THREE.Vector3(), ys = [];
  for (let t = 0; t < 4 && ud.action; t += dt) { ud.animate(dt, 0, 'roam'); c.mesh.updateMatrixWorld(true); ys.push(hand.getWorldPosition(v).y); }
  const minima = [];
  for (let i = 2; i < ys.length - 2; i++) if (ys[i] < ys[i - 1] && ys[i] <= ys[i + 1] && ys[i] < ys[i - 2] && ys[i] <= ys[i + 2]) minima.push(+((i + 1) * dt).toFixed(3));
  const sounds = sched ? [...Array(sched.count)].map((_, i) => +(sched.delay + i * kt.gap).toFixed(3)) : [];
  return { count: sched?.count, sounds, strikes: minima, clipLength: +(ys.length * dt).toFixed(2) };
});
const offsets = knock.sounds.map((s) => Math.min(...knock.strikes.map((m) => Math.abs(m - s))));
check('each Bigfoot knock sound lands on a strike frame (within one frame, 1/60 s)', knock.count === 3 && offsets.length === 3 && offsets.every((o) => o <= 1 / 60 + 1e-3), { ...knock, offsets: offsets.map((o) => +o.toFixed(3)) });

// 4. Torchlit GIF of every clip in the forest (slow in software rendering: only with --gif).
console.log(results.join('\n'));
if (gifs) {
const frames = `${out}/_frames`;
await page.evaluate(() => {
  const g = __game, c = __bf, p = g.player;
  const st = document.createElement('style');
  st.textContent = 'body > div, #hud, #crosshair, #viewfinder { display: none !important; }';
  document.head.append(st);
  if (g.viewmodel) g.viewmodel.update = () => {};
  for (const ch of g.camera.children) if (!ch.isLight && ch !== g.flashlight.light.target) { ch.visible = false; Object.defineProperty(ch, 'visible', { get: () => false, set: () => {} }); }
  if (g.fear) { g.fear.update = () => {}; g.fear.applySway = () => {}; }
  const L = g.map.landmarks.hollow;
  window.__spot = L;
  c.agent.x = L.x; c.agent.z = L.z; c.agent.heading = -Math.PI * 0.3; c.syncMesh(); c.mesh.visible = true;
  if (!g.flashlight.on) g.flashlight.toggle(); g.flashlight.battery = 1;
  // A fixed three-quarter camera 8 m off, at eye height, aimed at his chest; the torch follows it.
  window.__aim = () => {
    const cam = g.camera;
    cam.position.set(L.x + 6, 1.65, L.z + 5.3);
    cam.lookAt(c.mesh.position.x, 2.1, c.mesh.position.z);
    cam.updateMatrixWorld(true);
  };
});
const CLIPS = [['idle', 0, 'roam'], ['walk', 1.5, 'roam'], ['run', 5, 'roam'], ['flee', 5, 'flee'], ['investigate', 0.8, 'investigate'], ['prowl', 1.0, 'shadow'], ['stare', 0, 'warn'], ['knock', 0, 'roam']];
for (const [name, speed, state] of CLIPS) {
  if (only && name !== only) continue;
  rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
  await page.evaluate(([speed, state, name]) => {
    const c = __bf, ud = c.mesh.userData;
    window.__clip = { speed, state };
    ud.look = name === 'stare' ? { target: __game.camera.position, weight: 1 } : null;
    for (let i = 0; i < 60; i++) ud.animate(1 / 60, speed, state);
    if (name === 'knock') ud.play('knock', { count: 3 });
  }, [speed, state, name]);
  const n = name === 'knock' ? 30 : 22;
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => {
      const g = __game, c = __bf, ud = c.mesh.userData, { speed, state } = __clip;
      for (let k = 0; k < 4; k++) {
        // Walk him on the spot (the planted feet follow the ground under him, so move the root).
        const dt = 1 / 60;
        c.agent.x -= Math.sin(c.agent.heading) * speed * dt; c.agent.z -= Math.cos(c.agent.heading) * speed * dt;
        c.syncMesh(); ud.animate(dt, speed, state);
      }
      if (speed > 0) { const L = __spot; const d = Math.hypot(c.agent.x - L.x, c.agent.z - L.z); if (d > 3) { c.agent.x = L.x; c.agent.z = L.z; } }
      __aim(); g.flashlight.update?.(0);
      g.renderer.render(g.scene, g.camera);
    });
    await page.screenshot({ path: `${frames}/${String(i).padStart(3, '0')}.png` });
  }
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '11', '-i', `${frames}/%03d.png`, '-vf', 'split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none', `${out}/${String(CLIPS.findIndex((c) => c[0] === name) + 1).padStart(2, '0')}-${name}.gif`]);
  if (name === 'stare' || name === 'knock') spawnSync('cp', [`${frames}/${String(Math.floor(n * 0.4)).padStart(3, '0')}.png`, `${out}/still-${name}.png`]);
}
rmSync(frames, { recursive: true, force: true });
}

check('no page errors', errors.length === 0, errors);
console.log(results.slice(-1).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
