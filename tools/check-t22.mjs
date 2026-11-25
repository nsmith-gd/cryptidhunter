// Behaviour state machine: Roam -> Investigate (noise) -> Observe (glimpse) -> Flee (detected),
// and Aggress on the hostile sandbox stand-in. The F4 debug overlay shows each transition.
// Run: npm run check:t22
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t22';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4326', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const keys = (codes, down) => page.evaluate(([c, d]) => c.forEach((k) => d ? __game.input.keys.add(k) : __game.input.keys.delete(k)), [codes, down]);
const st = (i = 0) => page.evaluate((i) => {
  const c = __game.cryptids.cryptids[i], pc = c.perception;
  return { state: c.state, d: +c.playerDistance.toFixed(1), aware: +pc.awareness.toFixed(2), hear: +pc.hearLevel.toFixed(2), see: +pc.sightLevel.toFixed(2),
    hist: c.history.map((h) => `${h.from}>${h.to}`).join(' ') };
}, i);
const waitState = async (want, ms, i = 0) => {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < ms) { s = await st(i); if (s.state === want) return s; await page.waitForTimeout(50); }
  return s;
};
const lookAt = (i = 0) => page.evaluate((i) => {
  const g = __game, c = g.cryptids.cryptids[i], cam = g.camera.position;
  const dx = c.agent.x - cam.x, dz = c.agent.z - cam.z;
  g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(c.profile.height * 0.6 - cam.y, Math.hypot(dx, dz));
}, i);

// ---------------- Bigfoot (shy) ----------------
await page.goto('http://localhost:4326/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false;
  const b = g.cryptids.cryptids[0];
  b.tickRoam = () => {}; b.agent.stop(); b.findLure = () => false;   // stand still while roaming, no bait
  b.agent.x = -28; b.agent.z = 30; b.agent.heading = -Math.PI / 2;  // facing +x, down the lane
  b.perception.reset();
  const p = g.player; p.position.set(-7, 0, 30); p.yaw = Math.PI / 2; p.pitch = 0; p.noise = 0;
  if (g.flashlight.on) g.flashlight.toggle();
});
await page.waitForTimeout(400);
const s0 = await st();
check('starts in ROAM', s0.state === 'roam', s0);

// A short sprint burst 21 m away: loud enough to hear, too brief to give you away.
await page.evaluate(() => { __game.player.yaw = 0; }); // run sideways (north), staying at about the same distance
await keys(['KeyW', 'ShiftLeft'], true);
await page.waitForTimeout(450);
await keys(['KeyW', 'ShiftLeft'], false);
const s1 = await waitState('investigate', 3000);
check('a noise sends it to INVESTIGATE (not straight to flee)', s1.state === 'investigate' && s1.aware < 1, s1);
await lookAt(); await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/01-investigate-heard-noise.png` });

// Stand still in the dark: it walks over to the noise, glimpses you and stops to stare.
const s2 = await waitState('observe', 20000);
check('glimpsing you makes it stop and OBSERVE', s2.state === 'observe', s2);
await lookAt(); await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/02-observe-staring.png` });

// Turn the flashlight on it: now it's sure -> FLEE.
await page.evaluate(() => { if (!__game.flashlight.on) __game.flashlight.toggle(); });
const s3 = await waitState('flee', 5000);
check('once it detects you, the shy one FLEEs', s3.state === 'flee', s3);
await page.waitForTimeout(250);
await lookAt(); await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/03-flee.png` });
const overlay = await page.evaluate(() => document.getElementById('ai-debug').innerText);
check('debug overlay lists the transitions with reasons', /roam → investigate \(heard a noise\)/.test(overlay) && /investigate → observe \(glimpsed you\)/.test(overlay) && /observe → flee \(detected you\)/.test(overlay), overlay.split('\n').slice(0, 10));

// Hidden + quiet: it calms down and goes back to ROAM.
await page.evaluate(() => { if (__game.flashlight.on) __game.flashlight.toggle(); });
const s4 = await waitState('roam', 25000);
check('far away and calm again -> back to ROAM', s4.state === 'roam', s4);

// ---------------- Bigfoot can turn on you ----------------
const turn = async (setup) => {
  await page.goto('http://localhost:4326/');
  await page.waitForFunction(() => window.__game);
  await page.evaluate(setup);
  return waitState('aggress', 8000);
};
const cornered = await turn(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false;
  const b = g.cryptids.cryptids[0]; b.tickRoam = () => {}; b.agent.stop(); b.findLure = () => false;
  b.agent.x = -28; b.agent.z = 30; b.agent.heading = -Math.PI / 2; b.perception.reset();
  const p = g.player; p.position.set(-25, 0, 30); p.yaw = Math.PI / 2; p.pitch = 0;   // 3 m in front of it
  if (!g.flashlight.on) g.flashlight.toggle();
});
check('surprise Bigfoot up close and it turns on you (AGGRESS: cornered)', cornered.state === 'aggress' && /aggress/.test(cornered.hist), cornered);
await lookAt(); await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/05-bigfoot-cornered-charges.png` });
const fedUp = await turn(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false;
  const b = g.cryptids.cryptids[0]; b.tickRoam = () => {}; b.agent.stop(); b.findLure = () => false;
  b.agent.x = -28; b.agent.z = 30; b.agent.heading = -Math.PI / 2; b.perception.reset();
  b.agitation = 0.9; b.lastWarn = -30;                                                  // already pushed it hard and been warned
  const p = g.player; p.position.set(-12, 0, 30); p.yaw = Math.PI / 2; p.pitch = 0;    // 16 m away
  if (!g.flashlight.on) g.flashlight.toggle();
});
const why = await page.evaluate(() => __game.cryptids.cryptids[0].history.at(-1)?.why);
check('hound it enough and it stops running (AGGRESS: fed up)', fedUp.state === 'aggress' && why === 'fed up with you', { ...fedUp, why });

// ---------------- Hostile stand-in (sandbox) ----------------
await page.goto('http://localhost:4326/?sandbox');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false;
  g.chupacabra.update = () => {}; g.mothman.update = () => {};
  g.cryptids.cryptids[0].update = () => {}; // park Bigfoot
  const pr = g.cryptids.cryptids[1];
  pr.tickRoam = () => {}; pr.agent.stop(); pr.findLure = () => false;
  pr.agent.x = -28; pr.agent.z = 30; pr.agent.heading = -Math.PI / 2; pr.perception.reset();
  const p = g.player; p.position.set(-10, 0, 30); p.yaw = Math.PI / 2; p.pitch = -0.05;
  if (!g.flashlight.on) g.flashlight.toggle();
});
const a1 = await waitState('aggress', 8000, 1);
check('the hostile one AGGRESSes when it detects you', a1.state === 'aggress', a1);
await page.waitForTimeout(700);
const a2 = await st(1);
check('...and closes in on you', a2.d < a1.d - 1.5, { at: a1.d, after: a2.d });
await lookAt(1); await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/04-aggress.png` });
// Outrun it: sprint away east; it gives up and roams.
await page.evaluate(() => { __game.player.yaw = -Math.PI / 2; });
await keys(['KeyW', 'ShiftLeft'], true);
const a3 = await waitState('roam', 12000, 1);
await keys(['KeyW', 'ShiftLeft'], false);
check('it gives up the chase and goes back to ROAM', a3.state === 'roam' && /aggress>roam/.test(a3.hist), a3);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
