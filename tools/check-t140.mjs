// Shared power budget on the L05 Timiskaming greybox (#140): batteries and fuel, played in the real game
// (?map=l05). The outboard burns its own fuel; sonar pings draw the boat battery once each; a flat boat
// battery switches off only the sonar and lantern (GPS and hydrophone on the power bank, the torch and
// the paper map keep working, and no body meter changes); a spare pack takes over; the underwater camera
// records while you're under; the shed generator charges what's plugged in from its own tank; an empty
// outboard is topped up from the can. Number keys are pressed for real (5 6 7 8 9 0).
// Run: npm run check:t140 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t140';
mkdirSync(out, { recursive: true });
const PORT = 4441;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?map=l05&simpaused`);
await page.waitForFunction(() => window.__game?.power && window.__game?.lake, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  window.T = {
    hold(keys) { g.input.keys.clear(); for (const k of keys) g.input.keys.add(k); },
    steps(n) { for (let i = 0; i < n; i++) g.sim.step(); },
    walkTo(x, z, { r = 1.2, max = 6000 } = {}) {
      const P = g.player; T.hold(['KeyW']);
      for (let i = 0; i < max; i++) { const dx = x - P.position.x, dz = z - P.position.z; if (Math.hypot(dx, dz) < r) { T.hold([]); return true; } P.yaw = Math.atan2(-dx, -dz); g.sim.step(); }
      T.hold([]); return false;
    },
    charge: (id) => +g.power.budget.pack(id).charge.toFixed(3),
    litres: (id) => +g.power.budget.tank(id).litres.toFixed(4),
    body: () => { const s = g.survival; return { health: s.health.value, healthLog: s.health.log.length, energy: +s.energy?.value?.toFixed?.(4), water: +s.hydration?.value?.toFixed?.(4), core: +s.thermo.core.toFixed(4), wet: s.thermo.wetness, stamina: +g.player.stamina.toFixed(4) }; },
  };
});
const key = async (code) => { await page.keyboard.press(code); };
const shot = async (name) => { await page.evaluate(() => { __game.sim.step(); __game.lake.render(); __game.power.render(); }); await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/${name}.png` }); };

// 1. Board, start up, drive out: fuel goes down by the engine's burn; no battery charge used.
const drive = await page.evaluate(() => {
  const g = __game, L = g.lake, P = g.player;
  P.position.set(0, 0, 20); T.walkTo(0.9, 0.6, { r: 0.5 }); T.steps(30);
  L.use(); L.engine();
  const l0 = T.litres('outboard'), boat0 = T.charge('boat'), bank0 = T.charge('bank');
  T.hold(['KeyW']); T.steps(60 * 10); T.hold([]); T.steps(60);
  return { boarded: L.boat.aboard, burned: +(l0 - T.litres('outboard')).toFixed(3), boatUsed: +(boat0 - T.charge('boat')).toFixed(3), bankUsed: +(bank0 - T.charge('bank')).toFixed(3), canL: T.litres('can') };
});
check('the outboard burns its own fuel (and only fuel) while you drive', drive.boarded && drive.burned > 0.5 && drive.burned < 1.2 && drive.boatUsed === 0 && drive.bankUsed === 0 && drive.canL === 5, drive);

// 2. Three sonar pings (key 5): the boat battery goes down once per ping; the power bank doesn't.
const p0 = await page.evaluate(() => ({ boat: T.charge('boat'), bank: T.charge('bank') }));
for (let i = 0; i < 3; i++) { await key('Digit5'); await page.evaluate(() => T.steps(5)); }
const pings = await page.evaluate((p0) => ({ pings: __game.power.pings.length, boatUsed: +(p0.boat - T.charge('boat')).toFixed(3), bankUsed: +(p0.bank - T.charge('bank')).toFixed(3) }), p0);
check('each sonar ping (5) draws the boat battery once; the power bank is untouched', pings.pings === 3 && pings.boatUsed === 9 && pings.bankUsed === 0, pings);

// 3. Lantern (6), hydrophone (7), GPS (8) on; run the boat battery flat.
await key('Digit6'); await key('Digit7'); await key('Digit8');
const flat = await page.evaluate(() => {
  const g = __game, B = g.power.budget;
  const onBefore = { lantern: B.isOn('lantern'), hydrophone: B.isOn('hydrophone'), gps: B.isOn('gps') };
  g.flashlight.on || g.flashlight.toggle();
  B.pack('boat').charge = 0.2;          // nearly gone: the lantern finishes it off in a few seconds
  const body0 = T.body();
  T.steps(60 * 4);
  const body1 = T.body();
  const pingAfter = g.power.ping();
  return { onBefore, boatFlat: B.pack('boat').flat, lantern: B.isOn('lantern'), sonar: B.available('sonar'), pingAfter, gps: B.isOn('gps'), hydrophone: B.isOn('hydrophone'),
    torch: g.flashlight.on && g.flashlight.battery > 0, paperMap: !!g.fieldMap, body0, body1,
    flatEvents: g.power.log.filter((e) => e.type === 'pack-flat').map((e) => ({ pack: e.pack, devices: e.devices })) };
});
const bodySame = ['health', 'healthLog'].every((k) => flat.body0[k] === flat.body1[k]);
check('a flat boat battery switches off only the sonar and lantern; GPS and hydrophone (power bank), the torch and the paper map keep working', flat.onBefore.lantern && flat.boatFlat && !flat.lantern && !flat.sonar && flat.pingAfter === null && flat.gps && flat.hydrophone && flat.torch && flat.paperMap
  && flat.flatEvents.length === 1 && flat.flatEvents[0].devices.join() === 'sonar,lantern', flat);
