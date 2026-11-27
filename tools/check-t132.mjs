// Dread effects (#132, GDD D05 / S14): in Pine Hollow, each effect measured calm vs badly shaken,
// through the real game systems: your breathing is a noise Bigfoot hears; your photos blur and grade
// lower; casting, bagging a sample and unfolding the map take longer; stamina recovers slower.
// Dread never touches health; a scare it causes can't raise it in the same tick; and it falls
// quickly at the van. Run: npm run check:t132 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t132';
mkdirSync(out, { recursive: true });
const PORT = 4432;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto(`http://localhost:${PORT}/?map=forest&simpaused&nodebugai&seed=7&mute`);
await page.waitForFunction(() => window.__game?.dread, null, { timeout: 150000 });
const r = await page.evaluate(() => {
  const g = __game, d = g.dread, P = g.player, bf = g.cryptids.cryptids[0];
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  g.cryptids.update = () => {};                          // Bigfoot holds still where we put it
  g.fear.applySway = () => {}; g.fear.update = () => {};  // isolate dread's own effects from fear's
  d.isSafe = () => false;                                 // out in the open for the measurements
  const steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  const at = (v) => { d.value = v; d.pending = 0; steps(2); };   // effects take hold from the next tick
  P.position.set(0, 0, 110); P.velocity.set(0, 0, 0); P.yaw = 0; P.pitch = 0;
  if (!g.flashlight.on) g.flashlight.toggle();
  const out = {};

  // 1. Breathing noise: standing still, calm vs badly shaken; Bigfoot 7 m away listening.
  bf.agent.x = 0; bf.agent.z = 103; bf.agent.path = null;
  const hear = (v) => { at(v); steps(30); bf.perception.update(1 / 60, bf.agent.x, bf.agent.z, bf.agent.heading); return { noise: +P.noise.toFixed(3), radius: +P.noiseRadius.toFixed(2), bigfootHears: +bf.perception.hearLevel.toFixed(3) }; };
  out.noise = { calm: hear(0), shaken: hear(85) };

  // 2. Photo clarity: Bigfoot 12 m ahead in your torchlight, you holding still; one shot each way.
  bf.agent.x = 0; bf.agent.z = 98; bf.mesh.visible = true; bf.syncMesh?.();
  const shoot = (v) => {
    at(v); g.photo.wantRaised = true; steps(40); g.photo.cooldown = 0;
    const e = g.photo.snap(); steps(5); g.photo.wantRaised = false; steps(20);
    return e ? { hit: e.result, steadiness: +e.steadiness.toFixed(3), Q: e.evidence?.quality?.Q ?? null, shake: +e.shake.toFixed(2) } : null;
  };
  out.photo = { calm: shoot(0), shaken: shoot(85) };

  // 3. Casting a footprint and 4. bagging a hair sample, right at your feet.
  const clue = (type) => g.clues.spawn(type, { cryptidId: 'bigfoot', position: { x: P.position.x, y: 0, z: P.position.z - 1.4 }, rotationY: 0, origin: { x: 0, z: 0 }, data: { length: 0.42, width: 0.16 } });
  const aimDown = () => { P.pitch = -0.9; steps(1); };
  const cast = (v) => { at(v); const c = clue('footprint'); aimDown(); g.evidence.castingKits = 3; g.evidence.collect(); const t = g.evidence.casting?.left ?? null; g.evidence.casting = null; g.clues.remove(c); return t && +t.toFixed(2); };
  out.cast = { calm: cast(0), shaken: cast(85) };
  const bag = (v) => {
    at(v); const c = clue('hair'); aimDown(); g.evidence.pouches = 5;
    const n0 = g.evidence.items.length; g.evidence.collect();
    const immediate = g.evidence.items.length > n0;
    let t = 0; while (g.evidence.items.length === n0 && t < 600) { steps(1); t++; }
    g.clues.remove(c);                                     // don't leave it for the next run to aim at
    return { immediate, seconds: +(t / 60).toFixed(2), bagged: g.evidence.items.length > n0 };
  };
  out.sample = { calm: bag(0), shaken: bag(85) };

  // 5. Unfolding the map.
  const unfold = (v) => {
    at(v); g.fieldMap.toggle(true); let t = 0;
    while (!g.fieldMap.readable && t < 600) { g.fieldMap.update(1 / 60); t++; }
    g.fieldMap.toggle(false); return +(t / 60).toFixed(2);
  };
  out.map = { calm: unfold(0), shaken: unfold(85) };

  // 6. Stamina recovery.
  const recov = (v) => { at(v); steps(5); return +P.recoveryScale.toFixed(3); };
  out.recovery = { calm: recov(0), shaken: recov(85) };

  // 7. Never health: 30 s badly shaken, nothing near you.
  bf.agent.x = 200; bf.agent.z = -140;
  const h0 = g.survival.health.value; at(90); steps(30 * 60);
  out.health = { before: h0, after: g.survival.health.value, events: g.survival.health.log.length };

  // 8. Same tick: a scare while shaken doesn't raise dread until the next tick.
  at(60);
  const v0 = d.value; g.fear.scare(40, 'test'); const sameTick = d.value; steps(1);
  out.sameTick = { before: +v0.toFixed(2), afterScareSameTick: +sameTick.toFixed(2), nextTick: +d.value.toFixed(2) };

  // 9. Falls quickly at the van.
  d.isSafe = () => 'vehicle';
  d.value = 85; let t = 0; while (d.value >= 25 && t < 60 * 60) { g.sim.step(); t++; }
  out.van = { secondsToCalm: +(t / 60).toFixed(1), value: +d.value.toFixed(1) };
  return out;
});
check('breathing: shaken, you make noise standing still, and Bigfoot 7 m away hears it (calm: silent)', r.noise.calm.noise === 0 && r.noise.shaken.noise > 0 && r.noise.shaken.bigfootHears > r.noise.calm.bigfootHears, r.noise);
check('photos: shaking hands blur the shot and it grades lower', r.photo.calm?.hit === 'HIT' && r.photo.shaken?.hit === 'HIT' && r.photo.shaken.steadiness < r.photo.calm.steadiness && (r.photo.shaken.Q ?? 0) < (r.photo.calm.Q ?? 0), r.photo);
check('casting a footprint takes longer when shaken', r.cast.shaken > r.cast.calm, r.cast);
check('bagging a sample: instant when calm, a fumble when shaken (still gets bagged)', r.sample.calm.immediate && !r.sample.shaken.immediate && r.sample.shaken.bagged && r.sample.shaken.seconds > 0.5, r.sample);
check('unfolding the map: instant when calm, slower when shaken', r.map.calm === 0 && r.map.shaken > 0.5, r.map);
check('stamina recovers slower when shaken (never below the 0.25 floor)', r.recovery.shaken < r.recovery.calm && r.recovery.shaken >= 0.25, r.recovery);
check('dread never touches health', r.health.after === r.health.before, r.health);
check('a scare it causes cannot raise it in the same tick (lands next tick)', r.sameTick.afterScareSameTick === r.sameTick.before && r.sameTick.nextTick > r.sameTick.before, r.sameTick);
check('it falls quickly at the van (badly shaken to calm in under half a minute)', r.van.secondsToCalm < 30, r.van);
writeFileSync(`${out}/effects-measured.json`, JSON.stringify(r, null, 2));

// Captures: the status screen naming the real effects, and the map unfolding with shaking hands.
await page.evaluate(() => { const g = __game; g.dread.isSafe = () => false; g.dread.value = 70; g.dread.pending = 0; g.dread.update(1 / 60); g.dread.render(); g.statusScreen.toggle(true); g.sim.paused = true; });
await page.waitForTimeout(1500);
await page.evaluate(() => { const el = document.querySelector('.status-screen, #status-screen'); const c = [...document.querySelectorAll('*')].find((n) => n.textContent?.startsWith?.('Shaken (dread)')); c?.scrollIntoView?.(); void el; });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/01-status-screen-dread-effects.png` });
await page.evaluate(() => { const g = __game; g.statusScreen.toggle(false); g.dread.value = 85; g.dread.update(1 / 60); g.fieldMap.toggle(true); });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/02-shaking-hands-unfolding-the-map.png` });

check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
