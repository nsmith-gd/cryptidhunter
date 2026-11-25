// Bespoke behaviour trees (lore first) + escalation per level.
// Bigfoot: stop-and-listen approach, warning whoop + rock, shadowing, bluff vs real charge by level.
// Mothman: perches in the dark, swoops at a held beam (level 2+, not level 1), vanishes when photographed.
// Chupacabra: hisses before it pounces, feeds on bait, backs off from close light (level 1) but not at level 3.
// Run: npm run check:t53
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t53';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4333', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async (q = '', failure = false) => {
  await page.goto(`http://localhost:4333/?${q}`);
  await page.waitForFunction(() => window.__game);
  await page.evaluate((f) => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = f; }, failure);
};
const until = async (fn, ms, arg) => {
  const t0 = Date.now(); let r;
  while (Date.now() - t0 < ms) { r = await page.evaluate(fn, arg); if (r?.ok) return r; await page.waitForTimeout(80); }
  return r;
};
// Bigfoot standing at (-28,30) looking down the lane (+x); player placed `d` m in front, facing it.
const bigfootLane = (d, { light = false, agitation = 0, faceAway = false } = {}) => page.evaluate(([d, light, agitation, faceAway]) => {
  const g = __game, b = g.cryptids.cryptids[0];
  b.tickRoam = () => {}; b.agent.stop(); b.findLure = () => false;
  b.agent.x = -28; b.agent.z = 30; b.agent.heading = faceAway ? Math.PI / 2 : -Math.PI / 2; b.perception.reset();
  b.agitation = agitation; b.enterRoam('test'); b.agent.stop();
  const p = g.player; p.position.set(-28 + d, 0, 30); p.velocity.set(0, 0, 0); p.yaw = Math.PI / 2; p.pitch = 0.05; p.noise = 0;
  if (g.flashlight.on !== light) g.flashlight.toggle();
}, [d, light, agitation, faceAway]);
const bf = () => page.evaluate(() => { const b = __game.cryptids.cryptids[0]; return { state: b.state, d: +b.playerDistance.toFixed(1), agit: +b.agitation.toFixed(2), path: b.brain.pathText, why: b.lastWhy }; });
const events = (type) => page.evaluate((t) => __game.cryptidEvents.filter((e) => !t || e.type === t), type);

// ================= BIGFOOT =================
// A. Curious but wary: a noise behind it makes it creep over, stopping to listen.
await load('nodebugai');
await bigfootLane(21, { faceAway: true });
await page.evaluate(() => { __game.player.yaw = 0; });
await page.evaluate(() => { const k = __game.input.keys; k.add('KeyW'); k.add('ShiftLeft'); });
await page.waitForTimeout(450);
await page.evaluate(() => { const k = __game.input.keys; k.delete('KeyW'); k.delete('ShiftLeft'); });
const creep = await until(() => { const b = __game.cryptids.cryptids[0]; return { ok: (b.cautious?.stops ?? 0) >= 1, state: b.state, stops: b.cautious?.stops ?? 0, path: b.brain.pathText }; }, 20000);
check('Bigfoot creeps toward a noise in stages, stopping to listen', creep.ok && creep.state === 'investigate', creep);

