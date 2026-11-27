// Sleep and camp stub (#137, L03 Lake Simcoe greybox; GDD 6.5): at a camp spot on the shore, pitch
// the tent and light a fire from your first two slots (the L03 kit), get in and sleep until dawn: the
// night fast-forwards and you wake at first light. A second night: a splash out in the bay wakes you
// before dawn (a significant cue). The sim is stepped directly (?simpaused).
// Run: npm run check:t137 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t137';
mkdirSync(out, { recursive: true });
const PORT = 4437;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

const night = async () => {
  await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=31&mute`);
  await page.waitForFunction(() => window.__game?.fieldCamp?.getClock, null, { timeout: 150000 });
  return page.evaluate(() => {
    const g = __game, P = g.player, c = g.fieldCamp, camp = g.map.camps.find((x) => x.id === 'cedarCove');
    g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
    if (g.huntFailure) g.huntFailure.enabled = false;
    window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
    // Stand on the camp pad facing away from the lake (south) with clear ground ahead.
    P.position.set(camp.x, 0, camp.z - 1); P.yaw = Math.PI; P.pitch = -0.3;
    const slots = [...g.loadout.slots];
    g.loadout.select(0); const pitched = g.loadout.use(); window.steps(7 * 60);
    const tent = c.tent && { x: +c.tent.x.toFixed(1), z: +c.tent.z.toFixed(1) };
    // Light the fire beside the tent (step to the side, face the ground).
    P.position.set(camp.x + 2.2, 0, camp.z + 0.2); P.yaw = -Math.PI / 2;
    g.loadout.select(1); const lit = g.loadout.use(); window.steps(30);
    return { slots, mode: c.sleepUntil, pitched, tent, lit, fires: g.fieldKit.fires.length, campFire: !!c.campFire, camp: camp.name };
  });
};

// ---- Night 1: sleep until dawn --------------------------------------------------------------------
const n1 = await night();
check('L03 kit: the tent and fire kit are in your first two slots, and sleep lasts until dawn here', n1.slots[0] === 'tent' && n1.slots[1] === 'fireKit' && n1.mode === 'dawn', n1);
check('pitch the tent at the camp spot, and light a fire beside it', !!n1.tent && n1.lit && n1.campFire, n1);
await page.evaluate(() => { const g = __game, c = g.fieldCamp, P = g.player; P.position.set(c.tent.x + 4.5, 0, c.tent.z + 3.5); P.yaw = Math.atan2(-(c.tent.x - P.position.x), -(c.tent.z - P.position.z)); P.pitch = -0.15; window.steps(2); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/01-camp-at-cedar-cove-tent-and-fire.png` });
const sleep1 = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp, P = g.player;
  P.position.set(c.tent.x, 0, c.tent.z); window.steps(3);
  g.loadout.select(0); const ok = g.loadout.use();
  window.steps(60);
  return { ok, sleeping: c.sleeping, timeScale: c.timeScale };
});
check('Q in the tent: asleep until dawn, the night fast-forwarding', sleep1.ok && sleep1.sleeping && sleep1.timeScale > 8, sleep1);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/02-asleep-until-dawn.png` });
const woke1 = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp;
  for (let i = 0; i < 4000 && c.sleeping; i++) g.sim.step();
  const e = c.sleepLog.at(-1);
  return { ...e, healthCauses: [...new Set(g.survival.health.log.map((h) => h.cause))], hydration: +(g.survival.hydration?.value ?? -1).toFixed(1), dawned: g.hunt.dawned, elapsed: +g.hunt.elapsed.toFixed(0), dawnAt: g.HUNT.dawnSeconds };
});
check('you wake at first light, after sleeping the night through', woke1.woke === 'first light' && woke1.dawned && woke1.clockAfter >= woke1.dawnAt, woke1);
check('sleeping the night through never harms you (no health lost)', woke1.healthAfter === woke1.healthBefore, { health: [woke1.healthBefore, woke1.healthAfter], causes: woke1.healthCauses, hydration: woke1.hydration });
check('the night really passed while you slept, and you slept off your fatigue', woke1.clockAfter - woke1.clockBefore > 60 && woke1.fatigueAfter < woke1.fatigueBefore, { slept: +(woke1.clockAfter - woke1.clockBefore).toFixed(0), fatigue: [woke1.fatigueBefore, woke1.fatigueAfter] });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/03-woke-at-first-light.png` });

// ---- Night 2: a splash in the bay wakes you ----------------------------------------------------------
await night();
const woke2 = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp, P = g.player, bay = g.map.surfacing.find((s) => s.id === 'westBay');
  P.position.set(c.tent.x, 0, c.tent.z); window.steps(3);
  g.loadout.select(0); g.loadout.use();
  window.steps(400);                                       // a while into the night
  const midway = { sleeping: c.sleeping, dawned: g.hunt.dawned };
  c.cue({ x: bay.x, z: bay.z, what: 'a splash out in the bay' });   // the creature surfacing (hook for the Igopogo, #136)
  window.steps(3);
  const e = c.sleepLog.at(-1);
  return { midway, sleeping: c.sleeping, woke: e?.woke, dawned: g.hunt.dawned, distance: +Math.hypot(bay.x - P.position.x, bay.z - P.position.z).toFixed(1) };
});
check('a splash out in the bay wakes you before dawn (a significant cue)', woke2.midway.sleeping && !woke2.sleeping && /splash/.test(woke2.woke ?? '') && !woke2.dawned, woke2);
const far = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp;
  window.steps(180);                                       // a few seconds after the last splash
  g.loadout.select(0); g.loadout.use(); window.steps(30);
  c.cue({ x: c.tent.x + 200, z: c.tent.z - 200, what: 'a distant splash' });
  window.steps(3);
  return { stillAsleep: c.sleeping };
});
check('a splash far across the lake does not wake you', far.stillAsleep, far);
const parched = await page.evaluate(() => {
  const g = __game, c = g.fieldCamp;
  if (c.sleeping) c.wake('test: up for a moment');
  window.steps(180);
  g.survival.hydration.value = 18;                         // thirsty already
  g.loadout.select(0); g.loadout.use();
  for (let i = 0; i < 4000 && c.sleeping; i++) g.sim.step();
  return { woke: c.sleepLog.at(-1)?.woke, hydration: +g.survival.hydration.value.toFixed(1), health: g.survival.health.value, dawned: g.hunt.dawned };
});
check('getting parched in your sleep wakes you (it never sleeps you into harm)', /parched/.test(parched.woke ?? '') && !parched.dawned, parched);
writeFileSync(`${out}/runs.json`, JSON.stringify({ n1, sleep1, woke1, woke2, far, parched }, null, 2));

check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
