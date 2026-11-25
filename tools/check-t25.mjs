// Fear meter check. Run: npm run check:t25 [outDir]
// Fear rises in the dark and near cryptids, spikes on a scare, falls in light and at the van;
// high fear sways the view, and the same photo scores lower when you're terrified.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t25';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4352', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto('http://localhost:4352/?map=forest');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  g.aiDebug?.setVisible(false); // keep captures clean
  if (g.huntFailure) g.huntFailure.enabled = false;
  for (const c of [g.chupacabra, g.mothman]) if (c) { c.update = () => {}; if (c.mesh) c.mesh.visible = false; c.mesh?.position.set(1e4, 0, 1e4); c.position?.set?.(1e4, 0, 1e4); }
  const bf = g.cryptids.cryptids[0]; bf.update = () => {};
  bf.agent.x = 120; bf.agent.z = -120; bf.syncMesh?.(); // far away to start
});

// Fast-forward fear only, with the player parked somewhere (seconds of game time).
const sim = (opts) => page.evaluate(({ x, z, torch, seconds, fear0, bigfoot }) => {
  const g = __game, f = g.fear, p = g.player;
  p.position.set(x, 0, z);
  if (torch !== undefined && g.flashlight.on !== torch) g.flashlight.toggle();
  if (bigfoot) { const b = g.cryptids.cryptids[0]; b.agent.x = bigfoot.x; b.agent.z = bigfoot.z; b.syncMesh?.(); }
  if (fear0 !== undefined) f.value = fear0;
  const start = f.value;
  const trace = [];
  for (let t = 0; t < seconds; t += 1 / 30) { f.update(1 / 30); if (Math.abs(t % 1) < 1 / 30) trace.push(Math.round(f.value)); }
  return { start: Math.round(start), end: +f.value.toFixed(1), reasons: f.reasons, trace };
}, opts);

const L = await page.evaluate(() => __game.map.landmarks);
const deep = { x: -100, z: 100 }; // deep woods, no lamps
const dark = await sim({ ...deep, torch: false, seconds: 10, fear0: 0 });
check('fear rises standing in the dark (torch off, no lamps)', dark.end > 25 && dark.reasons.includes('dark'), dark);
const torch = await sim({ ...deep, torch: true, seconds: 10, fear0: 50 });
check('turning the torch on lowers it slowly', torch.end < 50 && torch.end > 20, torch);
const lamp = await sim({ x: L.cabin.x, z: L.cabin.z + 1, torch: false, seconds: 5, fear0: 50 });
check('lamplight (the cabin) lowers it faster, even with the torch off', lamp.end < torch.end && lamp.reasons.includes('lamplight'), lamp);
const exit = await page.evaluate(() => __game.HUNT.exit);
const safe = await sim({ x: exit.x, z: exit.z, torch: true, seconds: 3, fear0: 60 });
check('the van is a safe zone: fear drains fastest there', safe.end < 25 && safe.reasons.includes('safe'), safe);
const near = await sim({ ...deep, torch: true, seconds: 5, fear0: 0, bigfoot: { x: deep.x + 14, z: deep.z } });
check('a cryptid nearby raises fear even with the torch on', near.end > 10 && near.reasons.includes('cryptid near'), near);
const jump = await page.evaluate(() => {
  const g = __game, f = g.fear, b = g.cryptids.cryptids[0], p = g.player;
  b.agent.x = p.position.x + 30; b.agent.z = p.position.z; f.update(1 / 30);
  f.value = 10; f.lastScare.clear();
  b.agent.x = p.position.x + 6; // it steps out right beside you
  f.update(1 / 30);
  return { before: 10, after: +f.value.toFixed(1), why: f.lastReason };
});
check('a cryptid suddenly close is a jump scare (instant spike)', jump.after >= 30, jump);
await page.evaluate(() => { const b = __game.cryptids.cryptids[0]; b.agent.x = 120; b.agent.z = -120; b.syncMesh?.(); });

// Sway: measure how far the view wanders from where you're looking over ~1.5 s.
const sway = (fearValue) => page.evaluate(async (v) => {
  const g = __game; g.fear.update = () => {}; g.fear.value = v;
  let max = 0;
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 33));
    const dy = g.camera.rotation.y - g.player.yaw, dx = g.camera.rotation.x - g.player.pitch;
    max = Math.max(max, Math.hypot(dx, dy) * 180 / Math.PI);
  }
  return +max.toFixed(2);
}, fearValue);
const calmSway = await sway(0), scaredSway = await sway(95);
check('high fear sways the view, calm does not', calmSway < 0.01 && scaredSway > 1, { calmSwayDeg: calmSway, terrifiedSwayDeg: scaredSway });

// Photo scores: same shot of Bigfoot calm vs terrified (6 shots each, real mouse buttons).
const setupShot = () => page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids[0], p = g.player, L = g.map.landmarks;
  // Open ground at the campsite clearing, Bigfoot 14 m north of you.
  p.position.set(L.campsite.x, 0, L.campsite.z + 6); p.velocity.set(0, 0, 0);
  b.agent.x = L.campsite.x; b.agent.z = L.campsite.z - 8; b.syncMesh?.();
  p.yaw = 0; p.pitch = Math.atan2(1.3 - 1.68, 14);
});
const shoot = async (fearValue, n) => {
  await page.evaluate((v) => { __game.fear.value = v; }, fearValue);
  await setupShot();
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => __game.photo.raised, null, { timeout: 3000 });
  const scores = [];
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(250 + i * 37);
    await page.waitForFunction(() => __game.photo.cooldown === 0, null, { timeout: 3000 });
    const before = await page.evaluate(() => __game.photo.log.length);
    await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(60);
    scores.push(await page.evaluate((k) => __game.photo.log[k]?.score ?? null, before));
  }
  await page.waitForTimeout(400);
  await shot(fearValue > 50 ? '03-terrified-shot' : '02-calm-shot');
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  return scores;
};
await page.evaluate(() => { if (!__game.flashlight.on) __game.flashlight.toggle(); });
const calm = await shoot(0, 6);
const scared = await shoot(95, 6);
const avg = (a) => a.reduce((s, v) => s + (v ?? 0), 0) / a.length;
check('photo scores drop when fear is high', avg(scared) < avg(calm) * 0.7, { calm, terrified: scared, calmAvg: Math.round(avg(calm)), terrifiedAvg: Math.round(avg(scared)) });

// Captures: the HUD bar and vignette calm vs terrified, in the dark woods.
await page.evaluate(() => { const g = __game; g.fear.value = 5; g.player.position.set(-100, 0, 100); g.player.yaw = 0.5; g.player.pitch = 0; });
await page.waitForTimeout(500);
await shot('01-calm-hud');
await page.evaluate(() => { __game.fear.value = 92; });
await page.waitForTimeout(500);
await shot('04-terrified-hud-vignette');

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
