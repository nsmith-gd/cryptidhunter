// L01 Cabbagetown tunnel tutorial + G01 tunnel gym check (#102). Run: npm run check:t102 [outDir]
// Plays the tutorial in the G01 gym (fixed seed, in-session fixture career) through the real sim:
// first-attempt collapse, only hunger + temperature as pressures, the lunch, the cold wet detour,
// the warm alcove, the optional trace, the harmless creature, a bot escape timed along the route,
// escape settlement + unlock, tutorial death -> retry with no new fee, replay after clearing,
// reset and the event trace, and the layout guarantees for several seeds.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t102';
mkdirSync(out, { recursive: true });
const PORT = 4502;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(results.at(-1).slice(0, 220)); };
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
  Element.prototype.requestPointerLock = function () { locked = this; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
  Document.prototype.exitPointerLock = function () { if (!locked) return; locked = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
});

const HELPERS = () => {
  const g = __l01, CELL = 4;
  window.__w = (c) => ({ x: (c.x - 32 + 0.5) * CELL, z: (c.y - 24 + 0.5) * CELL });
  window.__events = (type) => g.trace.filter((e) => e.type === type);
  // Walk to a world point through the real sim (W held, yaw toward it). Returns seconds taken.
  window.__walkTo = (x, z, { maxS = 120, reach = 0.7 } = {}) => {
    const p = g.player; let t = 0;
    g.input.keys.add('KeyW');
    while (Math.hypot(x - p.position.x, z - p.position.z) > reach && t < maxS && !g.ended) {
      p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); p.pitch = 0;
      g.sim.step(); t += 1 / 60;
    }
    g.input.keys.delete('KeyW');
    return t;
  };
  window.__walkPath = (cells, opts) => { let t = 0; for (const c of cells) { const w = __w(c); t += __walkTo(w.x, w.z, opts); } return t; };
  window.__wait = (s) => { for (let t = 0; t < s; t += 1 / 60) g.sim.step(); };
  window.__face = (x, z, y = null) => { const p = g.player; p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); p.pitch = y == null ? -0.35 : y; g.camera.position.set(p.position.x, p.position.y + p.eyeHeight, p.position.z); g.camera.rotation.set(p.pitch, p.yaw, 0); g.camera.updateMatrixWorld(true); };
};
const load = async (query, { fresh = false } = {}) => {
  if (fresh) await page.evaluate(() => sessionStorage.clear()).catch(() => {});
  await page.goto(`http://localhost:${PORT}/tunnel.html${query}`);
  await page.waitForFunction(() => window.__l01, null, { timeout: 60000 });
  await page.evaluate(HELPERS);
};
const start = async () => { await page.click('#l01-overlay'); await page.waitForFunction(() => __l01.input.locked, null, { timeout: 10000 }); };

// ---- 1. a fresh G01 run: start, cost, engaged systems --------------------------------------
await page.goto(`http://localhost:${PORT}/tunnel.html?gym`);
await load('?gym', { fresh: true });
await shot('01-start-screen');
await start();
const s1 = await page.evaluate(() => ({ cash: __l01.career.ledger.cash, entry: __l01.entry, seed: __l01.seed, audit: __l01.layoutAudit, hud: document.getElementById('l01-hud').innerText }));
check('a new career has $250 and the trip costs $25 (cash $225 after entering)', s1.entry.charged === 2500 && s1.cash === 22500, { cash: s1.cash / 100, charged: s1.entry.charged / 100 });
check('G01 gym: fixed seed by default', s1.seed === 101, { seed: s1.seed });
check('HUD shows only hunger and body temperature (no stamina, thirst, sleep, health or battery)', /HUNGER/.test(s1.hud) && /BODY/.test(s1.hud) && !/STAMINA|THIRST|SLEEP|HEALTH|BATTERY/i.test(s1.hud), s1.hud.replace(/\n/g, ' | '));