// B. Level 1 warning: second time it spots you it rears up, whoops and throws a rock near you, then leaves.
await load('nodebugai');
await bigfootLane(14, { light: true, agitation: 0.3 });
const warn = await until(() => { const ev = __game.cryptidEvents; return { ok: ev.some((e) => e.type === 'rock'), types: ev.map((e) => e.type), state: __game.cryptids.cryptids[0].state }; }, 10000);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/01-bigfoot-warning-rock.png` });
const rock = (await events('rock'))[0];
check('a provoked Bigfoot warns you first: whoop, then a rock lands near you (level 1: a clear miss)', warn.ok && warn.types.includes('whoop') && rock && rock.distance > 3, { warn, rock });
const afterWarn = await until(() => { const b = __game.cryptids.cryptids[0]; return { ok: b.state === 'flee', state: b.state, why: b.lastWhy }; }, 5000);
check('...then it leaves', afterWarn.ok && afterWarn.why === 'warned you', afterWarn);

// C. Shadowing: it paces you from ~20 m in the treeline as you walk.
await load('nodebugai');
await page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids[0];
  b.agent.x = -10; b.agent.z = 30; b.agent.stop(); b.perception.reset(); b.noticesPlayer = () => false;
  g.player.position.set(-10, 0, 10); g.player.yaw = -Math.PI / 2; if (g.flashlight.on) g.flashlight.toggle();
  b.enterShadow(30);
});
await page.evaluate(() => __game.input.keys.add('KeyW'));
const dists = [];
for (let i = 0; i < 10; i++) { await page.waitForTimeout(800); dists.push((await bf()).d); }
await page.evaluate(() => __game.input.keys.delete('KeyW'));
const sh = await bf();
check('it shadows you from the treeline, keeping its distance as you move', sh.state === 'shadow' && Math.min(...dists.slice(3)) > 12 && Math.max(...dists.slice(3)) < 32, { dists, path: sh.path });

// D. Level 1: corner it and it BLUFF charges — stops short and roars, you survive.
await load('nodebugai', true);
await bigfootLane(3.5, { light: true });
const bluff = await until(() => ({ ok: __game.cryptidEvents.some((e) => e.type === 'roar'), caught: __game.huntFailure.isCaught }), 8000);
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/02-bigfoot-bluff-charge-roar.png` });
const bluffAfter = await until(() => { const b = __game.cryptids.cryptids[0]; return { ok: b.state === 'flee', state: b.state, why: b.lastWhy, caught: __game.huntFailure.isCaught }; }, 5000);
check('level 1: cornered, it bluff-charges — stops short, roars, then runs (you are not caught)', bluff.ok && !bluff.caught && bluffAfter.ok && !bluffAfter.caught, { bluff, bluffAfter });

// E. Level 3: corner it and the charge is real.
await load('nodebugai&tier=3', true);
await bigfootLane(5, { light: true });
const real = await until(() => ({ ok: __game.huntFailure.isCaught, by: __game.huntFailure.caughtBy, events: __game.cryptidEvents.map((e) => e.type) }), 10000);
check('level 3: no bluff — cornered, it charges for real and takes you', real.ok && real.by === 'Bigfoot' && !real.events.includes('roar'), real);

// F. Level 3 warning is aimed: the rock comes down right by you.
await load('nodebugai&tier=3');
await bigfootLane(16, { light: true, agitation: 0 });
await until(() => ({ ok: __game.cryptidEvents.some((e) => e.type === 'rock') }), 10000);
const rock3 = (await events('rock'))[0];
check('level 3: the warning rock is aimed (lands within ~2 m) instead of a clear miss', rock3 && rock3.distance < 2.2, rock3);

// ================= MOTHMAN (swamp cryptid: level 2) =================
await load('sandbox&nodebugai');
await page.evaluate(() => { const g = __game; g.chupacabra.update = () => {}; g.cryptids.update = () => {}; if (g.flashlight.on) g.flashlight.toggle();
  g.player.position.set(20, 0, 15); });
const perch = await until(() => { const m = __game.mothman; return { ok: m.state === 'perch' && m.mesh.position.y > 8 && m.perchedAt, state: m.state, y: +m.mesh.position.y.toFixed(1), path: m.pathText }; }, 15000);
check('Mothman: in the dark it settles high on a perch and watches you', perch.ok, perch);
await page.evaluate(() => { const g = __game, m = g.mothman.mesh.position, c = g.camera.position, p = g.player;
  const dx = m.x - c.x, dz = m.z - c.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(m.y - c.y, Math.hypot(dx, dz)); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-mothman-perched-watching.png` });
// Hold the light on it: drawn in, then it swoops.
await page.evaluate(() => { if (!__game.flashlight.on) __game.flashlight.toggle(); });
const aim = () => page.evaluate(() => { const g = __game, m = g.mothman.mesh.position, c = g.camera.position, p = g.player;
  const dx = m.x - c.x, dz = m.z - c.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(m.y - c.y, Math.hypot(dx, dz)); return g.mothman.state; });
let swooped = false;
for (let i = 0; i < 160 && !swooped; i++) { swooped = (await aim()) === 'swoop'; await page.waitForTimeout(100); }
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/04-mothman-swoops-at-your-light.png` });
const sw = await page.evaluate(() => ({ events: __game.cryptidEvents.map((e) => e.type), caught: __game.huntFailure.isCaught }));
check('level 2: hold your beam on it and it swoops at the light (a near miss)', swooped && sw.events.includes('screech'), sw);
// Photograph it: it vanishes and turns up on another perch, bolder.
await page.waitForTimeout(3000);
const before = await page.evaluate(() => ({ perch: __game.mothman.perch && __game.mothman.perch.toArray(), bold: __game.mothman.boldness }));
await page.evaluate(() => __game.mothman.onPhotographed());
const van = await until(() => ({ ok: __game.mothman.state === 'vanish', state: __game.mothman.state }), 3000);
const after = await page.evaluate(() => ({ perch: __game.mothman.perch && __game.mothman.perch.toArray(), bold: __game.mothman.boldness }));
check('photograph it and it vanishes to another perch, bolder than before', van.ok && after.bold > before.bold && JSON.stringify(after.perch) !== JSON.stringify(before.perch), { before, after });

