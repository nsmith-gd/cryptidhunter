// Gyms G02–G04 (#108): each gym loads by URL (?map=g02|g03|g04), plays its scripted run, and is
// then reset (reload) and replayed: the two runs must give the same digest (same trace, same final
// state). Blind mode must hide the debug answers. Every pass criterion is reported as
// pass / fail / not_evaluated; any scripted "fail" fails this check.
// Run: npm run check:t108 [outDir] [g02,g03,g04]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] && !process.argv[2].includes(',') && !/^g0/.test(process.argv[2]) ? process.argv[2] : '.ballast/media/t108';
const only = process.argv.find((a) => /^g0\d(,g0\d)*$/.test(a))?.split(',') ?? ['g02', 'g03', 'g04'];
mkdirSync(out, { recursive: true });
const PORT = 4408;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const report = {};

async function load(page, gym, extra = '') {
  await page.goto(`http://localhost:${PORT}/?map=${gym}&simpaused${extra}`);
  await page.waitForFunction(() => window.__gym?.harness, null, { timeout: 120000 });
}

for (const gym of only) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, gym);
  const first = await page.evaluate(() => window.__gym.run());
  // Screenshot: the gym in debug view with the criteria on the HUD.
  await page.evaluate(() => { const g = __game, L = g.map.landmarks, s = L.start; g.player.position.set(s.x, 0, s.z); g.player.yaw = 0; g.player.pitch = -0.12; g.gymHarness.render(); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${gym}-debug-view-with-criteria.png` });
  // Reset (reload the same fixture) and replay.
  await page.evaluate(() => window.__gym.reset());
  await page.waitForFunction(() => window.__gym?.harness && window.__gym.harness.tick === 0, null, { timeout: 120000 });
  const second = await page.evaluate(() => window.__gym.run());
  // Blind mode.
  await load(page, gym, '&blind');
  const blind = await page.evaluate(() => {
    const h = window.__gym.harness, hud = document.querySelector('#gym-hud').textContent;
    return { blind: h.blind, hudSaysBlind: /BLIND MODE/.test(hud), answersHidden: !/TRACE \(last/.test(hud) && !/ordinary trace:/.test(hud),
      overlaysHidden: h.debugObjects.every((o) => !o.visible), overlays: h.debugObjects.length };
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${gym}-blind-mode.png` });
  const id = first.gym;
  check(`${id} loads from ?map=${gym} with its fixed seed`, first.seed === second.seed && first.ticks > 0, { seed: first.seed, ticks: first.ticks, events: first.events });
  check(`${id} reset and replay reach the same state (same digest)`, first.digest === second.digest && first.events === second.events, { first: first.digest, second: second.digest });
  check(`${id} blind mode hides the debug answers`, blind.blind && blind.hudSaysBlind && blind.answersHidden && blind.overlaysHidden, blind);
  const fails = first.criteria.filter((c) => c.status === 'fail');
  check(`${id} no scripted pass criterion fails`, fails.length === 0, fails.map((c) => ({ id: c.id, detail: c.detail })));
  check(`${id} no page errors`, errors.length === 0, errors.slice(0, 3));
  report[id] = { seed: first.seed, digest: first.digest, events: first.events, criteria: first.criteria.map((c) => ({ id: c.id, status: c.status, text: c.text, detail: c.detail })) };
  for (const c of first.criteria) results.push(`  ${c.status.toUpperCase().padEnd(13)} ${id} ${c.text}`);
  await page.close();
}

// Merge with earlier results, so running one gym doesn't drop the others.
let prev = {};
try { prev = JSON.parse(readFileSync(`${out}/gym-results.json`, 'utf8')); } catch { /* first run */ }
writeFileSync(`${out}/gym-results.json`, JSON.stringify({ ...prev, ...report }, null, 2));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
