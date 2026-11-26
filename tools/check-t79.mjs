// Bigfoot #79 check (extends #78): move behaviours + the #78 checks.
// Bigfoot #78 check: organic skinning + procedural (Rain World style) body. Run: node tools/check-t78.mjs [outDir]
// Uses the animation viewer (dev server). Checks: planted feet don't slide while he walks a curving
// path through the world; legs reach their feet (hips don't collapse); the look targets a point
// to his side through spine, chest and neck; skinning doesn't tear (worst triangle stretch across
// gaits stays small). Also records GIF frames of a walk around a curve with targeting.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t79';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', '--port', '4479', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
await page.goto('http://localhost:4479/lookdev/bigfoot-anim.html?manual&clip=idle');
await page.waitForFunction(() => window.__viewer, null, { timeout: 120000 });

// 1) Walk a curving path in the world (root really moves and turns): planted feet stay put.
const walk = await page.evaluate(() => {
  const v = __viewer, bf = v.bf, body = bf.userData.body3;
  bf.userData.look = null;
  let worst = 0, plantedFrames = 0, reach = 0, steps = 0;
  const last = new Map();
  const speeds = [];
  for (let i = 0; i < 420; i++) {
    const dt = 1 / 60, t = i * dt;
    const speed = t < 1 ? t * 1.8 : t < 4 ? 1.8 : t < 5.5 ? 4.5 : 1.8;      // start, walk, surge to a run, back
    const turn = t > 2 && t < 4.5 ? 0.6 : 0;                                    // a curve in the middle
    bf.rotation.y += turn * dt;
    bf.position.x += -Math.sin(bf.rotation.y) * speed * dt;
    bf.position.z += -Math.cos(bf.rotation.y) * speed * dt;
    bf.userData.animate(dt, speed, 'roam');
    reach = Math.max(reach, body.stats.reach);
    for (const f of body.feetWorld()) {
      const prev = last.get(f.side);
      if (f.planted && prev?.planted) { worst = Math.max(worst, Math.hypot(f.p.x - prev.p.x, f.p.z - prev.p.z)); plantedFrames++; }
      if (!f.planted && prev?.planted) steps++;
      last.set(f.side, f);
    }
  }
  return { worstSlidePerFrame: +worst.toFixed(5), plantedFrames, steps, maxHipDrop: +reach.toFixed(3) };
});
check('planted feet stay put in the world while he walks, turns and surges (no foot sliding)', walk.worstSlidePerFrame < 0.002 && walk.plantedFrames > 300 && walk.steps >= 6, walk);
check('legs reach their feet: the hips never have to drop far (no collapsing)', walk.maxHipDrop < 0.3, walk);

// 2) Targeting: a point 80 degrees to his left; the head turns most, chest and spine help (fluid chain).
const look = await page.evaluate(() => {
  const v = __viewer, bf = v.bf, b = bf.userData.bones, THREE = bf.position.constructor;
  bf.position.set(0, 0, 0); bf.rotation.y = 0;
  for (let i = 0; i < 120; i++) bf.userData.animate(1 / 60, 0, 'observe');
  const target = new THREE(-Math.sin(1.4) * 6, 1.7, -Math.cos(1.4) * 6);
  bf.userData.look = { target, weight: 1 };
  const yawOf = (o) => { const q = o.getWorldQuaternion(new o.quaternion.constructor()); const f = new THREE(0, 0, -1).applyQuaternion(q); return Math.atan2(-f.x, -f.z); };
  const trace = [];
  for (let i = 0; i < 150; i++) { bf.userData.animate(1 / 60, 0, 'observe'); bf.updateMatrixWorld(true); if (i % 10 === 9) trace.push(+yawOf(b.head).toFixed(3)); }
  bf.updateMatrixWorld(true);
  return { head: +yawOf(b.head).toFixed(3), chest: +yawOf(b.chest).toFixed(3), spine: +yawOf(b.spine).toFixed(3), want: 1.4, trace };
});
check('targeting: the head turns onto a point to his side, with chest and spine following less', look.head > 1.0 && look.chest > 0.2 && look.chest < look.head && look.spine < look.chest + 0.05, look);
check('targeting is fluid: the head eases onto the target (no snap)', look.trace[0] < look.trace[look.trace.length - 1] - 0.3, look.trace);