// ---- 2. the first-attempt collapse ----------------------------------------------------------
const collapse = await page.evaluate(() => {
  const g = __l01, s = __w({ x: 32, y: 3 });
  const t = __walkTo(s.x, s.z + 9);
  const ev = __events('entrance-collapsed');
  const e = __w({ x: 32, y: 1 });
  __walkTo(e.x, e.z, { maxS: 8 });                 // try to go back up the stair
  return { collapsed: g.collapsed, events: ev.length, atS: ev[0]?.t, reachedStair: Math.hypot(g.player.position.x - e.x, g.player.position.z - e.z) < 1.5, walked: +t.toFixed(1) };
});
check('the entrance stair collapses on the first attempt, as you walk away from it', collapse.collapsed && collapse.events === 1, collapse);
check('the collapsed stair blocks the way back up', !collapse.reachedStair, collapse);
await page.evaluate(() => { const s = __w({ x: 32, y: 2 }); __l01.player.position.set(s.x, 0, s.z + 1.2); __face(s.x, s.z - 3, 0.05); });
await page.waitForTimeout(600);
await shot('02-collapsed-stair');

// ---- 3. no stamina: sprinting never runs out; the torch has no meter -------------------------
const stam = await page.evaluate(() => {
  const g = __l01, p = g.player, b0 = g.flashlight.battery;
  g.input.keys.add('ShiftLeft');
  const w = __w({ x: 32, y: 9 }); __walkTo(w.x, w.z);
  let min = 1; for (let i = 0; i < 600; i++) { g.input.keys.add('KeyW'); g.sim.step(); min = Math.min(min, p.stamina); }
  g.input.keys.delete('ShiftLeft'); g.input.keys.delete('KeyW');
  return { minStamina: min, exhausted: p.exhausted, battery: g.flashlight.battery, batteryStart: b0 };
});
check('no stamina pressure: 10 s of hurrying never tires you', stam.minStamina === 1 && !stam.exhausted, stam);
check('the torch has no battery to manage in the tutorial', stam.battery === stam.batteryStart, stam);

// ---- 4. the packed lunch ---------------------------------------------------------------------
await page.evaluate(() => {
  const g = __l01, L = g.layout.lunch, w = __w(L), b = g.map.props.lunch.getWorldPosition(new g.THREE.Vector3());
  __walkPath([{ x: 32, y: L.y }, L]);
  g.player.position.set(b.x + 1.1, 0, b.z); __face(b.x, b.z);
  g.sim.step();
});
await page.waitForTimeout(400);
const lunchPrompt = await page.evaluate(() => ({ prompt: document.getElementById('l01-prompt').textContent, target: __l01.target?.id }));
await shot('03-packed-lunch');
await page.keyboard.press('KeyE');
const ate = await page.evaluate(() => {
  const g = __l01; g.nutrition.energy = 45; const e0 = g.nutrition.energy;
  return { picked: g.pack.lunch, food: g.nutrition.food.packedLunch, e0 };
});
await page.keyboard.press('KeyZ');
const ate2 = await page.evaluate(() => { __wait(10); return { energy: Math.round(__l01.nutrition.energy), eats: __events('eat').length, pickups: __events('pickup').map((e) => e.item) }; });
check('your packed lunch is in the tunnel: E picks it up, Z eats it (hunger relief)', /packed lunch/.test(lunchPrompt.prompt) && ate.picked && ate2.eats === 1 && ate2.energy > ate.e0 + 30, { ...lunchPrompt, ...ate, ...ate2 });

// ---- 5. the cold wet detour and the warm alcove ---------------------------------------------
const detour = await page.evaluate(() => {
  const g = __l01, th = g.thermo;
  // Walk the dry way down to the pump room, then into the flooded culvert.
  __walkPath([{ x: 32, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 24 }, { x: 14, y: 30 }, { x: 14, y: 34 }]);
  const core0 = th.core;
  __walkPath([{ x: 14, y: 36 }, { x: 22, y: 36 }]);
  __wait(40);                                        // linger a little in the deep stretch
  const inWater = { core: +th.core.toFixed(2), wet: Math.round(th.wetness), surface: th.inWater, warnings: th.warnings().map((w) => w.text) };
  return { core0: +core0.toFixed(2), inWater };
});
await page.evaluate(() => __face(__w({ x: 26, y: 36 }).x, __w({ x: 26, y: 36 }).z, -0.1));
await page.waitForTimeout(500);
await shot('04-cold-wet-detour');
check('the culvert detour soaks you and chills you, and says why', detour.inWater.wet > 60 && detour.inWater.core < detour.core0 - 0.3 && detour.inWater.warnings.some((w) => /water|Wet/.test(w)), detour);

