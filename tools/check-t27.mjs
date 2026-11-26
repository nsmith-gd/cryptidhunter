// Loadout check. Run: npm run check:t27 [outDir]
// Pick 4 items on the start screen (real clicks), switch slots with 1-4 and the mouse wheel,
// use each with Q / left-click, and confirm every item you own works when equipped, while
// gear left at camp can't be used. Two hunts cover all six owned items.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t27';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4358', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

const load = async () => {
  await page.goto('http://localhost:4358/?map=forest');
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(300);
};
const pick = (name) => page.click(`#loadout-picker button:has-text("${name}")`);
const slots = () => page.evaluate(() => __game.loadout.slots);
const begin = () => page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
  const L = g.map.landmarks; g.player.position.set(L.campsite.x - 6, 0, L.campsite.z + 8); g.player.yaw = 0; g.player.pitch = -0.2;
});
// State of every item's effect.
const effects = () => page.evaluate(() => {
  const g = __game;
  return { bait: g.bait.carried, baitsPlaced: g.bait.baits.length, trailCams: g.trailCams.carried, lures: g.audioLures.carried,
    luresPlaced: g.audioLures.lures.length, nvg: g.nightVision.on, knocks: g.knocks.log.filter((k) => k.who === 'player').length,
    spares: g.flashlight.spares, battery: +g.flashlight.battery.toFixed(2), active: g.loadout.activeItem };
});
// Select a slot with its number key and use it with Q (or a left-click with the camera down).
const useSlot = async (n, via = 'q') => {
  await page.keyboard.press(`Digit${n}`);
  await page.waitForTimeout(80);
  const before = await effects();
  if (via === 'click') { await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' }); }
  else await page.keyboard.press('KeyQ');
  await page.waitForTimeout(250);
  return { before, after: await effects() };
};

await page.goto('http://localhost:4358/');
await page.evaluate(() => localStorage.clear());
await load();
const owned = await page.evaluate(() => Object.keys(__game.camp.state.gear).filter((k) => __game.camp.state.gear[k] > 0));
const def = await slots();
check('a default loadout of 4 is packed', def.length === 4, { def, owned });
// Real clicks on the start screen. Since #69 a click cycles an item: quick slot -> pack -> camp.
// Leave the spare battery at camp (two clicks), put the night vision in a slot.
await pick('Spare battery'); await pick('Spare battery');
await pick('Night vision');
const chosen = await slots();
await page.click('#loadout-picker button:has-text("Knock stick")'); // a 5th item doesn't fit a slot: it goes in the pack
const capped = await slots();
const packed5 = await page.evaluate(() => [...__game.loadout.pack]);
await page.click('#loadout-picker button:has-text("Knock stick")'); // and a second click leaves it at camp
const packAfter = await page.evaluate(() => [...__game.loadout.pack]);
await shot('01-loadout-picker');
check('clicking items on the start screen packs them (max 4 quick slots; a 5th goes in the pack, clicking again leaves it at camp)',
  chosen.includes('nightVision') && !chosen.includes('spareBatteries') && capped.length === 4 && !capped.includes('knockStick')
  && packed5.includes('knockStick') && !packAfter.includes('knockStick') && !packAfter.includes('spareBatteries'), { chosen, capped, packed5, packAfter });

await begin();
await page.waitForTimeout(300);
await shot('02-slots-hud');
const order = await slots();
const res = {};
for (let i = 0; i < order.length; i++) res[order[i]] = await useSlot(i + 1, order[i] === 'trailCamera' ? 'click' : 'q');
check('bait: slot + Q drops a bait', res.bait?.after.bait === res.bait?.before.bait - 1 && res.bait.after.baitsPlaced === res.bait.before.baitsPlaced + 1, res.bait);
check('trail camera: slot + left-click (camera lowered) sets one up', res.trailCamera?.after.trailCams === res.trailCamera?.before.trailCams - 1, res.trailCamera);
check('audio lure: slot + Q sets it calling', res.audioLure?.after.lures === res.audioLure?.before.lures - 1 && res.audioLure.after.luresPlaced === 1, res.audioLure);
await shot('03-night-vision-on');
check('night vision: slot + Q turns the goggles on', res.nightVision?.after.nvg === true, res.nightVision);
// Mouse wheel cycles slots.
await page.keyboard.press('Digit1');
await page.mouse.move(480, 300); await page.waitForTimeout(100); // the wheel needs the pointer over the page
await page.keyboard.press('Digit1');
// (slow headless frames can delay wheel events, so give each one time to land)
await page.mouse.wheel(0, 120); await page.waitForFunction(() => __game.loadout.active === 1, null, { timeout: 8000 }).catch(() => {});
const wheel1 = (await effects()).active;
await page.mouse.wheel(0, -120); await page.waitForFunction(() => __game.loadout.active === 0, null, { timeout: 8000 }).catch(() => {});
await page.mouse.wheel(0, -120); await page.waitForFunction(() => __game.loadout.active === 3, null, { timeout: 8000 }).catch(() => {});
const wheel2 = (await effects()).active;
check('mouse wheel switches slots', wheel1 === order[1] && wheel2 === order[3], { wheel1, wheel2, order });
// Gear left at camp can't be used: R (spare battery) does nothing, K (knock stick) does nothing.
await page.evaluate(() => { __game.flashlight.battery = 0.2; });
const b0 = await effects();
await page.keyboard.press('KeyR'); await page.keyboard.press('KeyK');
await page.waitForTimeout(200);
const b1 = await effects();
check('items left at camp are not carried and their keys do nothing', b0.spares === 0 && b1.battery <= 0.2 && b1.knocks === b0.knocks, { before: b0, after: b1 });

// Hunt 2: pack the knock stick and spare battery too.
await load();
await pick('Bait'); await pick('Audio lure'); await pick('Knock stick'); await pick('Spare battery');
const order2 = await slots();
await begin();
await page.waitForTimeout(300);
const res2 = {};
for (let i = 0; i < order2.length; i++) {
  if (order2[i] === 'spareBatteries') await page.evaluate(() => { __game.flashlight.battery = 0.1; });
  res2[order2[i]] = await useSlot(i + 1);
}
await shot('04-second-loadout');
check('knock stick: slot + Q knocks on a tree', res2.knockStick?.after.knocks === res2.knockStick?.before.knocks + 1, res2.knockStick);
check('spare battery: slot + Q swaps in a fresh battery', res2.spareBatteries?.after.battery >= 0.9 && res2.spareBatteries.after.spares === res2.spareBatteries.before.spares - 1, res2.spareBatteries);
const used = new Set([...Object.keys(res), ...Object.keys(res2)]);
check('every item you own can be equipped and used', owned.filter((k) => k !== 'camera' && k !== 'flashlight').every((k) => used.has(k)), { owned, used: [...used] });
// Hotkey of a packed item still works and selects its slot.
const hk0 = await effects();
await page.keyboard.press('KeyR'); await page.waitForTimeout(150);
const hk1 = await effects();
check('a packed item\'s own hotkey still works and selects its slot', hk1.active === 'spareBatteries', { before: hk0.active, after: hk1.active });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
