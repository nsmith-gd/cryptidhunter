// Danger & hunt failure check (#89). Run: npm run check:t89 [outDir]
// Every GDD 9.1 way to fail a hunt, through the real game, and its stated consequence:
//   caught by the creature (health 0 from its blows)  -> CAUGHT
//   an untreated wound bleeds out                      -> BLED OUT
//   critical cold in deep water (shared health path)   -> FROZEN, after SOON/NOW warnings
//   ordinary death: carried, deployed, own and rented gear lost; camp stock, cash, archive kept
//   extraction with injuries: a 5% / 10% recovery charge; back to full health next trip
//   hunger alone never kills
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t89';
mkdirSync(out, { recursive: true });
const PORT = 4589;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(results.at(-1).slice(0, 240)); };
const load = async (map = 'forest', extra = '') => {
  await page.goto(`http://localhost:${PORT}/?map=${map}&seed=8909&nodebugai&simpaused${extra}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
};
const start = () => page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  g.cryptids.update = () => {}; g.hunt.onRestart = () => {}; g.huntFailure.onRestart = () => {};
});
const step = (s) => page.evaluate((s) => { for (let t = 0; t < s; t += 1 / 60) __game.sim.step(); }, s);

// ---- setup: a career with savings, extra bait, boots bought, a telephoto rented --------------
await load();
await page.evaluate(() => localStorage.clear());
await load();
await page.evaluate(() => {
  const g = __game;
  g.camp.ledger.setCash(150000, 'test savings');
  g.camp.state.gear.bait = 6;                     // 3 more than the free starter top-up
  g.camp.state.gear.audioLure = 3;                // stock kept at camp
  g.camp.state.loadout = ['bait', 'trailCamera', 'spareBatteries'];   // the lures stay at camp
  g.camp.state.pack = [];
  g.supplier.buy('B05'); g.supplier.rent('F08');
  g.camp.save();
});
await load();
await start();
const before = await page.evaluate(() => ({ cash: __game.camp.ledger.cash, reserved: __game.camp.ledger.reservedCents, carried: __game.loadout.gearLeft(), lures: __game.camp.state.gear.audioLure, archive: __game.evidenceArchive.records.length }));

// ---- 1. caught by Bigfoot ---------------------------------------------------------------------
await page.evaluate(() => { const g = __game; for (let i = 0; i < 4; i++) { g.survival.health.graceUntil.clear(); g.huntFailure.injured('Bigfoot', { damage: 30, wound: 'bruise' }); } });
await step(0.2);
await page.waitForTimeout(600);
const caught = await page.evaluate(() => ({ title: __game.huntFailure.title.textContent, text: __game.huntFailure.reason.textContent, outcome: __game.hunt.outcome,
  cash: __game.camp.ledger.cash, reserved: __game.camp.ledger.reservedCents, gear: { ...__game.camp.state.gear }, owned: __game.supplier.owned.map((o) => o.id), report: __game.hunt.deathReport }));
await page.screenshot({ path: `${out}/01-caught-what-you-lost.png` });
check('caught by the creature: health runs out and the hunt ends (CAUGHT)', caught.title === 'CAUGHT' && caught.outcome === 'caught', { title: caught.title, outcome: caught.outcome });
check('ordinary death loses what you carried (the 6 bait, trail cameras, battery)', caught.gear.bait === 0 && caught.gear.trailCamera === 0 && /Bait x6/.test(caught.text), { carried: before.carried, after: { bait: caught.gear.bait, trailCamera: caught.gear.trailCamera } });
check('...and your own gear on you (hiking boots) and the rental (deposit kept)', !caught.owned.includes('B05') && /Hiking boots/.test(caught.text) && /Telephoto camera \(deposit kept\)/.test(caught.text) && caught.reserved === 0 && caught.cash === before.cash,
  { owned: caught.owned, depositHeldBefore: before.reserved, cashBefore: before.cash, cashAfter: caught.cash });
check('camp stock, banked money and the archive persist (lures left at camp still there; no medical bill)', caught.gear.audioLure === before.lures && /KEPT/.test(caught.text) && /banked money/.test(caught.text) && /No medical bill/.test(caught.text),
  { luresAtCamp: caught.gear.audioLure, kept: caught.report?.kept });

// Next trip: a fresh attempt; the free starter kit is back, the extras are gone.
await load();
const next = await page.evaluate(() => ({ bait: __game.camp.state.gear.bait, health: __game.survival.health.value, boots: __game.supplier.owns('B05'), cash: __game.camp.ledger.cash }));
check('next trip: back to full health, the starter kit topped up (3 bait), the lost extras and boots gone', next.health === 100 && next.bait === 3 && !next.boots, next);

// ---- 2. bleeding out --------------------------------------------------------------------------
await start();
await page.evaluate(() => { const g = __game; g.survival.health.firstAid = 0; g.huntFailure.injured('Bigfoot', { damage: 35, wound: 'bleeding', severity: 'heavy' }); });
const bleedWarn = await page.evaluate(() => __game.survival.warnings().map((w) => w.text).join(' | '));
await step(50);
await page.waitForTimeout(500);
const bled = await page.evaluate(() => ({ title: __game.huntFailure.title.textContent, text: __game.huntFailure.reason.textContent.split('\n')[0], outcome: __game.hunt.outcome }));
await page.screenshot({ path: `${out}/02-bled-out.png` });
check('an untreated heavy wound bleeds out (BLED OUT), after a warning naming it', /bleeding/i.test(bleedWarn) && bled.outcome === 'caught' && bled.title === 'BLED OUT' && /bled out/.test(bled.text), { warning: bleedWarn, ...bled });

// ---- 3. hunger alone never kills --------------------------------------------------------------
await load();
await start();
await page.evaluate(() => { const g = __game; g.survival.nutrition.energy = 1; g.survival.nutrition.food = {}; });
await step(180);
const hunger = await page.evaluate(() => ({ energy: Math.round(__game.survival.nutrition.energy), dead: __game.survival.health.dead, health: Math.round(__game.survival.health.value), stage: __game.hunt.stage }));
check('hunger alone never kills (energy at its floor, health untouched)', !hunger.dead && hunger.health === 100 && hunger.stage !== 'ended', hunger);

// ---- 4. extraction with an injury: recovery charge --------------------------------------------
await page.evaluate(() => { const g = __game; g.survival.health.value = 55; g.survival.health.conditions.push({ id: 99, kind: 'dressed', severity: 'light', cause: 'Bigfoot', at: 0 });
  const v = g.HUNT.exit; g.hunt.elapsed = g.HUNT.giveUpAfter + 1; g.player.position.set(v.x + 1, 0, v.z + 1); });
await step(0.3);
const cashBeforeExit = await page.evaluate(() => __game.camp.ledger.cash);
await page.evaluate(() => { const ev = (c) => dispatchEvent(new KeyboardEvent('keydown', { code: c })); ev('KeyH'); ev('KeyH'); });
await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 20000 });
await page.waitForTimeout(700);
const rec = await page.evaluate(() => ({ recovery: __game.hunt.recovery, tx: __game.camp.ledger.tx.filter((t) => t.id.startsWith('recovery:')).map((t) => t.cents), text: document.body.innerText.match(/Injury recovery[^\n]*/)?.[0], closing: document.body.innerText.match(/Closing cash[^\n]*/)?.[0] }));
await page.screenshot({ path: `${out}/03-extracted-hurt-recovery-charge.png` });
check('coming home hurt (moderate): a visible 5% recovery charge on the $25 trip ($1.25)', rec.recovery?.severity === 'moderate' && rec.tx[0] === -125 && /Injury recovery\s+-\$1\.25 \(moderate injury\)/.test(rec.text ?? ''), rec);

// ---- 5. critical cold in deep water (Blackwater Swamp) -----------------------------------------
await load('swamp');
await start();
const cold = await page.evaluate(() => {
  const g = __game, p = g.player, H = g.map.bounds ?? 50;
  let spot = null;
  for (let x = -H + 2; x < H && !spot; x += 1.5) for (let z = -H + 2; z < H && !spot; z += 1.5) if (g.map.surfaceAt(x, z, 0) === 'deep') spot = { x, z };
  if (!spot) return { spot: null };
  const stay = () => { p.position.set(spot.x, g.map.heightAt?.(spot.x, spot.z) ?? 0, spot.z); p.velocity.set(0, 0, 0); };
  let soonAt = null, nowAt = null, drainAt = null, t = 0;
  while (!g.survival.health.dead && t < 900) {
    stay(); g.sim.step(); t += 1 / 60;
    const c = g.status.conditions().find((x) => x.id === 'hypothermia');
    if (soonAt === null && c?.stage === 'soon') soonAt = t;
    if (nowAt === null && c?.stage === 'now') nowAt = t;
    if (drainAt === null && g.survival.health.value < 100) drainAt = t;
    if (nowAt !== null && t - nowAt > 30 && t - nowAt < 30 + 1 / 30) { window.__shotCold = true; break; }
  }
  return { spot, soonAt: soonAt && +soonAt.toFixed(0), nowAt: nowAt && +nowAt.toFixed(0), drainAt: drainAt && +drainAt.toFixed(0), core: +g.survival.thermo.core.toFixed(2), health: Math.round(g.survival.health.value) };
});
await page.evaluate(() => { const g = __game; g.survival.render(); g.bars?.update?.(0); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/04-hypothermic-warning.png` });
const frozen = await page.evaluate(() => {
  const g = __game, p = g.player, H = g.map.bounds ?? 50; let t = 0;
  while (!g.survival.health.dead && t < 900) { g.sim.step(); t += 1 / 60; }
  for (let i = 0; i < 5; i++) g.sim.step();
  return { dead: g.survival.health.dead, title: g.huntFailure.title.textContent, text: g.huntFailure.reason.textContent.split('\n')[0], outcome: g.hunt.outcome, extraS: +t.toFixed(0) };
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/05-frozen.png` });
check('deep cold water: "dangerously cold" (SOON) before health loss, then "hypothermic" (NOW) while it drains', cold.spot && cold.soonAt !== null && cold.soonAt < cold.drainAt && cold.nowAt <= cold.drainAt + 1, cold);
check('staying in it kills by hypothermia through the health path (FROZEN)', frozen.dead && frozen.title === 'FROZEN' && frozen.outcome === 'caught' && /hypothermia/.test(frozen.text), frozen);

check('no page errors', errors.length === 0, errors);
console.log('\n' + results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
