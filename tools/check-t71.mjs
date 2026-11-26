// Status screen + cause-naming warnings check (#71, GDD 2.11 / 13.1). Run: npm run check:t71 [outDir]
// For each penalty the player can suffer, drives the real system step by step and checks a warning
// naming the cause appears BEFORE the penalty applies. Also checks the status screen (Tab) lists
// attributes, causes, effects and fixes in words, pauses the hunt, and feeds the HUD list.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t71';
mkdirSync(out, { recursive: true });
const PORT = 4471;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden');
  g.cryptids.update = () => {}; for (const c of g.cryptids.cryptids) c.mesh.visible = false;
  if (g.huntFailure) g.huntFailure.enabled = false;
  // A calm, fed, warm, dry baseline the scenarios start from.
  window.__reset = () => {
    const s = g.survival, p = g.player;
    s.nutrition.energy = 85; s.thermo.core = 37; s.thermo.wetness = 0; s.thermo.inWater = 'dry';
    p.stamina = 1; p.exhausted = false; p.sprinting = false; p.recoveryScale = 1;
    g.fear.value = 0; g.fear.reasons = []; g.fear.rate = 0;
    g.flashlight.battery = 1; if (!g.flashlight.on) g.flashlight.toggle();
    p.position.set(0, 0, 112); p.velocity.set(0, 0, 0);
  };
  window.__warned = (id) => g.status.conditions().some((c) => c.id === id);
});

// Each scenario returns { warnAt, penaltyAt } in its own progress units (time or value).
const hunger = await page.evaluate(() => {
  const g = __game; __reset();
  let warnAt = null, penaltyAt = null;
  for (let e = 70; e >= 30; e -= 0.1) {
    g.survival.nutrition.energy = e; g.survival.update(1e-6);
    if (warnAt === null && __warned('hunger')) warnAt = +e.toFixed(1);
    if (penaltyAt === null && g.player.recoveryScale < 1) penaltyAt = +e.toFixed(1);
  }
  return { warnAtEnergy: warnAt, penaltyAtEnergy: penaltyAt };
});
check('hunger: warned (SOON) before stamina recovery slows', hunger.warnAtEnergy !== null && hunger.warnAtEnergy > hunger.penaltyAtEnergy, hunger);

const cold = await page.evaluate(() => {
  const g = __game; __reset();
  const t = g.survival.thermo, p = g.player;
  p.position.set(10, 0, 8.5);                      // standing in the creek
  let warnAt = null, penaltyAt = null, firstText = null;
  for (let s = 0; s < 900; s += 0.5) {
    g.survival.update(0.5);
    if (warnAt === null && (__warned('soaking') || __warned('wet') || __warned('cold'))) { warnAt = s; firstText = g.status.hudWarnings()[0]?.text; }
    if (penaltyAt === null && t.coldDeficit > 0) penaltyAt = s;
  }
  return { surface: t.inWater, warnAtS: warnAt, penaltyAtS: penaltyAt, firstText, coreEnd: +t.core.toFixed(2) };
});
check('cold: wading/wet clothing warned before getting cold slows you', cold.warnAtS !== null && cold.penaltyAtS !== null && cold.warnAtS < cold.penaltyAtS, cold);
check('the cold warning names the root cause, not just "cold"', /Standing in water|Deep water|Wet clothing/.test(cold.firstText ?? ''), { firstText: cold.firstText });

const winded = await page.evaluate(() => {
  const g = __game; __reset();
  const p = g.player;
  let warnAt = null, penaltyAt = null;
  for (let s = 0; s < 10; s += 1 / 60) {
    p.sprinting = !p.exhausted; p.updateStamina(1 / 60, true);
    if (warnAt === null && __warned('winded')) warnAt = +s.toFixed(2);
    if (penaltyAt === null && p.exhausted) penaltyAt = +s.toFixed(2);
  }
  return { warnAtS: warnAt, penaltyAtS: penaltyAt };
});
check('stamina: "out of breath soon" before sprint locks', winded.warnAtS !== null && winded.warnAtS < winded.penaltyAtS, winded);