// 3) Skinning: worst triangle edge stretch vs the bind pose, over idle/walk/run/flee/prowl/knock poses.
const stretch = await page.evaluate(() => {
  const v = __viewer, bf = v.bf, mesh = bf.getObjectByName('bigfoot-skin'), THREE = bf.position.constructor;
  bf.userData.look = null; bf.position.set(0, 0, 0); bf.rotation.y = 0;
  const pos = mesh.geometry.attributes.position, n = pos.count;
  const bind = []; for (let i = 0; i < n; i++) bind.push(new THREE().fromBufferAttribute(pos, i));
  const res = {};
  const measure = () => {
    bf.updateMatrixWorld(true); mesh.skeleton.update();
    const cur = []; const tmp = new THREE();
    for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, tmp); cur.push(tmp.clone()); }
    let worst = 0, bad = 0;
    for (let t = 0; t < n; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const l0 = bind[t + a].distanceTo(bind[t + b]), l1 = cur[t + a].distanceTo(cur[t + b]);
      // Relative to at least one sculpt cell (~5 cm): tiny sliver edges otherwise read as huge ratios.
      const r = l1 / Math.max(l0, 0.05); worst = Math.max(worst, r); if (r > 2.5) bad++;
    }
    return { worst: +worst.toFixed(2), over2_5: bad };
  };
  for (const [clip, state, speed] of [['idle', 'roam', 0], ['walk', 'roam', 1.8], ['run', 'roam', 5.5], ['flee', 'flee', 8.5], ['prowl', 'shadow', 0.9]]) {
    for (let i = 0; i < 90; i++) bf.userData.animate(1 / 60, speed, state);
    res[clip] = measure();
  }
  bf.userData.play('knock', { count: 2 });
  for (let i = 0; i < 40; i++) bf.userData.animate(1 / 60, 0, 'roam');
  res.knock = measure();
  return res;
});
const worst = Math.max(...Object.values(stretch).map((r) => r.worst));
const bad = Object.values(stretch).reduce((a, r) => a + r.over2_5, 0);
check('skinning: no stretched webs in any gait (worst edge stretch under 3.5x; under 40 of ~60k edges over 2.5x per gait)', worst < 3.5 && Object.values(stretch).every((r) => r.over2_5 < 40), stretch);


// 4) Move behaviours (#79): every AI state plays a named move, and each move changes the body.
const moves = await page.evaluate(async () => {
  const B = await import('/src/cryptids/bigfootBody.js');
  const v = __viewer, bf = v.bf, b = bf.userData.bones, body = bf.userData.body3;
  bf.position.set(0, 0, 0); bf.rotation.y = 0; bf.userData.look = null;
  const states = ['roam', 'investigate', 'observe', 'shadow', 'warn', 'flee', 'aggress'];
  const mapped = {};
  for (const st of states) for (const sp of [0, 1.5, 5]) mapped[`${st}@${sp}`] = B.moveFor(st, sp);
  const head = () => { bf.updateMatrixWorld(true); return b.head.getWorldPosition(new bf.position.constructor()).y; };
  const pose = (state, speed, frames = 240) => {
    const plants0 = body.stats.plants; let swayMax = 0, hipMin = Infinity;
    for (let i = 0; i < frames; i++) { bf.userData.animate(1 / 60, speed, state); swayMax = Math.max(swayMax, Math.abs(b.hips.position.x)); hipMin = Math.min(hipMin, b.hips.position.y); }
    return { move: body.move, headY: +head().toFixed(3), hipsY: +b.hips.position.y.toFixed(3), hipMin: +hipMin.toFixed(3), sway: +swayMax.toFixed(3), armOut: +Math.abs(b.upperArmR.rotation.z).toFixed(3), plants: body.stats.plants - plants0 };
  };
  return { names: Object.keys(B.MOVES), mapped, shift: pose('roam', 0), lumber: pose('roam', 1.8), loom: pose('observe', 0), stalk: pose('shadow', 0.9), search: pose('investigate', 1.2), charge: pose('aggress', 5.5), bolt: pose('flee', 8.5) };
});
check('a defined set of move behaviours, and every AI state maps to one', moves.names.length >= 7 && Object.values(moves.mapped).every((m) => moves.names.includes(m)), { names: moves.names, mapped: moves.mapped });
check('each state plays its move (shift, lumber, loom, stalk, search, charge, bolt)', ['shift', 'lumber', 'loom', 'stalk', 'search', 'charge', 'bolt'].every((m) => moves[m].move === m), Object.fromEntries(['shift', 'lumber', 'loom', 'stalk', 'search', 'charge', 'bolt'].map((m) => [m, moves[m].move])));
check('loom draws him up taller with arms hung wider than standing', moves.loom.headY > moves.shift.headY + 0.05 && moves.loom.armOut > moves.shift.armOut + 0.15, { loom: moves.loom, shift: moves.shift });
check('stalk sinks him low', moves.stalk.headY < moves.shift.headY - 0.2, { stalk: moves.stalk.headY, shift: moves.shift.headY });
check('lumbering: heavy hip roll over the stance foot and heel plants that drop through the body', moves.lumber.sway > 0.08 && moves.lumber.plants >= 4 && moves.lumber.hipMin < moves.shift.hipsY - 0.02, moves.lumber);

