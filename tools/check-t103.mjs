// Hydration S07 (#103). Run: npm run check:t103 [outDir]
// Pine Hollow, fixed-step sim, real keys. Dehydrated with a heavy pack: sprint up the trail, then
// measure stamina recovery while walking; drink (I) until hydrated and sprint/recover again:
// recovery is faster. The status screen names the cause. At the creek, I fills the canteen with a
// purification tablet; it is safe after the wait. Hydration is off in the tutorial (L01 has none).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t103';
mkdirSync(out, { recursive: true });
const PORT = 4403;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${n}.png` }); };

await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => { localStorage.clear(); });
// A heavy pack: 6 L of water and every bit of gear packed.
await page.goto(`http://localhost:${PORT}/?map=forest&seed=103&nodebugai&simpaused&water=6&pack=nightVision,knockStick`);
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game; g.expedition.commit(); g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
  const b = g.cryptids.cryptids[0]; b.update = () => {}; b.agent.x = 140; b.agent.z = -140;
  g.survival.nutrition.energy = 90;            // only thirst limits recovery in this test
});
const h0 = await page.evaluate(() => ({ on: __game.survival.hydration.enabled, value: __game.survival.hydration.value, canteen: __game.survival.hydration.canteen.litres, load: +__game.loadout.load.total.toFixed(1), ratio: +__game.loadout.load.ratio.toFixed(2) }));
check('hydration is on in Pine Hollow: a reserve, a full 1 L canteen (in the pack load) and the packed water', h0.on && h0.value > 50 && h0.canteen === 1 && h0.load > 15, h0);

// Sprint up the open trail, then walk on and measure how fast stamina comes back.
const run = async (label) => {
  await page.evaluate(() => { const p = __game.player; p.position.set(0, 0, 140); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = 0; p.stamina = 1; p.exhausted = false; });
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await steps(4 * 60);
  await page.keyboard.up('ShiftLeft');
  const s0 = await page.evaluate(() => __game.player.stamina);
  await steps(4 * 60);
  await page.keyboard.up('KeyW');
  const s1 = await page.evaluate(() => __game.player.stamina);
  // Then stand still and get your breath back from the same point both times.
  await page.evaluate(() => { const p = __game.player; p.stamina = 0.3; p.exhausted = false; p.velocity.set(0, 0, 0); });
  await steps(Math.round(1.5 * 60));
  const rest = await page.evaluate(() => __game.player.stamina - 0.3);
  return { label, afterSprint: +s0.toFixed(3), walked: +(s1 - s0).toFixed(3), restRecovered: +rest.toFixed(3), recoveryScale: await page.evaluate(() => +__game.player.recoveryScale.toFixed(2)) };
};
await page.evaluate(() => { __game.survival.hydration.value = 15; });   // a long dry walk in
const dry = await run('dehydrated');
await page.evaluate(() => __game.sim.frame(0));
const warn = await page.evaluate(() => [...document.querySelectorAll('#survival .warn div')].map((d) => d.textContent).join(' | '));
await page.keyboard.press('Tab'); await steps(2);
const statusText = await page.evaluate(() => document.getElementById('status-screen')?.innerText ?? '');
await shot('01-dehydrated-status-screen');
await page.keyboard.press('Tab'); await steps(2);
check('dehydrated, the HUD warning and the status screen name the cause: "Dehydrated ... stamina recovers slower"',
  /Dehydrated[^|]*stamina recovers slower/.test(warn) && /Dehydrated/.test(statusText) && /Hydration/.test(statusText), { warn, status: statusText.match(/Dehydrated[^\n]*\n?[^\n]*/)?.[0] });

// Drink with I until hydrated (real key presses, absorbed over a few seconds each).
const before = await page.evaluate(() => ({ v: __game.survival.hydration.value, water: __game.loadout.water }));
for (let i = 0; i < 8; i++) { await page.keyboard.press('KeyI'); await steps(30); }
await steps(8 * 60);
const after = await page.evaluate(() => ({ v: +__game.survival.hydration.value.toFixed(1), water: __game.loadout.water, load: +__game.loadout.load.total.toFixed(1) }));
check('I drinks: 8 drinks take 2 L from the packed bottles (lighter pack) and hydration climbs back over 50', after.v > 50 && Math.abs(before.water - after.water - 2) < 1e-6 && after.load < h0.load, { before, after });
const wet = await run('hydrated');
await shot('02-hydrated');
check('after drinking, the same sprint-then-walk recovers stamina faster', wet.restRecovered > dry.restRecovered * 1.3 && wet.recoveryScale > dry.recoveryScale, { dry, wet });

// The creek: fill the canteen with a tablet; safe after the wait.
const creek = await page.evaluate(() => {
  const g = __game;
  // Nearest wading spot to the footbridge (35, 20).
  for (let r = 9; r < 60; r += 1) for (let a = 0; a < 32; a++) {
    const x = 35 + Math.cos(a / 32 * Math.PI * 2) * r, z = 20 + Math.sin(a / 32 * Math.PI * 2) * r;
    if (g.map.surfaceAt(x, z, 0) === 'shallow' && !g.map.colliders.some((b) => x > b.min.x - 1 && x < b.max.x + 1 && z > b.min.z - 1 && z < b.max.z + 1)) return { x: +x.toFixed(1), z: +z.toFixed(1) };
  }
  return null;
});
await page.evaluate((c) => {
  const g = __game, h = g.survival.hydration; h.canteen.litres = 0; h.tablets = 1;
  g.player.position.set(c.x, 0, c.z); g.player.velocity.set(0, 0, 0);
}, creek);
await steps(5);
await page.keyboard.press('KeyI'); await steps(2);
await page.evaluate(() => __game.sim.frame(0));
const filled = await page.evaluate(() => { const h = __game.survival.hydration; return { litres: h.canteen.litres, safe: h.canteen.safe, purifying: Math.round(h.canteen.purifyLeft), tablets: h.tablets, hud: document.querySelector('#survival .wn').textContent }; });
await shot('03-filling-canteen-at-the-creek');
await steps(31 * 60);
const safe = await page.evaluate(() => __game.survival.hydration.canteen.safe);
check('at the creek, I fills the canteen and drops in a tablet: purifying, then safe to drink after the wait',
  creek && filled.litres === 1 && !filled.safe && filled.purifying > 20 && filled.tablets === 0 && /purifying/.test(filled.hud) && safe, { creek, filled, safe });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
