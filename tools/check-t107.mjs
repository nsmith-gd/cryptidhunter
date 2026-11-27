// Scent and routine perception check (#107). Run: npm run build && node tools/check-t107.mjs [outDir]
// Wind blows west -> east. You crouch silently in the dark, unseen, food in your pack:
//   1. carrying food: nothing to smell (no hidden inventory query);
//   2. you eat it UPWIND of Bigfoot: the trace drifts to him and he goes to the trace's location;
//   3. you eat with Bigfoot upwind of you: he never smells it;
//   4. bleeding leaves blood traces that fade with age;
//   5. routine: he remembers where he watched you, but a route he never saw can't be anticipated;
//   6. the AI debug overlay traces each stimulus: channel, source and expiry.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t107';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4407', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async () => {
  await page.goto('http://localhost:4407/?map=forest&simpaused');
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
};
// Put you and Bigfoot in the trailhead clearing, you crouched still in the dark; bigfootDx = his
// offset east (+) or west (-) of you. Returns after the setup settles.
const setup = (bigfootDx) => page.evaluate((dx) => {
  const g = __game, p = g.player, L = g.map.landmarks.trailhead;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  if (g.flashlight.on) g.flashlight.toggle();
  g.input.keys.clear(); g.input.keys.add('ControlLeft');            // crouch, silent
  p.position.set(L.x, 0, L.z - 2); p.velocity.set(0, 0, 0); p.yaw = Math.PI / 2;   // looking west
  const b = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  b.agent.x = L.x + dx; b.agent.z = L.z - 2; b.agent.stop?.(); b.agent.heading = dx > 0 ? -Math.PI / 2 : Math.PI / 2;  // facing away from you
  b.enterRoam?.('test start'); b.perception.reset(); b.perception.memory = [];
  b.roamPause = 1e9; b.pauseLeft = 1e9;
  g.__b = b;
  for (let i = 0; i < 60; i++) g.sim.step();
  return { bigfoot: [+b.agent.x.toFixed(1), +b.agent.z.toFixed(1)], state: b.state, food: g.survival.nutrition.foodLeft };
}, bigfootDx);
const run = (secs) => page.evaluate((secs) => {
  const g = __game, b = g.__b, seen = [];
  let invest = null;
  const home = { x: b.agent.x, z: b.agent.z };
  for (let i = 0; i < secs * 30; i++) {
    // Hold him where the test put him while he's only roaming (his wandering is random); once he
    // reacts to something, he's free to move.
    if (b.state === 'roam') { b.agent.x = home.x; b.agent.z = home.z; b.agent.stop?.(); }
    g.sim.step(); g.sim.step();                                   // simulate only (no drawing): 1/30 s
    if (b.state === 'investigate' && !invest) invest = { why: b.history[b.history.length - 1]?.why, target: b.target && { x: +b.target.x.toFixed(1), z: +b.target.z.toFixed(1) }, t: +(i / 30).toFixed(1) };
    seen.push(b.perception.scentLevel);
  }
  return { state: b.state, invest, maxScent: +Math.max(...seen).toFixed(3), hear: +b.perception.hearLevel.toFixed(2), see: +b.perception.sightLevel.toFixed(2) };
}, secs);

await load();
await setup(24);                                                      // Bigfoot 24 m DOWNWIND (east)
const carrying = await run(6);
check('carrying food in your pack leaves no scent: he smells nothing', carrying.maxScent === 0 && !carrying.invest, carrying);
const eatAt = await page.evaluate(() => { const g = __game; const p = g.player.position; dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' })); dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ' })); return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), traces: g.scent.traces.map((t) => t.kind) }; });
const upwind = await run(12);
const dist = upwind.invest?.target ? Math.hypot(upwind.invest.target.x - eatAt.x, upwind.invest.target.z - eatAt.z) : Infinity;
check('you eat upwind of him: he smells the trace and goes to investigate where it lies', eatAt.traces.includes('food') && upwind.maxScent > 0.08 && /smelled food/.test(upwind.invest?.why ?? '') && dist < 3.5,
  { eatAt, upwind, distToTrace: +dist.toFixed(2) });
const dbg = await page.evaluate(() => { const g = __game; g.aiDebug.setVisible?.(true); g.sim.frame(1 / 30); return g.aiDebug.panel?.textContent ?? ''; });
check('debug trace shows each stimulus: channel, source and expiry (scent trace and wind too)', /SCENT\s+wind/.test(dbg) && /scent\s+food/.test(dbg) && /expires \d+s/.test(dbg), dbg.split('\n').filter((l) => /SCENT|scent|smells|expires/.test(l)).slice(0, 6));
await page.screenshot({ path: `${out}/01-bigfoot-follows-food-scent-debug.png`, timeout: 120000 });

await load();
await setup(-24);                                                     // Bigfoot 24 m UPWIND (west)
await page.evaluate(() => { dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' })); dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ' })); });
const downwindEat = await run(12);
check('you eat downwind of him: the wind carries it away and he never smells it', downwindEat.maxScent === 0 && !/smelled/.test(downwindEat.invest?.why ?? ''), downwindEat);

// Blood: a bleeding wound leaves traces that fade.
const blood = await page.evaluate(() => {
  const g = __game;
  g.survival.health.injure({ cause: 'test', damage: 5, wound: 'bleeding', severity: 'light' });
  // Bleed while moving: a drop every few seconds along your way (standing still refreshes one pool).
  const p = g.player.position;
  for (let i = 0; i < 60 * 10; i++) { if (i % 60 === 0) p.x += 2; g.sim.step(); }
  const t = g.scent.traces.filter((x) => x.kind === 'blood').sort((a, b) => a.born - b.born);
  const s0 = t.length ? g.scent.strengthOf(t[0]) : 0;
  for (let i = 0; i < 60 * 20; i++) g.sim.step();
  return { traces: t.length, first: +s0.toFixed(3), later: t.length ? +g.scent.strengthOf(t[0]).toFixed(3) : 0 };
});
check('bleeding leaves blood traces that fade with age', blood.traces >= 2 && blood.later < blood.first, blood);

// Routine: he watches you at A (lit, in view); route B he never sees.
const routine = await page.evaluate(() => {
  const g = __game, b = g.__b, p = g.player, L = g.map.landmarks.trailhead;
  g.input.keys.clear(); if (!g.flashlight.on) g.flashlight.toggle();
  const A = { x: L.x - 12, z: L.z - 2 };
  b.agent.heading = 0; b.agent.x = L.x - 12; b.agent.z = L.z + 10; b.enterRoam?.('watch');
  p.position.set(A.x, 0, A.z);
  for (let i = 0; i < 60 * 8; i++) { g.sim.step(); b.agent.heading = Math.atan2(-(p.position.x - b.agent.x), -(p.position.z - b.agent.z)); }
  const B = { x: L.x + 60, z: L.z - 60 };
  const r = b.perception.routine;
  return { seenA: !!r.anticipate(A.x, A.z), confA: +(r.anticipate(A.x, A.z)?.confidence ?? 0).toFixed(2), anticipateB: r.anticipate(B.x, B.z), spots: r.spots.length };
});
check('routine: he can anticipate a spot where he watched you, but not a route he never saw', routine.seenA && routine.confA > 0 && routine.confA <= 1 && routine.anticipateB === null, routine);
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
