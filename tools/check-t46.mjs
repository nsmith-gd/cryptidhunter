// Shop and upgrades check (#46). Run: npm run check:t46 [outDir]
// Buys upgrades and gear through the base-camp shop buttons, checks money and live stats change,
// that you can't overspend or over-upgrade, and that everything carries into the next hunt
// (a fresh page load, like starting the next night).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t46';
mkdirSync(out, { recursive: true });
const PORT = 4446;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });   // localStorage persists across loads
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const URL = `http://localhost:${PORT}/?map=forest&nodebugai`;

const load = async () => { await page.goto(URL); await page.waitForFunction(() => window.__game && document.getElementById('shop-panel'), null, { timeout: 90000 }); };
const stats = () => page.evaluate(() => {
  const g = __game;
  return { money: g.camp.state.money, upgrades: { ...(g.camp.state.upgrades ?? {}) }, film: g.photo.film, filmTotal: g.photo.filmTotal,
    zoomFov: g.photo.raisedFov, batteryLife: g.flashlight.batteryLife, baitOwned: g.camp.state.gear.bait, shopText: document.getElementById('shop-panel').innerText };
});
const click = (kind, key) => page.click(`#shop-panel button[data-kind="${kind}"][data-key="${key}"]`);

// Fresh camp with $1000 to spend.
await load();
await page.evaluate(() => { localStorage.clear(); const c = __game.camp; c.reset(); c.state.money = 1000; c.save(); });
await load();
const s0 = await stats();
check('base camp shows a shop with upgrades and gear', /SHOP/.test(s0.shopText) && /Film capacity/.test(s0.shopText) && /Zoom lens/.test(s0.shopText) && /Flashlight battery/.test(s0.shopText) && /Bait/.test(s0.shopText), s0.shopText.slice(0, 160));
check('starts with stock gear: 12-shot roll, standard zoom, 120 s battery', s0.filmTotal === 12 && s0.zoomFov === 40 && s0.batteryLife === 120, s0);
await page.screenshot({ path: `${out}/01-base-camp-shop.png` });

// Buy one level of each upgrade and two bait.
await click('upgrade', 'film'); await click('upgrade', 'zoom'); await click('upgrade', 'battery');
await click('gear', 'bait'); await click('gear', 'bait');
const s1 = await stats();
const spent = 90 + 110 + 80 + 15 * 2;
check('buying spends the right money', s1.money === 1000 - spent, { money: s1.money, expected: 1000 - spent });
check('upgrades apply right away: bigger roll, more zoom, longer battery', s1.filmTotal === 18 && s1.film === 18 && s1.zoomFov === 30 && s1.batteryLife === 170, s1);
check('bought bait is added to what camp owns', s1.baitOwned === s0.baitOwned + 2, { before: s0.baitOwned, after: s1.baitOwned });
const loadoutBait = await page.evaluate(() => __game.bait.carried);
check('bought bait is in the pack for this hunt (if bait is slotted)', loadoutBait === s1.baitOwned || !__game, { carried: loadoutBait, owned: s1.baitOwned });
await page.screenshot({ path: `${out}/02-after-buying.png` });

// Max out film, then try once more: refused, no money taken.
await click('upgrade', 'film'); await click('upgrade', 'film');
const s2 = await stats();
const maxed = await page.evaluate(() => document.querySelector('#shop-panel button[data-kind="upgrade"][data-key="film"]').disabled);
check('film maxes out at 36 shots and its button locks', s2.filmTotal === 36 && maxed, { filmTotal: s2.filmTotal, buttonDisabled: maxed });

// Can't overspend.
await page.evaluate(() => { const c = __game.camp; c.state.money = 10; c.save(); __game.shop.render(); });
const poor = await page.evaluate(() => {
  const disabled = [...document.querySelectorAll('#shop-panel button')].every((b) => b.disabled);
  return { disabled };
});
await click('gear', 'spareBatteries').catch(() => {});
const s3 = await stats();
check("can't buy what you can't afford (buttons lock, money unchanged)", poor.disabled && s3.money === 10, { ...poor, money: s3.money });
await page.evaluate(() => { const c = __game.camp; c.state.money = 500; c.save(); });

// Night vision drains the bigger battery more slowly.
const nv = await page.evaluate(() => {
  const g = __game; g.flashlight.battery = 1; g.nightVision.on = true;
  for (let i = 0; i < 60; i++) g.nightVision.update(1 / 6);   // 10 s of goggles
  const used = 1 - g.flashlight.battery; g.nightVision.on = false; g.flashlight.battery = 1;
  return { usedIn10s: +used.toFixed(4), stockWouldUse: +(10 / 90).toFixed(4) };
});
check('night vision lasts longer on the bigger battery', nv.usedIn10s < nv.stockWouldUse * 0.8, nv);

// Next hunt: a fresh load (also after a hunt is settled at camp).
await page.evaluate(() => { __game.camp.settleHunt({ outcome: 'abandoned', photos: [], gearLeft: {}, target: 'Bigfoot' }); });
await load();
const s4 = await stats();
check('upgrades carry into the next hunt (film, zoom, battery)', s4.filmTotal === 36 && s4.film === 36 && s4.zoomFov === 30 && s4.batteryLife === 170,
  { filmTotal: s4.filmTotal, zoomFov: s4.zoomFov, batteryLife: s4.batteryLife, upgrades: s4.upgrades });
check('money carries into the next hunt', s4.money === 500, { money: s4.money });
check('the shop remembers upgrade levels', s4.upgrades.film === 3 && s4.upgrades.zoom === 1 && s4.upgrades.battery === 1, s4.upgrades);

// In hunt: the zoomed viewfinder and the film counter.
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start?.();
  g.player.position.set(0, 0, 112); g.player.yaw = 0; g.player.pitch = 0.05; g.photo.wantRaised = true;
});
await page.waitForTimeout(1500);
const raised = await page.evaluate(() => { for (let i = 0; i < 10; i++) __game.photo.update(0.05); return ({ fov: +__game.camera.fov.toFixed(1), film: document.querySelector('#viewfinder .vf-film')?.textContent }); });
check('in the hunt the viewfinder zooms to the upgraded lens and shows the bigger roll', Math.abs(raised.fov - 30) < 1 && /36\/36/.test(raised.film ?? ''), raised);
await page.screenshot({ path: `${out}/03-upgraded-viewfinder.png` });
const canBuyDuringHunt = await page.evaluate(() => [...document.querySelectorAll('#shop-panel button')].every((b) => b.disabled) || (__game.shop.render(), [...document.querySelectorAll('#shop-panel button')].every((b) => b.disabled)));
check('the shop is closed once the hunt has started', canBuyDuringHunt, { allDisabled: canBuyDuringHunt });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
