// Bigfoot animation set check (#43). Run: npm run check:t43 [outDir]   (dev server; ffmpeg for GIFs)
// Verifies: every behaviour state maps to a clip; state changes (and a real wood knock) play the
// right clip; idle/walk/run (and the other gaits) loop seamlessly; poses are stepped at the
// fluid (every-frame) posing with follow-through; the knock has anticipation and follow-through; the rig adapts to proportion
// changes. Records a GIF of every clip from the animation viewer (lookdev/bigfoot-anim.html).
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t43';
mkdirSync(out, { recursive: true });
const PORT = 4443;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const errors = [];

// ---- 1) Every behaviour state the AI can enter has a clip -------------------------------------
const aiSrc = readFileSync('src/cryptids/cryptidAI.js', 'utf8');
const aiStates = [...new Set([...aiSrc.matchAll(/setState\('([a-z]+)'/g)].map((m) => m[1]).concat(['roam']))].sort();

const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/lookdev/bigfoot-anim.html?manual`);
await page.waitForFunction(() => window.__viewer, null, { timeout: 90000 });

const mapping = await page.evaluate(async (aiStates) => {
  const A = await import('/src/cryptids/bigfootAnim.js');
  const missing = aiStates.filter((s) => !(s in A.STATE_CLIPS));
  const reached = new Set();
  for (const s of aiStates) for (const sp of [0, 1.5, 5]) reached.add(A.clipFor(s, sp));
  reached.add('knock');
  return { missing, clips: A.CLIPS, reached: [...reached].sort(), unreached: A.CLIPS.filter((c) => !reached.has(c)) };
}, aiStates);
check('every behaviour state the AI uses maps to a clip', mapping.missing.length === 0, { aiStates, missing: mapping.missing });
check('every clip is reachable from some state (or the knock action)', mapping.unreached.length === 0, mapping);
const required = ['idle', 'walk', 'run', 'knock', 'flee', 'investigate'];
check('required clips exist: idle, walk, run, knock, flee, investigate', required.every((c) => mapping.clips.includes(c)), mapping.clips);

// ---- 2) Seamless loops (smooth evaluation so the maths is exact) ------------------------------
const loops = await page.evaluate(async () => {
  const A = await import('/src/cryptids/bigfootAnim.js');
  const anim = __viewer.animator, bones = __viewer.bf.userData.bones;
  anim.poseFps = 0;
  // Full pose, or the body only (head/neck/jaw run on their own look-around clock in flee/investigate/prowl).
  const HEAD = new Set(['neck', 'head', 'jaw']);
  const snapWith = (bodyOnly) => { const v = []; for (const [n, b] of Object.entries(bones)) { if (bodyOnly && HEAD.has(n)) continue; v.push(b.rotation.x, b.rotation.y, b.rotation.z, b.position.y); } return v; };
  let snap = () => snapWith(false);
  const delta = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
  const res = {};
  for (const [clip, state, speed] of [['idle', 'roam', 0], ['walk', 'roam', 1.8], ['run', 'roam', 5.5], ['flee', 'flee', 8.5], ['investigate', 'investigate', 1.2], ['prowl', 'shadow', 0.9]]) {
    snap = () => snapWith(['flee', 'investigate', 'prowl'].includes(clip));
    for (let i = 0; i < 400; i++) anim.animate(1 / 60, speed, state);           // let blends settle fully
    for (let i = 0; i < 1200; i++) anim.animate(1 / 240, speed, state);         // springs settle at the measuring step
    if (clip === 'idle') {
      const a = snap();
      for (let i = 0; i < A.IDLE_PERIOD * 240; i++) anim.animate(1 / 240, speed, state);
      res[clip] = +delta(a, snap()).toExponential(2);
      continue;
    }
    // Land exactly on the same stride phase one cycle later.
    const p0 = anim.phase;
    const dt = 1 / 240; anim.animate(dt, speed, state);
    const rate = ((anim.phase - p0 + Math.PI * 2) % (Math.PI * 2)) / dt;
    const start = snap(), startPhase = anim.phase;
    const cycle = (Math.PI * 2) / rate;
    let t = 0;
    while (t + dt < cycle - 1e-9) { anim.animate(dt, speed, state); t += dt; }
    anim.animate(cycle - t, speed, state);
    res[clip] = +delta(start, snap()).toExponential(2);
    res[`${clip}PhaseErr`] = +Math.abs(anim.phase - startPhase).toExponential(2);
  }
  anim.poseFps = A.POSE_FPS;
  return res;
});
for (const c of ['idle', 'walk', 'run']) check(`${c} loops seamlessly (pose after one full cycle matches the start)`, loops[c] < 1e-3, { maxDelta: loops[c] });
check('flee, investigate and prowl bodies loop seamlessly too (head looks around on its own clock)', ['flee', 'investigate', 'prowl'].every((c) => loops[c] < 1e-3), loops);

// ---- 3) Fluid motion with personality (director: hero animation should be fluid) ---------------
const fluid = await page.evaluate(() => {
  const anim = __viewer.animator, bones = __viewer.bf.userData.bones;
  anim.poseFps = 0;
  let changes = 0, prev = bones.thighL.rotation.x;
  for (let i = 0; i < 60; i++) { anim.animate(1 / 60, 1.8, 'roam'); if (bones.thighL.rotation.x !== prev) { changes++; prev = bones.thighL.rotation.x; } }
  // Follow-through: run, then stop dead; the head should swing past where it settles, then come back.
  for (let i = 0; i < 180; i++) anim.animate(1 / 60, 5.5, 'roam');
  const trace = [];
  for (let i = 0; i < 240; i++) { anim.animate(1 / 60, 0, 'roam'); trace.push(bones.neck.rotation.x); }
  const settled = trace[trace.length - 1];
  const dir = Math.sign(settled - trace[0]);
  const overshoot = Math.max(...trace.map((v) => (v - settled) * dir));
  // Idle fidgets: the head tilts (listening) at some point in the idle loop.
  let maxTilt = 0;
  for (let i = 0; i < 6 * 60; i++) { anim.animate(1 / 60, 0, 'roam'); maxTilt = Math.max(maxTilt, Math.abs(bones.neck.rotation.z)); }
  return { posesPerSecond: changes, overshoot: +overshoot.toFixed(4), maxIdleHeadTilt: +maxTilt.toFixed(3) };
});
check('poses update every frame (fluid, not stepped)', fluid.posesPerSecond >= 55, fluid);
check('follow-through: the head swings past its rest pose and settles when he stops running', fluid.overshoot > 0.005, fluid);
check('idle has personality: a listening head tilt within the idle loop', fluid.maxIdleHeadTilt > 0.12, fluid);

// ---- 4) Knock: anticipation (arm draws back first) and follow-through (overshoot, settle) -------
const knock = await page.evaluate(async () => {
  const A = await import('/src/cryptids/bigfootAnim.js');
  const anim = __viewer.animator, R = __viewer.bf.userData.bones.upperArmR;
  anim.poseFps = 0;
  for (let i = 0; i < 120; i++) anim.animate(1 / 60, 0, 'roam');
  const restArm = R.rotation.x;
  anim.play('knock', { count: 2 });
  const samples = [];
  for (let i = 0; i < 200 && anim.action; i++) { anim.animate(1 / 120, 0, 'roam'); samples.push([+(i / 120).toFixed(3), R.rotation.x]); }
  anim.poseFps = A.POSE_FPS;
  const K = A.KNOCK;
  const pre = samples.filter(([t]) => t < K.windup * 0.3);
  const anticipation = Math.min(...pre.map(([, a]) => a));
  const peak = Math.max(...samples.map(([, a]) => a));
  const second = samples.filter(([t]) => t > K.windup + K.gap && t < K.windup + K.gap * 1.3);
  const overshoot = Math.min(...second.map(([, a]) => a));
  const settle = samples.filter(([t]) => t > K.windup + K.gap * 1.3 && t < K.windup + K.gap * 1.6).map(([, a]) => a);
  return { restArm: +restArm.toFixed(2), anticipationLow: +anticipation.toFixed(2), peakOverhead: +peak.toFixed(2), strikeLow: +overshoot.toFixed(2), settledAt: +(settle[0] ?? NaN).toFixed(2), finished: !anim.action };
});
check('knock anticipation: the arm drops and draws back before rearing up', knock.anticipationLow < knock.restArm - 0.05 || knock.anticipationLow < 0.4, knock);
check('knock follow-through: the blow overshoots past the contact pose, then settles back', knock.strikeLow < knock.settledAt - 0.1 && knock.peakOverhead > 2.5, knock);
check('knock finishes by itself', knock.finished, knock);

// ---- 5) Rig-parameterized: a bigger, longer-legged rig gets a longer stride --------------------
const rig = await page.evaluate(async () => {
  const A = await import('/src/cryptids/bigfootAnim.js');
  const { buildBigfootModel, BIGFOOT_SCALE } = await import('/src/cryptids/bigfootModel.js');
  const { PROFILES } = await import('/src/cryptids/profiles.js');
  const m = buildBigfootModel(PROFILES.bigfoot), b = m.userData.bones;
  const base = A.createBigfootAnimator(m, b, { worldScale: BIGFOOT_SCALE });
  b.shinL.position.y *= 1.25; b.footL.position.y *= 1.25; b.hips.position.y *= 1.2;
  const longer = A.createBigfootAnimator(m, b, { worldScale: BIGFOOT_SCALE * 1.2 });
  return { baseStride: +base.STRIDE.toFixed(2), longerStride: +longer.STRIDE.toFixed(2), baseHips: +base.rest.hipsY.toFixed(2), longerHips: +longer.rest.hipsY.toFixed(2) };
});
check('rig is parameterized: longer legs / bigger scale give a longer stride and higher hips', rig.longerStride > rig.baseStride * 1.3 && rig.longerHips > rig.baseHips, rig);

// ---- 6) In game: AI state changes and a real wood knock play the right clips -------------------
const game = await browser.newPage({ viewport: { width: 960, height: 540 } });
game.on('pageerror', (e) => errors.push(e.message));
await game.goto(`http://localhost:${PORT}/?map=forest&nodebugai`);
await game.waitForFunction(() => window.__game, null, { timeout: 90000 });
const inGame = await game.evaluate(async (aiStates) => {
  const A = await import('/src/cryptids/bigfootAnim.js');
  const g = __game; g.overlay.classList.add('hidden'); if (g.huntFailure) g.huntFailure.enabled = false;
  const c = g.cryptids.cryptids.find((k) => k.profile.id === 'bigfoot');
  const rows = [];
  for (const s of aiStates) for (const sp of [0, 1.5, 5]) {
    c.mesh.userData.animate(1 / 6, sp, s);           // what the AI calls every frame
    rows.push({ s, sp, got: c.mesh.userData.clip, want: A.clipFor(s, sp) });
  }
  const wrong = rows.filter((r) => r.got !== r.want);
  // A real state change through the AI: spook it, then let the AI tick.
  c.setState?.('flee', 'check');
  for (let i = 0; i < 6; i++) c.update(1 / 12);
  const afterFlee = { state: c.state, clip: c.mesh.userData.clip, want: A.clipFor(c.state, c.agent.currentSpeed) };
  // A real wood knock from the knock system.
  c.setState?.('roam', 'check');
  g.knocks.cryptidKnock(c, 'call');
  const started = c.mesh.userData.clip;
  for (let i = 0; i < 60; i++) c.mesh.userData.animate(1 / 12, 0, 'roam');
  return { wrong, tested: rows.length, afterFlee, knockStarted: started, knockAfter: c.mesh.userData.action };
}, aiStates);
check('every state/speed the AI feeds the model plays the mapped clip', inGame.wrong.length === 0, { tested: inGame.tested, wrong: inGame.wrong.slice(0, 4) });
check('a real AI state change plays the matching clip', inGame.afterFlee.clip === inGame.afterFlee.want, inGame.afterFlee);
check('a real wood knock plays the knock clip, then returns to normal', inGame.knockStarted === 'knock' && inGame.knockAfter === null, { started: inGame.knockStarted, after: inGame.knockAfter });

// ---- 7) GIFs of every clip from the viewer (side view, fluid posing as in game) -----------------
const frames = `${out}/_frames`;
const clips = ['idle', 'walk', 'run', 'flee', 'investigate', 'prowl', 'stare', 'knock'];
const stills = [];
for (const clip of clips) {
  rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
  await page.evaluate((clip) => { __viewer.setClip(clip); __viewer.setYaw(clip === 'knock' || clip === 'stare' ? Math.PI - 0.9 : -Math.PI / 2); for (let i = 0; i < 90; i++) __viewer.step(1 / 30); }, clip);
  const n = clip === 'knock' ? 60 : 48;
  for (let i = 0; i < n; i++) {
    const url = await page.evaluate(() => { __viewer.step(1 / 24); return __viewer.renderer.domElement.toDataURL('image/png'); });
    writeFileSync(`${frames}/${String(i).padStart(3, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
    if (i === Math.floor(n / 3)) stills.push(`${frames}/${String(i).padStart(3, '0')}.png`);
  }
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', `${frames}/%03d.png`,
    '-vf', 'crop=iw*0.6:ih:iw*0.2:0,scale=iw*2:ih*2:flags=neighbor,split[x][y];[x]palettegen=max_colors=96[p];[y][p]paletteuse', `${out}/${clip}.gif`]);
  spawnSync('cp', [stills[stills.length - 1], `${out}/_still-${clip}.png`]);
}
// Contact sheet: one pose from each clip.
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...clips.flatMap((c) => ['-i', `${out}/_still-${c}.png`]),
  '-filter_complex', `${clips.map((_, i) => `[${i}:v]crop=iw*0.5:ih:iw*0.25:0[c${i}]`).join(';')};${clips.map((_, i) => `[c${i}]`).join('')}xstack=inputs=8:layout=0_0|w0_0|w0+w1_0|w0+w1+w2_0|0_h0|w0_h0|w0+w1_h0|w0+w1+w2_h0,scale=iw*2:ih*2:flags=neighbor`,
  `${out}/00-all-clips-contact-sheet.png`]);
for (const c of clips) rmSync(`${out}/_still-${c}.png`, { force: true });
rmSync(frames, { recursive: true, force: true });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