// Level 1: no swoop no matter how long you stare.
await load('sandbox&nodebugai&tier=1');
await page.evaluate(() => { const g = __game; g.chupacabra.update = () => {}; g.cryptids.update = () => {}; g.player.position.set(20, 0, 15); if (!g.flashlight.on) g.flashlight.toggle(); });
let swoop1 = false;
for (let i = 0; i < 120; i++) { swoop1 ||= (await aim()) === 'swoop'; await page.waitForTimeout(100); }
check('level 1: Mothman is drawn to your light but never swoops', !swoop1, { swoop1 });

// ================= CHUPACABRA (ranch cryptid: level 3) =================
await load('sandbox&nodebugai');
await page.evaluate(() => { const g = __game; g.mothman.update = () => {}; g.mothman.mesh.position.set(0, 80, 0); g.cryptids.update = () => {};
  const p = g.player; p.position.set(20, 0, 10); p.yaw = Math.PI; const c = g.chupacabra; c.position.set(20, c.position.y, 1); c.enter('stalk'); });
const hiss = await until(() => ({ ok: __game.chupacabra.state === 'windup', ev: __game.cryptidEvents.map((e) => e.type) }), 8000);
check('Chupacabra: it hisses as it coils to pounce (your cue to turn around)', hiss.ok && hiss.ev.includes('hiss'), hiss);
// Turn and face it during the coil: it freezes.
await page.evaluate(() => { __game.player.yaw = 0; });
const froze = await until(() => ({ ok: __game.chupacabra.state === 'freeze', state: __game.chupacabra.state }), 2000);
check('...turn to face it in time and it freezes', froze.ok, froze);
await page.screenshot({ path: `${out}/05-chupacabra-frozen-in-your-light.png` });
// Bait: it can't resist.
await page.evaluate(() => { const g = __game, c = g.chupacabra; g.player.yaw = Math.PI; g.player.position.set(-20, 0, 30);
  c.position.set(0, c.position.y, 0); c.enter('stalk'); g.bait.carried = 3; const p = g.player; const save = { x: p.position.x, z: p.position.z, yaw: p.yaw };
  p.position.set(4, 0, 4); p.yaw = 0; g.bait.place(); p.position.set(save.x, 0, save.z); p.yaw = save.yaw; });
const fed = await until(() => ({ ok: __game.cryptidEvents.some((e) => e.type === 'fed'), state: __game.chupacabra.state, baits: __game.bait.lures().length }), 20000);
check('blood bait stops it: it goes and feeds instead of hunting you', fed.ok, fed);

// Level 1 vs level 3: close light drives it back (1), but not at 3.
const lightTest = async (tierQ) => {
  await load(`sandbox&nodebugai${tierQ}`);
  return page.evaluate(async () => {
    const g = __game; g.mothman.update = () => {}; g.mothman.mesh.position.set(0, 80, 0); g.cryptids.update = () => {};
    const c = g.chupacabra, p = g.player; p.position.set(20, 0, 10); p.yaw = 0; p.pitch = -0.08; c.position.set(20, c.position.y, 3); c.enter('stalk');
    if (!g.flashlight.on) g.flashlight.toggle();
    await new Promise((r) => setTimeout(r, 2500));
    return { state: c.state, d: +Math.hypot(c.position.x - 20, c.position.z - 10).toFixed(1) };
  });
};
const l1 = await lightTest('&tier=1');
const l3 = await lightTest('');
check('level 1: your light up close drives it back; level 3: it just freezes and waits', (l1.state === 'backoff' || l1.state === 'freeze') && l1.d > 9 && l3.state === 'freeze' && l3.d < 7.5, { l1, l3 });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
