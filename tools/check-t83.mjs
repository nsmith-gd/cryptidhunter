// Player Movement & Flashlight vs GDD (#83). Run: npm run check:t83 [outDir]
// GDD 2.8 movement_speed = speed * max(0.45, 1 - load - injury - thermal); stamina_capacity =
// max(0.50, 1 - injury); depleted stamina blocks sprinting only; exertion_cost = action * load *
// terrain; 2.11 contextual stamina HUD; S05 light exposes you; 2.13 a dead battery hits only devices.
// Fixed-step sim (?simpaused), Pine Hollow, seed 83.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t83';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4381', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto('http://localhost:4381/?map=forest&seed=83&nodebugai&simpaused');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
  for (const c of g.cryptids.cryptids) { c.update = () => {}; c.agent.x = 140; c.agent.z = -140; }
  window.__setup = (o = {}) => {
    const s = g.survival, p = g.player;
    s.health.value = o.health ?? 100; s.health.conditions = o.bleeding ? [{ id: 99, kind: 'bleeding', severity: 'heavy', cause: 'test', at: 0 }] : [];
    s.thermo.core = o.core ?? 37; s.thermo.wetness = 0; s.nutrition.energy = 90;
    p.stamina = 1; p.exhausted = false; p.velocity.set(0, 0, 0);
    p.position.set(o.x ?? 0, 0, o.z ?? 120); p.yaw = o.yaw ?? 0; p.pitch = 0;
    s.health.update = s.health.update;  // keep the system live
  };
  // Hold keys for n sim steps; returns horizontal speed at the end and stamina.
  window.__hold = (keys, n) => {
    const k = g.input.keys; k.clear(); for (const c of keys) k.add(c);
    for (let i = 0; i < n; i++) { if (g.survival.health.value < 1) g.survival.health.value = 1; g.sim.step(); }
    k.clear();
    const p = g.player;
    return { speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(3), stamina: +p.stamina.toFixed(3), cap: +p.staminaCap.toFixed(3),
      exhausted: p.exhausted, sprinting: p.sprinting, capability: +p.capability.toFixed(3) };
  };
});
const speedWith = (o) => page.evaluate((o) => { __setup(o); return __hold(['KeyW'], 60); }, o);

// 1) Movement capability: healthy vs injured vs cold vs everything (combined floor 0.45).
const healthy = await speedWith({});
const hurt = await speedWith({ health: 30, bleeding: true });
const cold = await speedWith({ core: 34.7 });
const worst = await speedWith({ health: 5, bleeding: true, core: 34.6 });
check('wounds and cold slow your walk (GDD 2.8 movement_speed)', hurt.speed < healthy.speed * 0.8 && cold.speed < healthy.speed && cold.speed > hurt.speed, { healthy: healthy.speed, hurt: hurt.speed, cold: cold.speed });
check('...but never below the 0.45 floor, however bad it gets', worst.capability === 0.45 && worst.speed > healthy.speed * 0.43, { worst });

// 2) Stamina capacity capped by injury (floor 50%), recovery stops at the cap.
const capped = await page.evaluate(() => { __setup({ health: 20, bleeding: true }); __game.player.stamina = 0.2; return __hold([], 60 * 15); });
check('injury caps your maximum stamina (never below 50%)', capped.cap < 1 && capped.cap >= 0.5 && Math.abs(capped.stamina - capped.cap) < 0.01, capped);

// 3) Depleted stamina blocks sprinting only: you still walk at the normal pace.
const spent = await page.evaluate(() => { __setup({ x: 0, z: 140 }); return __hold(['KeyW', 'ShiftLeft'], 60 * 6.5); });   // north up the open trail
check('running out of stamina locks sprinting but you still walk at the safe pace', spent.exhausted && !spent.sprinting && Math.abs(spent.speed - healthy.speed) < 0.15, { spent, healthyWalk: healthy.speed });

