// Equipment condition and repair check (#106). Run: npm run build && node tools/check-t106.mjs [outDir]
// Take a photo, wade into the creek with the camera raised (it dips into the water), drive home;
// at base camp the camera shows its condition, its resale value has dropped, its night photos are
// less clear, and the photo on its card is still readable. Repair it at HQ for one ledger charge.
// A field repair kit (5 uses) patches damage out in the field.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t106';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4406', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async () => {
  await page.goto('http://localhost:4406/?map=forest&nodebugai&simpaused');
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
};
const panel = () => page.evaluate(() => {
  const q = __game.equipment.quote('camera');
  return { condition: +q.condition.toFixed(3), resale: q.resaleCents, repair: q.repairCents, text: document.getElementById('equipment-panel')?.innerText ?? '' };
});

await page.goto('http://localhost:4406/'); await page.evaluate(() => localStorage.clear());
await load();
const fresh = await panel();
check('a new career: the camera is an owned item at 100%, resale $30 (50% of its $60 list)', fresh.condition === 1 && fresh.resale === 3000 && /Used compact camera/.test(fresh.text), fresh);

// Field: start, take a photo, then wade into the creek with the camera raised.
const field = await page.evaluate(() => {
  const g = __game, p = g.player;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  g.cryptids.update = () => {};
  p.position.set(0, 0, 60); p.yaw = 0;
  g.photo.wantRaised = true; for (let i = 0; i < 40; i++) g.sim.frame(1 / 30);
  g.photo.snap?.();
  const photosBefore = g.photo.log.length;
  g.photo.wantRaised = false; for (let i = 0; i < 10; i++) g.sim.frame(1 / 30);
  // Find a creek spot (shallow water) and stand in it with the camera up.
  let spot = null;
  for (let x = -100; x <= 100 && !spot; x += 2) for (let z = -30; z <= 40; z += 1) if (g.map.surfaceAt(x, z, 0) === 'shallow') { spot = { x, z }; break; }
  p.position.set(spot.x, 0, spot.z);
  g.photo.wantRaised = true;
  for (let i = 0; i < 30; i++) g.sim.frame(1 / 30);
  g.photo.wantRaised = false;
  for (let i = 0; i < 10; i++) g.sim.frame(1 / 30);
  return { spot, photosBefore, photosAfter: g.photo.log.length, camera: +g.equipment.condition('camera').toFixed(3), clarity: +g.photo.clarity.toFixed(3),
    wet: !!g.equipment.wet.camera, causes: [...new Set(g.equipment.log.map((l) => `${l.item}:${l.cause}`))] };
});
check('wading with the camera raised dips it into the water: condition drops, it is wet', field.camera < 0.7 && field.wet && field.causes.includes('camera:water'), field);
check('the damaged camera keeps its readable photos', field.photosBefore >= 1 && field.photosAfter === field.photosBefore, field);
check('condition changes capability only: night photo clarity is reduced', field.clarity < 0.85, field);
await page.screenshot({ path: `${out}/01-field-camera-dipped.png`, timeout: 120000 });

// Drive home and come back to camp.
await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.hunt.update(0); g.hunt.end('complete'); });
await load();
const home = await panel();
check('back at camp the camera shows its condition, and its resale has dropped with it', home.condition < 0.7 && home.resale < fresh.resale && home.resale === Math.floor(6000 * 0.5 * home.condition) && /\d+%/.test(home.text), home);
await page.evaluate(() => document.getElementById('equipment-panel')?.scrollIntoView({ block: 'center' }));
await page.screenshot({ path: `${out}/02-camp-camera-damaged.png`, timeout: 120000 });

// HQ repair: one ledger charge of ceil(0.35 x list x restored).
const repair = await page.evaluate(() => {
  const g = __game, L = g.camp.ledger, cash0 = L.cash, q = g.equipment.quote('camera');
  const repairsBefore = L.tx.filter((t) => t.kind === 'repair').length;
  document.querySelector('#equipment-panel button[data-repair="camera"]').click();
  return { cash0, cash1: L.cash, quoted: q.repairCents, expected: Math.ceil(0.35 * 6000 * (1 - q.condition)), condition: g.equipment.condition('camera'),
    charges: L.tx.filter((t) => t.kind === 'repair').length - repairsBefore, resaleAfter: g.equipment.quote('camera').resaleCents };
});
check('HQ repair: one ledger charge of ceil(0.35 x list x restored), camera back to 100%', repair.charges === 1 && repair.cash0 - repair.cash1 === repair.expected && repair.quoted === repair.expected && repair.condition === 1, repair);
check('no repair-then-sell profit: resale after repair rises by less than the repair cost', repair.resaleAfter - home.resale <= repair.expected, { before: home.resale, after: repair.resaleAfter, cost: repair.expected });
await page.screenshot({ path: `${out}/03-camp-camera-repaired.png`, timeout: 120000 });

// Field repair kit: buy one, slot it, patch a damaged torch in the field.
const kit = await page.evaluate(() => {
  const g = __game;
  document.querySelector('#equipment-panel button[data-buykit]').click();
  const owned = g.camp.state.gear.repairKit;
  g.equipment.wear('flashlight', 0.5, 'impact');
  g.loadout.owned.repairKit = owned; g.loadout.setSlots(['repairKit', 'bait']);
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  const before = g.equipment.condition('flashlight');
  g.loadout.select(0); const ok = g.loadout.use();
  return { owned, ok, before, after: g.equipment.condition('flashlight'), usesLeft: g.gear?.repairKit?.uses ?? g.loadout.gear.repairKit.uses };
});
check('field repair kit (5 uses): slotted and used, it patches the worst item (+25%, max 75%)', kit.owned === 5 && kit.ok && Math.abs(kit.after - Math.min(0.75, kit.before + 0.25)) < 1e-6 && kit.usesLeft === 4, kit);
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