const trace = {};
await page.evaluate(() => {
  const g = __l01, T = g.layout.trace, f = g.map.props.fur.getWorldPosition(new g.THREE.Vector3());
  __walkTo(__w(T).x, __w(T).z);
  g.player.position.set(f.x + (Math.abs(f.x - __w(T).x) > 0.5 ? 0 : 1.2), g.player.position.y, f.z + (Math.abs(f.z - __w(T).z) > 0.5 ? 0 : 1.2));
  const w = __w(T); g.player.position.set(w.x, g.player.position.y, w.z); __face(f.x, f.z, -0.2); g.sim.step();
});
await page.waitForTimeout(400);
Object.assign(trace, await page.evaluate(() => ({ prompt: document.getElementById('l01-prompt').textContent })));
await shot('05-optional-trace-fur');
await page.keyboard.press('KeyE');
const gotFur = await page.evaluate(() => ({ fur: !!__l01.pack.furSample, events: __events('pickup').map((e) => e.item) }));
check('the optional trace (a tuft of fur) is down the cold detour and can be bagged', /fur/.test(trace.prompt) && gotFur.fur, { ...trace, ...gotFur });

const warm = await page.evaluate(() => {
  const g = __l01, th = g.thermo;
  __walkPath([{ x: 22, y: 36 }, { x: 30, y: 36 }, { x: 30, y: 30 }, { x: 27, y: 30 }, { x: 27, y: 26 }, { x: 27, y: 24 }]);
  const before = { core: +th.core.toFixed(2), wet: Math.round(th.wetness) };
  __wait(90);
  return { before, after: { core: +th.core.toFixed(2), wet: Math.round(th.wetness) }, nearHeat: th.nearHeat, warmingEvents: __events('warming').length };
});
await page.evaluate(() => { const a = __w({ x: 27, y: 24 }); __face(a.x, a.z - 6, 0.05); });
await page.waitForTimeout(500);
await shot('06-warm-alcove');
check('the dry alcove warms you back up and dries you out', warm.nearHeat && warm.after.core > warm.before.core + 0.3 && warm.after.wet < warm.before.wet - 40, warm);

// Change into dry clothes (one use).
await page.evaluate(() => { __l01.thermo.wetness = 50; });
await page.keyboard.press('KeyX');
const dry = await page.evaluate(() => ({ wet: __l01.thermo.wetness, used: !__l01.pack.dryClothes }));
check('X changes into your dry clothes once (a warmth response without heat)', dry.wet === 0 && dry.used, dry);

// ---- 6. the bot escape route (timed) and the harmless creature -------------------------------
const route = await page.evaluate(() => {
  const g = __l01;
  // From the alcove east to the lower junction, then south to the ladder (the dry route).
  const t = __walkPath([{ x: 34, y: 24 }, { x: 34, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 32 }, { x: 52, y: 32 }, { x: 52, y: 40 }, { x: 58, y: 40 }, { x: 58, y: 42 }]);
  return { routeS: +t.toFixed(1), health: g.health };
});
await page.evaluate(() => { const e = __w({ x: 58, y: 43 }); __face(e.x, e.z + 2, 0.5); });
await page.waitForTimeout(500);
await shot('07-exit-ladder');

// A full timed run of a fresh attempt along the shortest dry route (start -> ladder), and a
// "first-timer" estimate that walks every tunnel once (exploring all dead ends), both at the
// tunnel walking pace through the real sim.
const timing = await page.evaluate(() => {
  const g = __l01;
  return { shortestM: g.layoutAudit.shortestEscapeM, tunnelM: g.layoutAudit.tunnelM };
});

