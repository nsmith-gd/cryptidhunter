// Failure consequences check. Run: npm run check:t26 [outDir]
// Hunt 1: photograph Bigfoot, pocket a spare battery, then get caught -> the photo is lost,
// base camp shows no new earnings, and the extra battery comes home with you.
// Hunt 2: photograph Bigfoot and drive home from the van -> base camp shows the earnings.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t26';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4356', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

const load = async () => {
  await page.goto('http://localhost:4356/');
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(300);
  return page.evaluate(() => ({
    panel: document.querySelector('#camp-panel')?.textContent ?? '',
    money: __game.camp.state.money, spares: __game.flashlight.spares, bait: __game.bait.carried,
  }));
};
const begin = () => page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  g.aiDebug?.setVisible(false);
  g.cryptids.cryptids[0].update = () => {}; // hold Bigfoot still for the photo
});
// Photograph Bigfoot from 18 m with the real camera buttons.
const photograph = async () => {
  await page.evaluate(() => {
    const g = __game, b = g.cryptids.cryptids[0], p = g.player;
    b.agent.x = 20; b.agent.z = 20; b.syncMesh?.();
    p.position.set(20, 0, 38); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = Math.atan2(1.3 - 1.68, 18);
    g.fear.value = 0;
  });
  await page.waitForTimeout(300);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => __game.photo.raised, null, { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(300);
  await page.mouse.up({ button: 'right' });
  return page.evaluate(() => __game.hunt.photos.map((p) => ({ subject: p.subject, score: p.score })));
};

await page.goto('http://localhost:4356/');
await page.evaluate(() => localStorage.clear());
const fresh = await load();
check('a fresh camp starts with $0 and the starter kit', fresh.money === 0 && /First night/.test(fresh.panel), fresh);

// ---- Hunt 1: photo, extra battery, caught ----
await begin();
const photos1 = await photograph();
await page.evaluate(() => __game.flashlight.addSpare()); // pocket a spare battery found in the woods
const carried = await page.evaluate(() => ({ spares: __game.flashlight.spares, bait: __game.bait.carried }));
await page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids[0], p = g.player;
  b.agent.x = p.position.x + 0.3; b.agent.z = p.position.z; b.syncMesh?.(); // it reaches you
  g.huntFailure.caught('Bigfoot');
});
await page.waitForTimeout(400);
const caught = await page.evaluate(() => ({ outcome: __game.hunt.outcome, text: __game.huntFailure.reason.textContent, money: __game.camp.state.money }));
await shot('01-caught-photos-lost');
check('caught after photographing Bigfoot: the photo is lost and earns nothing', photos1.length === 1 && photos1[0].score > 0
  && caught.outcome === 'caught' && /1 photo lost/.test(caught.text) && /no new earnings/.test(caught.text) && caught.money === 0, { photos1, caught });

const after1 = await load();
await shot('02-base-camp-after-caught');
check('base camp after being caught shows no new earnings', after1.money === 0 && /Caught — 1 photo lost: no new earnings \(\$0\)/.test(after1.panel), after1);
check('gear is kept: the extra battery you were carrying comes home', after1.spares === carried.spares && carried.spares === 2, { carried, nextHunt: after1 });

// ---- Hunt 2: photo, drive home from the van ----
await begin();
const photos2 = await photograph();
await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); });
await page.waitForTimeout(300);
await page.keyboard.press('KeyH');
await page.waitForTimeout(400);
const done = await page.evaluate(() => ({ outcome: __game.hunt.outcome, settlement: __game.hunt.settlement, screen: __game.hunt.endBody.textContent }));
await shot('03-hunt-complete-earnings');
check('driving home with the photo sells it', done.outcome === 'complete' && done.settlement?.money > 0 && /BASE CAMP/.test(done.screen), { photos2, done: { outcome: done.outcome, money: done.settlement?.money } });
const after2 = await load();
await shot('04-base-camp-after-success');
check('base camp then shows the new earnings', after2.money > 0 && /Made it out: \+\$\d+/.test(after2.panel), after2);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