// 4) Terrain: walking through the creek is harder work than dry ground.
const creek = await page.evaluate(() => {
  for (let z = 0; z < 25; z += 0.25) if (__game.map.surfaceAt(60, z, 0) === 'shallow') return { x: 60, z: z + 1.5 };
  return null;
});
const dryRecover = await page.evaluate(() => { __setup({ x: 0, z: 120, yaw: Math.PI / 2 }); __game.player.stamina = 0.3; return __hold(['KeyW'], 60 * 3); });
const wetRecover = await page.evaluate((c) => { __setup({ x: c.x, z: c.z, yaw: Math.PI / 2 }); __game.player.stamina = 0.3;
  const k = __game.input.keys; k.clear(); k.add('KeyW');
  for (let i = 0; i < 180; i++) { __game.player.position.set(c.x, 0, c.z); __game.sim.step(); }   // walking on the spot in the water
  k.clear(); return { stamina: +__game.player.stamina.toFixed(3), terrain: +__game.player.terrainFactor.toFixed(2) }; }, creek);
check('wading is harder work: stamina recovers slower walking through water (exertion × terrain)', wetRecover.terrain > 1 && wetRecover.stamina < dryRecover.stamina, { dry: dryRecover.stamina, wading: wetRecover });

// 5) Contextual stamina HUD: visible while exerting, fades when full.
await page.evaluate(() => { __setup({ x: 0, z: 140 }); __hold(['KeyW', 'ShiftLeft'], 60); __game.player.sprinting = true; __game.sim.frame(0); });
const shownWhileSprinting = await page.evaluate(() => __game.bars.stamina.row.style.opacity);
await page.screenshot({ path: `${out}/01-stamina-shown-while-sprinting.png` });
await page.evaluate(() => { __game.player.stamina = 1; __game.player.sprinting = false; __game.sim.frame(0); });
await page.waitForTimeout(2600);
await page.evaluate(() => __game.sim.frame(0));
await page.waitForTimeout(800);
const hiddenWhenFull = await page.evaluate(() => __game.bars.stamina.row.style.opacity);
const hudState = await page.evaluate(() => ({ vis: __game.bars.staminaVisible, at: __game.bars.staminaShownAt, now: performance.now(), st: __game.player.stamina, sp: __game.player.sprinting, cap: __game.player.staminaCap, inline: __game.bars.stamina.row.style.opacity }));
await page.screenshot({ path: `${out}/02-stamina-hidden-when-full.png` });
check('stamina bar shows while you exert and fades out when full (contextual HUD)', shownWhileSprinting === '1' && hiddenWhenFull === '0', { shownWhileSprinting, hiddenWhenFull, hudState });

// 6) Light exposes you: Bigfoot 18 m away facing you sees you far sooner with the torch on.
const sees = (torch) => page.evaluate((torch) => {
  const g = __game; __setup({ x: 0, z: 120, yaw: 0 });
  if (g.flashlight.on !== torch) g.flashlight.toggle();
  const b = g.cryptids.cryptids[0];
  b.agent.x = 0; b.agent.z = 102; b.agent.heading = Math.PI; b.syncMesh?.();   // facing the player (+z)
  const per = b.perception;
  if (!per) return null;
  per.awareness = 0;
  let level = 0;
  for (let i = 0; i < 60; i++) { per.update(1 / 60, b.agent.x, b.agent.z, b.agent.heading); level = Math.max(level, per.sightLevel ?? 0, per.beamLevel ?? 0); }
  return +level.toFixed(3);
}, torch);
const lit = await sees(true), dark = await sees(false);
check('your flashlight gives you away: a facing cryptid sees you much better with it on', lit != null && lit > dark, { torchOn: lit, torchOff: dark });

// 7) A dead battery affects the device, never your body.
const dead = await page.evaluate(() => {
  const g = __game; __setup({}); if (!g.flashlight.on) g.flashlight.toggle();
  g.flashlight.battery = 0.001; g.flashlight.spares = 0;
  const before = { health: g.survival.health.value, stamina: g.player.stamina };
  for (let i = 0; i < 120; i++) g.sim.step();
  g.flashlight.toggle();
  return { on: g.flashlight.on, battery: g.flashlight.battery, before, after: { health: g.survival.health.value, stamina: g.player.stamina } };
});
check('a dead battery switches the torch off (and it won\'t come back on), but your health and stamina are untouched', !dead.on && dead.battery === 0 && dead.after.health === dead.before.health && dead.after.stamina >= dead.before.stamina, dead);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