// GIF: walking a curve, then stopping and turning his head to the camera.
const dir = `${out}/_frames`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
await page.evaluate(() => { const bf = __viewer.bf; bf.position.set(0, 0, 0); bf.rotation.y = Math.PI / 2; bf.userData.look = null; __viewer.setYaw(-0.4); });
for (let f = 0; f < 72; f++) {
  await page.evaluate((f) => {
    const v = __viewer, bf = v.bf, dt = 1 / 24, t = f / 24;
    const speed = t < 2.2 ? 1.8 : 0;
    bf.rotation.y += (t < 2.2 ? 0.35 : 0) * dt;
    bf.position.x += -Math.sin(bf.rotation.y) * speed * dt; bf.position.z += -Math.cos(bf.rotation.y) * speed * dt;
    if (t > 1.8) bf.userData.look = { target: bf.position.clone().set(Math.sin(-0.4) * 8.8, 2.4, Math.cos(-0.4) * 8.8), weight: 1 };
    // Viewer camera orbits the origin; keep him near it.
    for (let k = 0; k < 2; k++) bf.userData.animate(dt / 2, speed, t < 2.2 ? 'roam' : 'observe');
    v.render();
  }, f);
  await page.screenshot({ path: `${dir}/f${String(f).padStart(3, '0')}.png` });
}
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', `${dir}/f%03d.png`, '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', `${out}/walk-curve-then-look.gif`]);
rmSync(dir, { recursive: true, force: true });
check('GIF recorded', ff.status === 0, ff.stderr?.toString().slice(0, 200));
// One short GIF per move, side-on in the viewer (treadmill).
for (const [name, state, speed, yaw] of [['lumber', 'roam', 1.8, -1.57], ['loom', 'observe', 0, -0.5], ['stalk', 'shadow', 0.9, -1.2], ['charge', 'aggress', 5.5, -1.57], ['shift', 'roam', 0, 0.4]]) {
  const d = `${out}/_f_${name}`; rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true });
  await page.evaluate(([state, speed, yaw]) => { const v = __viewer, bf = v.bf; bf.position.set(0, 0, 0); bf.rotation.y = 0; v.setYaw(yaw);
    bf.userData.look = state === 'observe' ? { target: bf.position.clone().set(Math.sin(yaw) * 8.8, 2.4, Math.cos(yaw) * 8.8), weight: 1 } : null;
    for (let i = 0; i < 90; i++) bf.userData.animate(1 / 60, speed, state); }, [state, speed, yaw]);
  for (let f = 0; f < 48; f++) {
    await page.evaluate(([state, speed]) => { const v = __viewer; for (let k = 0; k < 2; k++) v.bf.userData.animate(1 / 48, speed, state); v.render(); }, [state, speed]);
    await page.screenshot({ path: `${d}/f${String(f).padStart(3, '0')}.png` });
  }
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', `${d}/f%03d.png`, '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', `${out}/move-${name}.gif`]);
  rmSync(d, { recursive: true, force: true });
}
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
