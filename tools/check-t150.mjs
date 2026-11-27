// G07 capture, containment and cargo gym check (#150, GDD 15.2 G07). Run: npm run check:t150 [outDir]
// Loads ?map=g07 with its fixed seed, runs the scripted tasks, and records each pass criterion; a
// reset replays to the same digest; captures of the yard, a crated specimen, and the criteria.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t150';
mkdirSync(out, { recursive: true });
const PORT = 4450;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); };
const load = async (extra = '') => {
  await page.goto(`http://localhost:${PORT}/?map=g07&simpaused${extra}`);
  await page.waitForFunction(() => window.__gym?.harness?.world, null, { timeout: 120000 });
};
await load();
await page.evaluate(() => { const g = __game, a = g.map.landmarks.anchor; g.player.position.set(a.x + 6, 0, a.z + 14); g.player.yaw = 0.35; g.player.pitch = -0.12;
  document.querySelector('#overlay').style.visibility = 'hidden'; g.sim.frame(1 / 60); g.gymHarness.render(); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01-capture-yard-anchor-rack-crate-generator.png` });
await page.evaluate(() => { document.querySelector('#overlay').style.visibility = ''; });
const first = await page.evaluate(() => window.__gym.run());
for (const c of first.criteria) check(`G07 ${c.id}: ${c.text}`, c.status !== 'fail', { status: c.status, ...c.detail });
await page.evaluate(() => { const g = __game, t = g.map.landmarks.truck; g.player.position.set(t.x - 8, 0, t.z - 6); g.player.yaw = Math.atan2(-(t.x - (t.x - 8)), -(t.z - (t.z - 6))); g.player.pitch = -0.1; g.sim.frame(1 / 60); g.gymHarness.render(); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/02-after-the-run-pass-criteria.png` });
writeFileSync(`${out}/run.json`, JSON.stringify(first, null, 1));
// A crated specimen, mid-run, for a picture: fresh load, script up to the crate.
await load();
await page.evaluate(() => {
  const g = __game, w = g.gymHarness.world; g.input.locked = true; g.overlay?.classList.add('hidden'); if (g.hunt.stage === 'briefing') g.hunt.start();
  const a = g.map.landmarks.anchor; g.player.position.set(a.x + 6, 0, a.z + 6);
  for (let i = 0; i < 60 * 120 && w.state !== 'eligible'; i++) g.sim.step();
  w.commit('light'); g.player.position.set(w.proxy.x + 2, 0, w.proxy.z + 2); g.sim.step(); w.secureAndCrate();
  g.player.position.set(w.crate.x + 4, 0, w.crate.z + 4); g.player.yaw = Math.atan2(-(w.crate.x - g.player.position.x), -(w.crate.z - g.player.position.z)); g.player.pitch = -0.2;
  g.sim.step(); g.sim.frame(1 / 60); g.gymHarness.render();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/03-specimen-contained-in-the-crate.png` });
await page.evaluate(() => window.__gym.reset());
await page.waitForFunction(() => window.__gym?.harness?.world && window.__gym.harness.tick === 0, null, { timeout: 120000 });
const second = await page.evaluate(() => window.__gym.run());
check('G07 loads from ?map=g07 with its fixed seed', first.seed === 707 && first.ticks > 0, { seed: first.seed, ticks: first.ticks, events: first.events });
check('G07 reset and replay reach the same state (same digest)', first.digest === second.digest, { first: first.digest, second: second.digest });
check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 330)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
