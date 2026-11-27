// Recovery assignment (#105): with $0 and nothing to sell, the start screen offers the sponsor's
// survey (and won't let you take a free trip instead). Take it: you go out with the loaner kit,
// log fresh sign at both flagged survey points, drive out, and get exactly $100. The loaner kit
// never joins your own gear, and with $100 in hand the sponsor's offer is gone.
// Run: npm run check:t105 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t105';
mkdirSync(out, { recursive: true });
const PORT = 4405;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const URL = `http://localhost:${PORT}/?map=forest&nodebugai&seed=7`;
const ready = () => page.waitForFunction(() => window.__game?.sponsorSurvey && window.__game.map, null, { timeout: 120000 });

await page.goto(URL);
await ready();
// Broke: $0 cash, only the always-carried camera and torch (nothing a shop would buy back).
await page.evaluate(() => {
  const g = __game;
  g.camp.state.money = 0;
  g.camp.state.gear = { camera: 1, flashlight: 1 };
  g.camp.state.recovery = { count: 0, active: null, history: [] };
  g.camp.save();
});
await page.goto(URL);
await ready();
const offer = await page.evaluate(() => {
  const g = __game;
  return { cash: g.camp.ledger.cash, offered: g.sponsorSurvey.offered, panel: !!document.querySelector('#sponsor-panel button[data-act="accept"]'),
    freeTrip: g.expedition.commit().ok, commitButton: !!document.querySelector('#prep-panel button[data-act="commit"]'), gearBefore: { ...g.camp.state.gear } };
});
check('with $0 the sponsor survey is offered on the start screen', offer.cash === 0 && offer.offered && offer.panel, offer);
check('a broke player can\'t take a free trip instead (no commit button, commit refused)', !offer.freeTrip && !offer.commitButton, offer);
await page.screenshot({ path: `${out}/01-start-screen-broke-sponsor-offer.png` });

// Take the survey: the page reloads with the assignment active.
await page.evaluate(() => { window.__beforeAccept = true; });
await page.evaluate(() => document.querySelector('#sponsor-panel button[data-act="accept"]').click());
await page.waitForFunction(() => !window.__beforeAccept && window.__game?.sponsorSurvey?.active && window.__game.map, null, { timeout: 240000 });
const taken = await page.evaluate(() => {
  const g = __game, a = g.sponsorSurvey.active;
  return { active: !!a, id: a?.id, sites: a?.sites.map((s) => s.name), offered: g.sponsorSurvey.offered,
    owned: g.loadout.owned, stakes: a?.sites.map((s) => !!g.scene.getObjectByName(`survey-stake-${s.key}`)) };
});
check('the survey is active with two distinct survey points, each marked with a stake', taken.active && taken.sites.length === 2 && taken.sites[0] !== taken.sites[1] && taken.stakes.every(Boolean), taken);
check('you go out with the loaner kit, not your own gear', JSON.stringify(taken.owned) === JSON.stringify({ camera: 1, flashlight: 1, spareBatteries: 1 }), taken);
await page.screenshot({ path: `${out}/02-start-screen-survey-active.png` });

// Set off: the trip is waived for the survey.
const started = await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  return { attempt: g.sponsorSurvey.active.attemptId, cash: g.camp.ledger.cash, stage: g.hunt.stage };
});
check('setting off costs nothing and binds the survey to a fresh attempt', !!started.attempt && started.cash === 0, started);

// Visit each survey point and examine its fresh sign (the journal's examine path).
for (let i = 0; i < 2; i++) {
  const site = await page.evaluate((i) => {
    const g = __game, s = g.sponsorSurvey.active.sites[i], p = g.player;
    p.position.set(s.x - 2, 0, s.z + 2); p.velocity.set(0, 0, 0);
    p.yaw = Math.atan2(-(s.x + 2 - p.position.x), -(s.z + 0.6 - p.position.z)); p.pitch = -0.45;
    if (!g.flashlight.on) g.flashlight.toggle();
    const trace = g.clues.clues.find((c) => c.data?.survey === s.key);
    g.journal.record(trace);
    return { name: s.name, trace: !!trace };
  }, i);
  await page.waitForTimeout(2500);
  const done = await page.evaluate((i) => __game.sponsorSurvey.active.sites[i].done, i);
  check(`survey point ${i + 1} (${site.name}) is logged once its fresh sign is examined`, site.trace && done, site);
  if (i === 0) await page.screenshot({ path: `${out}/03-survey-stake-and-fresh-sign.png` });
}

// Drive out.
await page.evaluate(() => { const g = __game; g.player.position.set(g.HUNT.exit.x, 0, g.HUNT.exit.z); g.hunt.end('complete'); });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const g = __game;
  return { cash: g.camp.ledger.cash, sponsor: g.hunt.sponsor, active: g.sponsorSurvey.active, offered: g.sponsorSurvey.offered,
    gear: { ...g.camp.state.gear }, history: g.camp.state.recovery.history, payouts: g.camp.ledger.tx.filter((t) => t.id.startsWith('sponsor:')).length };
});
check('delivering the survey pays exactly $100, once', after.cash === 10000 && after.sponsor?.paid && after.payouts === 1, after);
check('the loaner kit never joins your gear', JSON.stringify(after.gear) === JSON.stringify(offer.gearBefore), after);
check('with a trip affordable again, the sponsor stops offering work', !after.active && !after.offered, after);
await page.screenshot({ path: `${out}/04-results-survey-delivered-100.png` });

check('no page errors', errors.length === 0, errors);
writeFileSync(`${out}/run.json`, JSON.stringify({ offer, taken, started, after }, null, 2));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
