// Survival check (#68): nutrition + thermoregulation in Pine Hollow. Run: npm run check:t68 [outDir]
// Drives the fixed-step sim directly (?simpaused) so minutes of game time run fast and repeatably.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t68';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4375', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto('http://localhost:4375/?map=forest&seed=68&nodebugai&simpaused');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
  for (const c of g.cryptids.cryptids) { c.update = () => {}; c.agent.x = 140; c.agent.z = -140; }  // keep Bigfoot out of it
});
// Stand at (x, z) for `seconds` of game time; returns the survival readout.
const stay = (x, z, seconds) => page.evaluate(([x, z, seconds]) => {
  const g = __game, p = g.player;
  for (let i = 0; i < seconds * 60; i++) { p.position.set(x, 0, z); p.velocity.set(0, 0, 0); g.sim.step(); }
  const s = g.survival, t = s.thermo, n = s.nutrition;
  return { core: +t.core.toFixed(2), band: t.band, wet: Math.round(t.wetness), inWater: t.inWater, heat: t.nearHeat,
    energy: +n.energy.toFixed(1), food: { ...n.food }, recovery: +p.recoveryScale.toFixed(2),
    warnings: s.warnings().map((w) => w.text), stage: g.hunt.stage };
}, [x, z, seconds]);
const shot = async (n) => { await page.evaluate(() => { __game.sim.frame(0); }); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/${n}.png` }); };
const L = await page.evaluate(() => __game.map.landmarks);
const creek = await page.evaluate(() => {
  for (let z = 0; z < 25; z += 0.25) if (__game.map.surfaceAt(60, z, 0) === 'shallow') return { x: 60, z: z + 1.5 };
  return null;
});

const dry = await stay(L.fork.x, L.fork.z, 90);
check('dry on a cold night: body stays comfortable, no warnings', dry.core >= 36.5 && dry.wet === 0 && dry.warnings.length === 0, dry);

const wading = await stay(creek.x, creek.z, 120);
await shot('01-wading-cold-wet-warnings');
check('standing in the creek soaks you and your temperature drops', wading.inWater === 'shallow' && wading.wet >= 90 && wading.core < 36.5 && wading.core < dry.core, wading);
check('warnings name the cause (wet clothing, wading)', wading.warnings.some((w) => /Wet clothing: losing heat faster/.test(w)) && wading.warnings.some((w) => /Wading/.test(w)), wading.warnings);

const long = await stay(creek.x, creek.z, 20 * 60);
await shot('02-twenty-minutes-in-the-creek');
check('20 more minutes in the water: very cold, stamina recovery slowed, but never lethal (floor, hunt continues)',
  long.core >= 34.6 && long.core < 35.5 && long.recovery < 1 && long.stage === 'search' && long.warnings.some((w) => /cold: shivering/i.test(w)), long);

const fire = await stay(L.campsite.x + 1.5, L.campsite.z + 1.5, 180);
await shot('03-warming-by-the-campfire');
check('by the campfire you dry out and warm back up; cold warnings clear', fire.heat === 'campfire' && fire.wet <= 5 && fire.core >= 36.5 && !fire.warnings.some((w) => /cold|Wet/i.test(w)), fire);

// Hunger: burn energy, then eat with the real Z key.
const hungry = await page.evaluate(() => { __game.survival.nutrition.energy = 30; return __game.survival.warnings().map((w) => w.text); });
const before = await stay(L.fork.x, L.fork.z, 1);
await shot('04-hungry-warning');
await page.keyboard.press('KeyZ');
const ate = await stay(L.fork.x, L.fork.z, 12);
check('energy drains over time (cold makes it faster)', long.energy < dry.energy, { dry: dry.energy, afterColdSoak: long.energy });
check('hungry warning names the cause and the fix', hungry.some((w) => /Hungry: stamina recovers slower\. Eat something \(Z\)/.test(w)), hungry);
check('pressing Z eats: the packed lunch restores energy', ate.energy >= before.energy + 35 && ate.food.packedLunch === before.food.packedLunch - 1, { before: before.energy, after: ate.energy, food: ate.food });
await shot('05-after-eating');

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