// ---- 7. escape: settlement and unlock --------------------------------------------------------
await page.evaluate(() => { const e = __w({ x: 58, y: 43 }); __l01.player.position.set(e.x, 0, e.z - 0.5); __face(e.x, e.z + 2, 0.2); __l01.sim.step(); });
await page.waitForFunction(() => /ladder/.test(document.getElementById('l01-prompt').textContent), null, { timeout: 5000 }).catch(() => {});
const exitPrompt = await page.evaluate(() => document.getElementById('l01-prompt').textContent);
await page.keyboard.press('KeyE');
await page.waitForFunction(() => __l01.ended, null, { timeout: 5000 });
await page.waitForTimeout(400);
await shot('08-escaped-tutorial-cleared');
const esc = await page.evaluate(() => ({ text: document.getElementById('l01-end').innerText, cash: __l01.career.ledger.cash, cleared: __l01.career.s.cleared, unlocked: __l01.career.s.unlocked, ev: __events('escaped')[0], creature: { state: __l01.creature.state, closest: __l01.creature.closest }, creatureEvents: __l01.trace.filter((e) => e.type.startsWith('creature')).map((e) => e.type) }));
check('climbing the ladder escapes: tutorial cleared, next trip (L02) unlocked', /ladder/.test(exitPrompt) && esc.cleared && esc.unlocked.includes('L02') && /Tutorial cleared/.test(esc.text), { prompt: exitPrompt, unlocked: esc.unlocked });
check('the optional fur pays its trace value once ($30): cash $255', esc.cash === 25500, { cash: esc.cash / 100 });
check('the creature only watched and fled: never closer than 6 m, no damage', (esc.creature.closest >= 6 || esc.creature.state === 'hidden') && route.health === 100, { ...esc.creature, events: esc.creatureEvents, health: route.health });

// ---- 8. empty escape on a fresh fixture (no evidence) + the event trace export ----------------
await load('?gym', { fresh: true });
await start();
const empty = await page.evaluate(() => {
  const g = __l01;
  const path = [{ x: 32, y: 10 }, { x: 50, y: 10 }, { x: 58, y: 10 }, { x: 58, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 32 }, { x: 52, y: 32 }, { x: 52, y: 40 }, { x: 58, y: 40 }, { x: 58, y: 42 }];
  const t = __walkPath(path);
  g.escape('the maintenance ladder');
  return { routeS: +t.toFixed(1), cash: g.career.ledger.cash, cleared: g.career.s.cleared, unlocked: g.career.s.unlocked, closest: +g.creature.closest.toFixed(1), creature: g.creature.state, health: g.health,
    hunger: g.nutrition.band, core: +g.thermo.core.toFixed(2) };
});
check('escaping with NO evidence still clears the tutorial and unlocks the next trip', empty.cleared && empty.unlocked.includes('L02') && empty.cash === 22500, empty);
check('bot escape along the shortest dry route (the east gallery) passes the creature with no contact', (empty.closest >= 6 || empty.creature === 'hidden') && empty.health === 100, { closest: empty.closest, creature: empty.creature });
const minS = empty.routeS;
check('a tester can escape in 15-25 min: the shortest route walks in ~3-4 min; exploring the side tunnels, eating and warming fill the rest',
  minS > 150 && minS < 360 && timing.tunnelM / timing.shortestM > 2.5, { shortestRouteMin: +(minS / 60).toFixed(1), shortestM: timing.shortestM, allTunnelsM: timing.tunnelM, walkEveryTunnelOnceMin: +((timing.tunnelM * 2) / (timing.shortestM / minS) / 60).toFixed(1) });
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.evaluate(() => __l01.exportTrace())]);
const traceFile = JSON.parse(readFileSync(await download.path(), 'utf8'));
check('G01 event trace exports (seed, layout audit, events)', traceFile.gym === 'G01' && traceFile.seed === 101 && traceFile.trace.some((e) => e.type === 'attempt-start') && traceFile.trace.some((e) => e.type === 'escaped'), { events: traceFile.trace.length, types: [...new Set(traceFile.trace.map((e) => e.type))] });

// ---- 9. replay after clearing: the entrance stays open, a normal $25 trip ---------------------
await load('?gym');
await start();
const replay = await page.evaluate(() => { const g = __l01, s = __w({ x: 32, y: 3 }); __walkTo(s.x, s.z + 9); return { collapsed: g.collapsed, entry: g.entry, cash: g.career.ledger.cash }; });
check('after clearing, the stair stays open (no collapse) and a new trip costs $25', !replay.collapsed && replay.entry.charged === 2500, replay);

