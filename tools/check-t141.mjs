// Gym G04, territory, pursuit and withdrawal (#141): loads ?map=g04, plays its scripted run twice with
// different approaches (recover the camera case from the core / abandon it), replays each to the same
// digest after a reset, checks blind mode hides the answers (territory rings, proxy states, trace),
// and reports every GDD 15.2 G04 criterion as pass / fail / not_evaluated. Any scripted fail fails.
// Run: npm run check:t141 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t141';
mkdirSync(out, { recursive: true });
const PORT = 4442;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const report = {};
const load = async (page, extra = '') => {
  await page.goto(`http://localhost:${PORT}/?map=g04&simpaused${extra}`);
  await page.waitForFunction(() => window.__gym?.harness?.world, null, { timeout: 120000 });
};

for (const approach of ['recover', 'abandon']) {
  const extra = `&approach=${approach}`;
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, extra);
  if (approach === 'recover') {
    // The fork from the trail: the warning stumps and claw marks, the case in the core, hide A.
    await page.evaluate(() => { document.querySelector('#overlay').style.visibility = 'hidden'; const g = __game; g.player.position.set(-1, 0, 9); g.player.yaw = 0.57; g.player.pitch = -0.08; g.sim.step(); g.gymHarness.render(); });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/01-the-fork-warning-ring-and-the-case.png` });
    await load(page, extra);   // fresh fixture: the picture moved the player
  }
  const first = await page.evaluate(() => window.__gym.run());
  await page.evaluate(() => { const g = __game; g.player.position.set(2, 0, 6); g.player.yaw = 0.75; g.player.pitch = -0.1; g.sim.step(); g.gymHarness.render(); });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${approach === 'recover' ? '02' : '03'}-after-the-${approach}-run-with-criteria.png` });
  await page.evaluate(() => window.__gym.reset());
  await page.waitForFunction(() => window.__gym?.harness?.world && window.__gym.harness.tick === 0, null, { timeout: 120000 });
  const second = await page.evaluate(() => window.__gym.run());
  await load(page, `${extra}&blind`);
  const blind = await page.evaluate(() => {
    const h = window.__gym.harness, hud = document.querySelector('#gym-hud').textContent;
    return { blind: h.blind, hudSaysBlind: /BLIND MODE/.test(hud), answersHidden: !/TRACE \(last/.test(hud) && !/territorial:/.test(hud), ringsHidden: h.debugObjects.every((o) => !o.visible) };
  });
  const id = `G04 ${approach}`;
  check(`${id}: loads from ?map=g04${extra} with its fixed seed`, first.seed === 404 && first.ticks > 0, { seed: first.seed, ticks: first.ticks, events: first.events });
  check(`${id}: reset and replay reach the same state (same digest)`, first.digest === second.digest && first.events === second.events, { first: first.digest, second: second.digest });
  check(`${id}: blind mode hides the answers (territory rings, proxy states, trace)`, blind.blind && blind.hudSaysBlind && blind.answersHidden && blind.ringsHidden, blind);
  const fails = first.criteria.filter((c) => c.status === 'fail');
  check(`${id}: no scripted pass criterion fails`, fails.length === 0, fails.map((c) => ({ id: c.id, detail: c.detail })));
  check(`${id}: no page errors`, errors.length === 0, errors.slice(0, 3));
  report[id] = { digest: first.digest, events: first.events, criteria: first.criteria };
  for (const c of first.criteria) results.push(`  ${c.status.toUpperCase().padEnd(13)} ${id} ${c.text}`);
  await page.close();
}
const gear = Object.fromEntries(Object.entries(report).map(([k, r]) => [k, r.criteria.find((c) => c.id === 'measures')?.detail]));
check('the two approaches record different withdrawal decisions and gear loss', gear['G04 recover']?.gearLost === 0 && gear['G04 abandon']?.gearLost > 0, gear);

writeFileSync(`${out}/gym-results.json`, JSON.stringify(report, null, 2));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
