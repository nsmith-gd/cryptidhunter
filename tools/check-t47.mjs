// Map / target selection check. Run: npm run check:t47 [outDir]
// Fresh camp: the swamp is locked (reputation 2 needed). Pick the forest, bring home Bigfoot
// photos until reputation reaches 2, and the swamp unlocks; picking it loads the swamp with
// Mothman as the target. Real clicks on the start screen; real camera buttons for the photos.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t47';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4367', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const BASE = 'http://localhost:4367/';

const ready = () => page.waitForFunction(() => window.__game, null, { timeout: 180000 });
const picker = () => page.evaluate(() => ({
  map: __game.mapId, target: __game.hunt.target, rep: __game.camp.state.reputation ?? 0,
  swampLocked: document.querySelector('#map-picker button[data-id="swamp"]')?.disabled ?? null,
  text: document.querySelector('#map-picker')?.textContent.replace(/\s+/g, ' ').trim(),
}));
// Bring home a photo of Bigfoot: hold it still in a clearing, snap with the camera, drive home with H.
const huntOnce = async () => {
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
    if (g.huntFailure) g.huntFailure.enabled = false;
    const b = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'); b.update = () => {};
    const L = g.map.landmarks, p = g.player;
    p.position.set(L.campsite.x, 0, L.campsite.z + 6); p.velocity.set(0, 0, 0);
    b.agent.x = L.campsite.x; b.agent.z = L.campsite.z - 8; b.syncMesh?.();
    p.yaw = 0; p.pitch = Math.atan2(1.8 - 1.68, 14); g.fear.value = 0;
  });
  await page.waitForTimeout(400);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => __game.photo.raised, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(400);
  await page.mouse.up({ button: 'right' });
  const photos = await page.evaluate(() => __game.hunt.photos.map((p) => p.score));
  await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); });
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH');   // #98: manifest review, then drive out
  await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 20000 });
  return { photos, rep: await page.evaluate(() => __game.camp.state.reputation) };
};

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE); await ready();
const fresh = await picker();
await shot('01-start-swamp-locked');
check('fresh camp: forest open, swamp locked behind reputation 2', fresh.rep === 0 && fresh.swampLocked === true && /needs reputation 2/.test(fresh.text), fresh);
await page.click('#map-picker button[data-id="swamp"]', { force: true });
await page.waitForTimeout(800);
const stillHere = await picker();
check('clicking the locked swamp does nothing', stillHere.map === fresh.map, stillHere);

await page.click('#map-picker button[data-id="forest"]');
await page.waitForURL(BASE, { timeout: 30000 }).catch(() => {});
await ready();
const forest = await picker();
check('picking the forest loads Pine Hollow with Bigfoot as the target (and remembers it)', forest.map === 'forest' && forest.target === 'Bigfoot', forest);

const hunts = [];
for (let i = 0; i < 3 && (await page.evaluate(() => __game.camp.state.reputation ?? 0)) < 2; i++) {
  hunts.push(await huntOnce());
  await page.goto(BASE); await ready();               // back to the start screen for the next hunt
}
const unlocked = await picker();
await shot('02-start-swamp-unlocked');
check('bringing home Bigfoot photos earns reputation and unlocks the swamp', unlocked.rep >= 2 && unlocked.swampLocked === false && unlocked.map === 'forest', { hunts, unlocked });

await page.click('#map-picker button[data-id="swamp"]');
await page.waitForTimeout(1500);
await ready();
const swamp = await picker();
await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); });
await page.waitForTimeout(800);
await shot('03-swamp-hunt-mothman');
check('picking the unlocked swamp loads Blackwater Swamp hunting Mothman', swamp.map === 'swamp' && swamp.target === 'Mothman', swamp);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