check('the battery failure does not touch the body (no health change, nothing in the health log)', bodySame, { before: flat.body0, after: flat.body1 });
await shot('01-boat-battery-flat-only-its-devices-off');

// 4. Swap (9): the sonar and lantern move to a spare pack and work again.
await key('Digit9');
const swap = await page.evaluate(() => { const g = __game, B = g.power.budget; const r = g.power.ping(); T.steps(60); return { sonarPack: B.device('sonar').pack, lanternPack: B.device('lantern').pack, ping: !!r, lantern: B.isOn('lantern'), spare: T.charge('spare1') }; });
check('swap a spare pack in (9): sonar and lantern back on, drawing the spare', swap.sonarPack === 'spare1' && swap.lanternPack === 'spare1' && swap.ping && swap.lantern && swap.spare < 30, swap);
await shot('02-spare-pack-swapped-in-lantern-on');

// 5. Over the side and dive: the underwater camera records while you're under, on the power bank.
const cam = await page.evaluate(() => {
  const g = __game, L = g.lake, B = g.power.budget;
  const bank0 = T.charge('bank');
  T.steps(60); const gpsHydroPerSec = (bank0 - T.charge('bank'));
  L.use();                                             // over the side
  const b1 = T.charge('bank');
  T.hold(['KeyC']); T.steps(60 * 3); const recording = B.isOn('camera'); const b2 = T.charge('bank'); T.hold([]); T.steps(60);
  const stopped = !B.isOn('camera');
  return { mode: L.aquatic.mode, recording, stopped, perSecUnder: +((b1 - b2) / 3).toFixed(3), perSecAbove: +gpsHydroPerSec.toFixed(3) };
});
check('the underwater camera records only while you are under, drawing the power bank', cam.recording && cam.stopped && cam.perSecUnder > cam.perSecAbove + 0.15, cam);

// 6. Back aboard, out of fuel: the engine dies; pour the can (0); it runs again.
const fuel = await page.evaluate(() => {
  const g = __game, L = g.lake, b = L.boat, B = g.power.budget;
  g.player.position.set(b.x + 1, 0, b.z + 1); L.use(); L.engine();
  B.tank('outboard').litres = 0.05;
  T.hold(['KeyW']); T.steps(60 * 3); T.hold([]);
  return { engineAfterEmpty: b.engine, litres: T.litres('outboard'), empty: g.power.log.some((e) => e.type === 'tank-empty' && e.tank === 'outboard') };
});
await key('Digit0');
const refuel = await page.evaluate(() => { const g = __game, L = g.lake; const started = L.engine(); return { outboard: T.litres('outboard'), can: T.litres('can'), started, engine: L.boat.engine }; });
check('out of fuel the engine dies; pouring the can in (0) gets it going again', !fuel.engineAfterEmpty && fuel.empty && refuel.outboard >= 5 && refuel.can === 0 && refuel.started && refuel.engine, { fuel, refuel });

// 7. Motor home, tie up, walk to the shed generator, start it (0): both packs charge from its own tank.
const gen = await page.evaluate(() => {
  const g = __game, L = g.lake, b = L.boat, B = g.power.budget, M = g.map.landmarks.mooring;
  B.pack('boat').charge = 0; B.checkPack(B.pack('boat'));        // the boat battery, flat again
  let arrived = false;
  for (let i = 0; i < 60 * 120 && !arrived; i++) {
    const dx = M.x - b.x, dz = M.z - 2 - b.z, want = Math.atan2(-dx, -dz);
    let diff = want - b.heading; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    T.hold(['KeyW', ...(Math.abs(diff) > 0.08 ? [diff > 0 ? 'KeyA' : 'KeyD'] : [])]); g.sim.step(); arrived = Math.hypot(dx, dz) < 2.5;
  }
  T.hold([]); T.steps(90); L.use();
  const G = g.map.landmarks.generator; T.walkTo(G.x - 1.6, G.z + 0.5, { r: 0.8 }); T.steps(20);
  return { arrived, ashore: g.map.surfaceAt(g.player.position.x, g.player.position.z) };
});
const g0 = await page.evaluate(() => ({ boat: T.charge('boat'), bank: T.charge('bank'), gen: T.litres('generator'), outboard: T.litres('outboard') }));
await key('Digit0');
const charged = await page.evaluate((g0) => {
  const g = __game, B = g.power.budget; T.steps(60 * 20);
  return { running: B.generators.get('gen').running, boatPlugged: B.pack('boat').plugged, bankPlugged: B.pack('bank').plugged, boatGain: +(T.charge('boat') - g0.boat).toFixed(2), bankGain: +(T.charge('bank') - g0.bank).toFixed(2),
    genBurned: +(g0.gen - T.litres('generator')).toFixed(3), outboardChange: +(g0.outboard - T.litres('outboard')).toFixed(3), boatFlat: B.pack('boat').flat };
}, g0);
check('at the shed, the generator (0) charges the moored boat battery and the power bank from its own fuel', gen.arrived && charged.running && charged.boatPlugged === 'gen' && charged.bankPlugged === 'gen' && charged.boatGain > 5 && !charged.boatFlat && charged.genBurned > 0.05 && charged.outboardChange === 0, { gen, charged });
await page.evaluate(() => { const g = __game, b = g.lake.boat, P = g.player; P.yaw = Math.atan2(-(b.x - P.position.x), -(b.z - P.position.z)) + 0.5; P.pitch = -0.12; });
await shot('03-charging-at-the-shed-generator');
check('no page errors', errors.length === 0, errors.slice(0, 3));

writeFileSync(`${out}/results.txt`, results.join('\n') + '\n');
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