const fear = await page.evaluate(() => {
  const g = __game; __reset();
  if (g.flashlight.on) g.flashlight.toggle();      // torch off in the dark woods
  g.player.position.set(110, 0, -130);
  let warnAt = null, penaltyAt = null, cause = null;
  for (let s = 0; s < 60; s += 0.25) {
    g.fear.update(0.25);
    if (warnAt === null && __warned('fear')) { warnAt = s; cause = g.status.conditions().find((c) => c.id === 'fear').cause; }
    if (penaltyAt === null && g.fear.value > 35) penaltyAt = s;
  }
  return { warnAtS: warnAt, penaltyAtS: penaltyAt, cause };
});
check('fear: warned (uneasy) before your aim starts to sway, naming the darkness', fear.warnAtS !== null && fear.warnAtS < fear.penaltyAtS && /Darkness/.test(fear.cause ?? ''), fear);

const battery = await page.evaluate(() => {
  const g = __game; __reset();
  const fl = g.flashlight;
  let warnAt = null, penaltyAt = null;
  for (let s = 0; s < 400; s += 0.5) {
    fl.update(0.5);
    if (warnAt === null && __warned('battery')) warnAt = s;
    if (penaltyAt === null && fl.battery < 0.15) penaltyAt = s;
  }
  return { warnAtS: warnAt, penaltyAtS: penaltyAt };
});
check('torch: "battery low" before the beam dims', battery.warnAtS !== null && battery.warnAtS < battery.penaltyAtS, battery);

// Words, not colour: every condition carries a stage word, a cause, an effect and a fix.
const wording = await page.evaluate(() => {
  const g = __game; __reset();
  const s = g.survival; s.nutrition.energy = 40; s.thermo.wetness = 80; s.thermo.core = 35.3; g.player.exhausted = true;
  g.fear.value = 50; g.fear.reasons = ['dark']; g.flashlight.battery = 0.1;
  g.survival.update(1e-6);
  const c = g.status.conditions();
  return { n: c.length, ok: c.every((x) => ['soon', 'now'].includes(x.stage) && x.cause && x.effect && x.fix && x.name), sample: c[0] };
});
check('every condition is worded: SOON/NOW, cause, effect and what to do', wording.n >= 5 && wording.ok, wording);

// Status screen: Tab opens it (while playing), lists everything, pauses the hunt.
await page.evaluate(() => { __game.input.locked = true; });
await page.keyboard.press('Tab');
await page.waitForTimeout(200);
const screen = await page.evaluate(() => {
  const el = document.getElementById('status-screen'), g = __game;
  const before = g.sim.tick; g.sim.paused = false;
  return new Promise((res) => setTimeout(() => {
    const after = g.sim.tick; g.sim.paused = true;
    res({ open: el.classList.contains('open'), text: el.innerText, simAdvanced: after - before });
  }, 600));
});
check('Tab opens the status screen with attributes, causes, effects and fixes', screen.open && /Body temperature/.test(screen.text) && /Cause:/.test(screen.text) && /What to do:/.test(screen.text) && /WHAT YOU CAN DO NOW/.test(screen.text), screen.text.replace(/\s+/g, ' ').slice(0, 220));
check('the hunt is paused while the status screen is open', screen.simAdvanced === 0, { simStepsWhileOpen: screen.simAdvanced });
await page.evaluate(() => __game.statusScreen.render());
await page.screenshot({ path: `${out}/01-status-screen-wet-cold-hungry.png` });
await page.keyboard.press('Tab');

// HUD: the warning list is the consolidated one.
await page.evaluate(() => { __reset(); const g = __game; g.player.position.set(10, 0, 8.5); for (let i = 0; i < 6; i++) g.survival.update(0.5); g.survival.render(); });
const hud = await page.evaluate(() => document.querySelector('#survival .warn').innerText);
check('HUD warnings come from the consolidated list (SOON/NOW + cause)', /(SOON|NOW) · (Standing in water|Deep water)/.test(hud), hud);
await page.screenshot({ path: `${out}/02-hud-warning-wading.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
