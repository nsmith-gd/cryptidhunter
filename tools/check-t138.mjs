// Gym G05, water, weather and power (#138): loads by URL (?map=g05, and ?map=g05&storm), plays its
// scripted run, resets (reload) and replays to the same digest, hides the answers in blind mode, and
// reports every GDD 15.2 G05 pass criterion as pass / fail / not_evaluated. Any scripted fail fails.
// Run: npm run check:t138 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t138';
mkdirSync(out, { recursive: true });
const PORT = 4438;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const report = {};
const load = async (page, extra = '') => {
  await page.goto(`http://localhost:${PORT}/?map=g05&simpaused${extra}`);
  await page.waitForFunction(() => window.__gym?.harness?.world, null, { timeout: 120000 });
};

for (const variant of ['calm', 'storm']) {
  const extra = variant === 'storm' ? '&storm' : '';
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, extra);
  // A view of the lake from the dock before the run (boat, buoy, station).
  await page.evaluate(() => { const g = __game, d = g.map.landmarks.dock; g.player.position.set(d.x + 3, 0, d.z + 4); g.player.yaw = 0.15; g.player.pitch = -0.08; g.gymHarness.render(); });
  await page.waitForTimeout(2500);
  // (the camp menus are still up before the run starts the hunt: hide them for this picture only)
  await page.evaluate(() => { document.querySelector('#overlay').style.visibility = 'hidden'; });
  await page.screenshot({ path: `${out}/${variant}-01-lake-from-the-dock.png` });
  await page.evaluate(() => { document.querySelector('#overlay').style.visibility = ''; });
  const first = await page.evaluate(() => window.__gym.run());
  await page.evaluate(() => { const g = __game, w = g.gymHarness.world; g.player.position.set(w.boat.x + 6, 0.35, w.boat.z + 6); g.player.yaw = Math.atan2(-(w.boat.x - g.player.position.x), -(w.boat.z - g.player.position.z)); g.player.pitch = -0.2; g.gymHarness.render(); });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${variant}-02-after-the-run-with-criteria.png` });
  await page.evaluate(() => window.__gym.reset());
  await page.waitForFunction(() => window.__gym?.harness?.world && window.__gym.harness.tick === 0, null, { timeout: 120000 });
  const second = await page.evaluate(() => window.__gym.run());
  await load(page, `${extra}&blind`);
  const blind = await page.evaluate(() => {
    const h = window.__gym.harness, hud = document.querySelector('#gym-hud').textContent;
    return { blind: h.blind, hudSaysBlind: /BLIND MODE/.test(hud), answersHidden: !/TRACE \(last/.test(hud) && !/mugwump:/.test(hud), proxyHidden: !h.world.proxy.mesh.visible };
  });
  const id = `G05 ${variant}`;
  check(`${id}: loads from ?map=g05${extra} with its fixed seed`, first.seed === 505 && first.ticks > 0, { seed: first.seed, ticks: first.ticks, events: first.events });
  check(`${id}: reset and replay reach the same state (same digest)`, first.digest === second.digest && first.events === second.events, { first: first.digest, second: second.digest });
  check(`${id}: blind mode hides the answers (the creature under the water, the trace)`, blind.blind && blind.hudSaysBlind && blind.answersHidden && blind.proxyHidden, blind);
  const fails = first.criteria.filter((c) => c.status === 'fail');
  check(`${id}: no scripted pass criterion fails`, fails.length === 0, fails.map((c) => ({ id: c.id, detail: c.detail })));
  check(`${id}: no page errors`, errors.length === 0, errors.slice(0, 3));
  report[id] = { digest: first.digest, events: first.events, criteria: first.criteria };
  for (const c of first.criteria) results.push(`  ${c.status.toUpperCase().padEnd(13)} ${id} ${c.text}`);
  await page.close();
}
const stormRow = report['G05 storm'].criteria.find((c) => c.id === 'storm');
check('the storm variant is evaluated (more fuel, pushed downwind)', stormRow?.status === 'pass', stormRow);

writeFileSync(`${out}/gym-results.json`, JSON.stringify(report, null, 2));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
