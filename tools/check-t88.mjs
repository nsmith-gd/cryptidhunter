// Base camp supplier check (#88). Run: npm run check:t88 [outDir]
// At the base-camp start screen: buy catalogue gear and rent a telephoto camera, see each take
// effect in the hunt (pace on rough ground, warmth, pack size, torch beam, camera lens), undo a
// purchase before committing, find purchases final after committing, get the rental deposit back
// after driving home, keep owned gear for the next hunt, and sell gear back for half its value.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t88';
mkdirSync(out, { recursive: true });
const PORT = 4588;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(results.at(-1).slice(0, 240)); };
const URL = `http://localhost:${PORT}/?map=forest&seed=8808&nodebugai`;
const load = async () => {
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && document.getElementById('supplier-panel'), null, { timeout: 90000 });
};
const click = async (act, arg) => {
  const sel = `#supplier-panel button[data-act="${act}"][data-arg="${arg}"]`;
  await page.evaluate((sel) => document.querySelector(sel).click(), sel);
};
const effects = () => page.evaluate(() => {
  const g = __game, H = g.map.bounds ?? 150;
  // A rough spot (undergrowth / mud / creek bank) where the map slows you.
  let rough = null;
  for (let x = -H + 5; x < H && !rough; x += 3) for (let z = -H + 5; z < H && !rough; z += 3) { const s = g.map.speedAt?.(x, z, 0); if (s !== undefined && s < 0.8 && s > 0.2) rough = { x, z, s }; }
  return { cash: g.camp.ledger.cash, reserved: g.camp.ledger.reservedCents,
    roughMap: rough && +rough.s.toFixed(3), roughPlayer: rough && +g.player.speedAt(rough.x, rough.z, 0).toFixed(3),
    insulation: g.survival.thermo.insulation, packL: g.loadout.load.capacity, wornKg: +g.loadout.load.worn.toFixed(2),
    beamDeg: +(g.flashlight.light.angle * 180 / Math.PI).toFixed(1), lensFov: g.photo.raisedFov,
    owned: g.supplier.owned.map((o) => o.id), rented: g.supplier.rentals.map((r) => r.id) };
});

// ---- fresh career with some savings to spend ----------------------------------------------
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await load();
await page.evaluate(() => { __game.camp.ledger.setCash(120000, 'test savings'); __game.camp.save(); });
await load();
const base = await effects();
await page.evaluate(() => document.getElementById('supplier-panel').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/01-supplier-catalogue.png` });

// ---- buy and rent ------------------------------------------------------------------------
for (const id of ['B05', 'B07', 'B09', 'C05']) await click('buy', id);
await click('rent', 'F08');
const bought = await effects();
await page.evaluate(() => document.getElementById('supplier-panel').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/02-bought-and-rented.png` });
check('buying debits each list price once ($90 + $70 + $55 + $45); renting takes the fee and holds a 20% deposit', bought.cash === base.cash - 26000 - 9500 - 1900 && bought.reserved === 1900,
  { before: base.cash / 100, after: bought.cash / 100, depositHeld: bought.reserved / 100 });
check('hiking boots: rough ground slows you less in this hunt', bought.roughPlayer > base.roughPlayer + 0.1, { map: bought.roughMap, without: base.roughPlayer, withBoots: bought.roughPlayer });
check('insulating midlayer: warmer clothing for the night (insulation 1.0 -> 1.35)', base.insulation === 1 && bought.insulation > 1.3, { before: base.insulation, after: bought.insulation });
check('trail pack: 30 L instead of 12 L', base.packL === 12 && bought.packL === 30, { before: base.packL, after: bought.packL });
check('headlamp: a wider beam', bought.beamDeg > base.beamDeg + 5, { before: base.beamDeg, after: bought.beamDeg });
check('rented telephoto camera: a longer lens for this trip', bought.lensFov < base.lensFov, { before: base.lensFov, after: bought.lensFov });
check('the gear has weight (worn mass goes up)', bought.wornKg > base.wornKg + 1.4, { before: base.wornKg, after: bought.wornKg });

// ---- undo before commit ----------------------------------------------------------------------
const headlampId = await page.evaluate(() => __game.supplier.owned.find((o) => o.id === 'C05').instanceId);
await Promise.all([page.waitForEvent('load'), click('undo', headlampId)]);
await page.waitForFunction(() => window.__game && document.getElementById('supplier-panel'), null, { timeout: 90000 });
const undone = await effects();
check('undo before committing: full refund and the headlamp is gone from the kit', undone.cash === bought.cash + 4500 && !undone.owned.includes('C05') && undone.beamDeg === base.beamDeg, { cash: undone.cash / 100, beamDeg: undone.beamDeg });

// ---- commit (start the hunt): purchases final; drive home: rental returned ----------------------
await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false; g.hunt.onRestart = () => {}; });
await page.waitForTimeout(300);
const final = await page.evaluate(() => {
  const g = __game, boots = g.supplier.owned.find((o) => o.id === 'B05');
  return { undo: g.supplier.undo(boots.instanceId), rentalFinal: g.supplier.rentals.every((r) => !r.refundable), attempt: g.expedition?.attemptId };
});
check('once you commit to the trip, purchases are final (undo refused; sell later instead)', !final.undo.ok && final.rentalFinal, final);
await page.screenshot({ path: `${out}/03-in-hunt-30L-pack.png` });
await page.evaluate(() => { const g = __game, v = g.HUNT.exit; g.hunt.elapsed = g.HUNT.giveUpAfter + 1; g.player.position.set(v.x + 1, 0, v.z + 1); });   // heading home empty-handed is allowed after a while
await page.waitForFunction(() => __game.hunt.inZone, null, { timeout: 20000 });
await page.waitForTimeout(400);
await page.keyboard.press('KeyH'); await page.waitForTimeout(300); await page.keyboard.press('KeyH');
await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 20000 });
const after = await page.evaluate(() => ({ reserved: __game.camp.ledger.reservedCents, returns: __game.hunt.rentalReturns, cash: __game.camp.ledger.cash }));
check('after the trip the rented camera goes back and the deposit is returned', after.reserved === 0 && after.returns?.[0]?.refunded === 1900, after);

// ---- next hunt: owned gear stays, the rental doesn't ------------------------------------------
await load();
const next = await effects();
check('next hunt: owned boots, pack and midlayer still in effect; the rented lens is gone', next.packL === 30 && next.insulation > 1.3 && next.roughPlayer > base.roughPlayer + 0.1 && next.lensFov === base.lensFov,
  { owned: next.owned, rented: next.rented, packL: next.packL, lensFov: next.lensFov });
await page.evaluate(() => document.getElementById('supplier-panel').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/04-next-visit-sell-buttons.png` });

// ---- sell gear back ---------------------------------------------------------------------------
const bootsId = await page.evaluate(() => __game.supplier.owned.find((o) => o.id === 'B05').instanceId);
await Promise.all([page.waitForEvent('load'), click('sell', bootsId)]);
await page.waitForFunction(() => window.__game && document.getElementById('supplier-panel'), null, { timeout: 90000 });
const sold = await effects();
check('selling the used boots pays half their price ($45) and they leave your kit', sold.cash === next.cash + 4500 && !sold.owned.includes('B05') && sold.roughPlayer === base.roughPlayer, { cash: [next.cash / 100, sold.cash / 100], roughPlayer: sold.roughPlayer });
await page.locator('#expedition-panel, #prep-panel').first().scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: `${out}/05-base-camp-start-screen.png` });

check('no page errors', errors.length === 0, errors);
console.log('\n' + results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