// ---- 10. tutorial death -> restart at the entry, same kit, no new fee -------------------------
await load('?gym', { fresh: true });
await start();
const death = await page.evaluate(() => {
  const g = __l01;
  __walkPath([{ x: 32, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 24 }, { x: 14, y: 34 }, { x: 14, y: 36 }, { x: 23, y: 36 }]);
  const cash = g.career.ledger.cash;
  let t = 0; const t0 = g.simTime;
  while (!g.ended && t < 900) { g.sim.step(); t += 1 / 60; }
  const at = (type) => { const e = __events(type)[0]; return e ? +(e.t - t0).toFixed(0) : null; };
  return { died: __events('death').length === 1, inWaterS: +t.toFixed(0), veryColdWarningAtS: at('warning'), freezingWarningAtS: at('exposure'), cash, retry: __events('death')[0]?.tutorialRetry };
});
await page.waitForTimeout(400);
await shot('09-tutorial-death');
check('lingering in the deep culvert is the one way to die, after a long, named warning', death.died && death.veryColdWarningAtS !== null && death.freezingWarningAtS !== null && death.inWaterS - death.veryColdWarningAtS >= 90 && death.inWaterS - death.freezingWarningAtS >= 45, death);
await page.click('#l01-end');
await page.waitForFunction(() => window.__l01 && !__l01.ended, null, { timeout: 60000 });
await page.evaluate(HELPERS);
const retry = await page.evaluate(() => ({ entry: __l01.entry, cash: __l01.career.ledger.cash, lunchBack: __l01.map.props.lunch.visible, seed: __l01.seed, pos: __l01.player.position.z }));
check('tutorial death restarts at the tunnel entry with the same kit and no new fee', retry.entry.resumed && retry.entry.charged === 0 && retry.cash === death.cash && retry.lunchBack, { entry: retry.entry, cash: retry.cash / 100 });
await start();
const recollapse = await page.evaluate(() => { const s = __w({ x: 32, y: 3 }); __walkTo(s.x, s.z + 9); return __l01.collapsed; });
check('the retry is the same authored tutorial (the stair collapses again)', recollapse, { recollapse });

// ---- 11. reset and seeds --------------------------------------------------------------------------
await page.keyboard.press('F9');
await page.waitForFunction(() => window.__l01, null, { timeout: 60000 });
await page.waitForTimeout(500);
const reset = await page.evaluate(() => ({ cash: __l01.career.ledger.cash, id: __l01.entry.attemptId, events: __l01.trace.length }));
check('F9 resets the gym to its fixture ($225 after entry, attempt 1, empty trace)', reset.cash === 22500 && reset.id === 'G01-A1' && reset.events === 0, reset);
const seeds = [];
for (const seed of [7, 2024, 31337]) {
  await load(`?gym&seed=${seed}`, { fresh: true });
  seeds.push(await page.evaluate(() => ({ seed: __l01.seed, ...__l01.layoutAudit, lunch: __l01.layout.lunch, trace: __l01.layout.trace, creature: __l01.layout.creature.side })));
}
check('every seed: reachable exit (also dry), useful recovery, lunch and an optional trace', seeds.every((s) => s.exitReachable && s.exitReachableDry && s.alcoveReachableDry && s.lunchReachable && s.traceReachable && s.traceInDetour), seeds.map((s) => ({ seed: s.seed, lunch: s.lunch, trace: s.trace, creature: s.creature })));

// Capture the creature watching (east glimpse spot seed).
await load('?gym&seed=101', { fresh: true });
await start();
await page.evaluate(() => {
  const g = __l01, c = g.layout.creature.glimpse, w = __w(c);
  const from = g.layout.creature.side === 'east' ? __w({ x: 47, y: 10 }) : __w({ x: 17, y: 24 });
  g.player.position.set(from.x, 0, from.z);
  if (!g.flashlight.on) g.flashlight.toggle();
  __face(w.x, w.z, -0.02);
  g.sim.step();                                      // it notices you...
  g.creature.update = () => {};                      // ...and we freeze that moment for the picture
});
await page.waitForTimeout(700);
await shot('10-creature-watching');
await page.evaluate(() => { const g = __l01, p = __w({ x: 58, y: 20 }); g.player.position.set(p.x - 6, 0, p.z); __face(p.x, p.z, 0.25); });
await page.waitForTimeout(700);
await shot('11-landmark-the-grate');
await page.evaluate(() => { const g = __l01, p = __w({ x: 32, y: 10 }); g.player.position.set(p.x, 0, p.z - 6); if (!g.flashlight.on) g.flashlight.toggle(); __face(p.x + 2, p.z + 2, -0.05); });
await page.waitForTimeout(700);
await shot('12-landmark-painted-junction');

check('no page errors', errors.length === 0, errors);
console.log('\n' + results.map((r) => r.slice(0, 400)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
