// Sleep, fatigue and camp (#104): in Pine Hollow in the rain, cold, wet, tired and a little hurt:
// a fire won't catch in the open rain; pitch the tent; inside it you're sheltered; light a fire by
// it; sleep; wake rested with fatigue down and body temperature recovered, while injuries and
// hunger are NOT restored. Then: a creature coming close and a nearby wood knock each wake you.
// The sim is stepped directly (?simpaused) so the run doesn't depend on render speed.
// Run: npm run check:t104 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t104';
mkdirSync(out, { recursive: true });
const PORT = 4404;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };

await page.goto(`http://localhost:${PORT}/?map=forest&rain&simpaused&nodebugai&seed=7`);
await page.waitForFunction(() => window.__game?.fieldCamp, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  g.cryptids.update = () => {};                         // keep the AI out of the way (wake-ups are tested below)
  for (const c of g.cryptids.cryptids) c.playerDistance = 999;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  const p = g.player; p.position.set(4, 0, 118); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = -0.1;
  // A long, hard night so far: tired, wet and cold from the rain, a bruise from a fall, half-fed.
  const s = g.survival;
  s.fatigue.value = 78; s.thermo.wetness = 80; s.thermo.core = 35.3; s.nutrition.energy = 30;
  s.health.injure({ cause: 'a fall on wet rock', damage: 20 });
  g.fieldKit.carried.tent = 1; g.fieldKit.carried.fireKit = 2;
  if (!g.flashlight.on) g.flashlight.toggle();
  window.steps(30);
});

// 1. Out in the rain: exposure, warnings, status screen; a fire won't catch.
const before = await page.evaluate(() => {
  const g = __game, s = g.survival;
  const fire = g.fieldKit.lightFire();
  return { exposure: g.weather.exposure(g.player.position), rainWarning: g.status.conditions().map((c) => c.name),
    fireInOpenRain: fire, wetness: +s.thermo.wetness.toFixed(1), staminaCap: +g.player.staminaCap.toFixed(2) };
});
check('out in the rain you are exposed, and the status screen names the rain and exhaustion', before.exposure === 1 && before.rainWarning.includes('Out in the rain') && before.rainWarning.includes('Exhausted'), before);
check('a fire will not catch in the open rain', before.fireInOpenRain === false, before);
check('fatigue caps stamina capacity (78 fatigue: below 100%, never below 50%)', before.staminaCap < 1 && before.staminaCap >= 0.5, before);
await page.evaluate(() => __game.statusScreen.toggle(true));
await shot('01-status-exhausted-wet-cold-in-rain');
await page.evaluate(() => __game.statusScreen.toggle(false));

// 2. Pitch the tent (6 s standing still).
const pitch = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp;
  const started = c.use();
  window.steps(60 * 7);
  return { started, pitched: !!c.tent, tentsLeft: g.fieldKit.carried.tent, at: c.tent && { x: +c.tent.x.toFixed(1), z: +c.tent.z.toFixed(1) } };
});
check('the tent pitches on open ground after a few seconds', pitch.started && pitch.pitched && pitch.tentsLeft === 0, pitch);
await page.evaluate(() => { const p = __game.player; p.position.set(5.6, 0, 119.5); p.yaw = 0.55; p.pitch = -0.18; window.steps(2); });
await shot('02-tent-pitched-in-the-rain', 2500);

// 3. Inside: sheltered from the rain; a fire by the tent catches.
const inside = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp, p = g.player;
  p.position.set(c.tent.x, 0, c.tent.z); p.yaw = c.tent.yaw + Math.PI;   // facing out of the door
  window.steps(5);
  const fire = g.fieldKit.lightFire();
  window.steps(60);
  return { inside: c.insideTent, exposure: g.weather.exposure(p.position), shelter: g.weather.shelter, fire, campFire: !!c.campFire, quality: c.sleepQuality() };
});
check('inside the tent the rain is kept off', inside.inside && inside.exposure === 0 && inside.shelter === 'your tent', inside);
check('a fire catches by the tent, even in the rain', inside.fire === true && inside.campFire, inside);

// 4. Sleep until rested.
const sleep = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp;
  const ok = c.use();
  window.steps(30);
  return { ok, sleeping: c.sleeping, timeScale: c.timeScale };
});
check('Q inside the tent falls asleep and time fast-forwards', sleep.ok && sleep.sleeping && sleep.timeScale > 1, sleep);
await shot('03-asleep-time-passing');
const night = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp;
  const clock0 = g.hunt.elapsed;
  for (let i = 0; i < 6000 && c.sleeping; i++) window.steps(1);
  return { ...c.sleepLog[c.sleepLog.length - 1], clockAdvanced: +(g.hunt.elapsed - clock0).toFixed(1), wetness: +g.survival.thermo.wetness.toFixed(1) };
});
check('you wake rested: fatigue drops a lot', night.woke === 'rested' && night.fatigueAfter <= 6 && night.fatigueBefore - night.fatigueAfter >= 60, night);
check('body temperature recovers in the tent by the fire, and your clothes dry', night.coreAfter > night.coreBefore + 1 && night.wetness < 30, night);
check('sleep does not heal injuries, and hunger is not restored', night.healthAfter === night.healthBefore && night.energyAfter <= night.energyBefore, night);
check('time really passed: the night clock ran on while you slept', night.clockAdvanced >= 60, night);
await page.evaluate(() => __game.statusScreen.toggle(true));
await shot('04-status-after-sleep-rested-warm-still-hurt-and-hungry');
await page.evaluate(() => __game.statusScreen.toggle(false));

// 5. Interruptions: a creature approaching, and a wood knock nearby.
const creature = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp;
  g.survival.fatigue.value = 60;
  c.use(); window.steps(20);
  const bf = g.cryptids.cryptids[0];
  bf.mesh.visible = true; bf.playerDistance = 12;      // something big walks up to the tent
  window.steps(2);
  const r = { asleep: c.sleeping, woke: c.sleepLog[c.sleepLog.length - 1].woke };
  bf.playerDistance = 999;
  return r;
});
check('a creature coming close wakes you', !creature.asleep && /woken: .* is close/.test(creature.woke), creature);
const knock = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp, p = g.player;
  window.steps(150);
  c.use(); window.steps(20);
  c.cue({ x: p.position.x + 30, z: p.position.z, what: 'a wood knock' });
  window.steps(2);
  return { asleep: c.sleeping, woke: c.sleepLog[c.sleepLog.length - 1].woke };
});
check('a wood knock nearby wakes you', !knock.asleep && /wood knock/.test(knock.woke), knock);
const packUp = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp, p = g.player;
  p.position.set(c.tent.x + 2, 0, c.tent.z); window.steps(2);
  c.use();
  return { tent: !!c.tent, carried: g.fieldKit.carried.tent };
});
check('Q beside the tent packs it away again', !packUp.tent && packUp.carried === 1, packUp);

check('no page errors', errors.length === 0, errors);
writeFileSync(`${out}/sleep-log.json`, JSON.stringify({ before, pitch, inside, night, creature, knock }, null, 2));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
