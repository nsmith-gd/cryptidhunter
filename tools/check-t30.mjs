// Night timer and dawn. Run: npm run check:t30 [outDir]
// 15-minute night; at dawn the cryptid leaves and the before-dawn bonus is gone; the hunt only
// ends when you drive home from the van (H), never by the clock alone.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t30';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4387', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

const fresh = async () => {
  await page.goto('http://localhost:4387/?nodebugai');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false; g.hunt.start(); });
};
const st = () => page.evaluate(() => {
  const h = __game.hunt;
  return { stage: h.stage, outcome: h.outcome, dawned: h.dawned, clock: h.clock.textContent, hud: h.hud.textContent.split('\n')[0],
    cryptids: __game.cryptids.cryptids.length, leaving: __game.cryptids.cryptids.map((c) => c.state) };
});
// Take a scored photo of Bigfoot (as the camera would report it), then drive home from the van.
const photoAndLeave = () => page.evaluate(() => {
  const g = __game;
  g.hunt.onPhoto({ subject: 'Bigfoot', distance: 20, score: 80, source: 'handheld camera' });
  g.player.position.set(g.HUNT.exit.x, 0, g.HUNT.exit.z); g.player.velocity.set(0, 0, 0);
});

// ---- 1) Clock: 15 minutes, shown in game time ----
await fresh();
await page.waitForTimeout(400);
const s0 = await st();
check('the night clock starts at 11 PM with 15 minutes to dawn', /11:0\d PM/.test(s0.clock) && /dawn in 1[45]:\d\d/.test(s0.clock), s0);
await page.screenshot({ path: `${out}/01-night-clock.png` });
await page.evaluate(() => { __game.hunt.elapsed = 14 * 60; });
await page.waitForTimeout(300);
const late = await st();
check('the last minute warns in amber', /dawn in 0:5\d/.test(late.clock), late);
await page.screenshot({ path: `${out}/02-last-minute.png` });

// ---- 2) Leave before dawn: bonus ----
await photoAndLeave();
await page.waitForTimeout(200);
await page.keyboard.press('KeyH');
await page.waitForTimeout(300);
const early = await page.evaluate(() => ({ outcome: __game.hunt.outcome, last: __game.camp.lastHunt }));
check('driving home before dawn pays the photo plus the +25% bonus', early.outcome === 'complete' && early.last.bonus > 0
  && early.last.earned === early.last.sold.reduce((a, s) => a + s.value, 0) + early.last.bonus
  && early.last.bonus === Math.round(early.last.sold.reduce((a, s) => a + s.value, 0) * 0.25), early.last);
await page.screenshot({ path: `${out}/03-home-before-dawn-results.png` });

// ---- 3) Dawn: doesn't end the hunt; Bigfoot leaves; no bonus after ----
await fresh();
await page.evaluate(() => { __game.hunt.elapsed = 15 * 60 - 0.5; });
await page.waitForTimeout(1200);
const d = await st();
check('dawn does not end the hunt by itself', d.dawned && d.outcome === null && d.stage === 'search', d);
check('at dawn Bigfoot bolts for cover', d.leaving.every((s) => s === 'flee'), d);
await page.screenshot({ path: `${out}/04-dawn.png` });
await page.waitForFunction(() => __game.cryptids.cryptids.length === 0, null, { timeout: 30000 }).catch(() => {});
check('…and is gone from the area shortly after', (await st()).cryptids === 0, await st());
await page.waitForTimeout(1500);
check('the hunt is still waiting for you to leave', (await st()).outcome === null, await st());
await photoAndLeave();
await page.waitForTimeout(200);
await page.keyboard.press('KeyH');
await page.waitForTimeout(300);
const lateHome = await page.evaluate(() => ({ outcome: __game.hunt.outcome, last: __game.camp.lastHunt, body: __game.hunt.endBody.textContent }));
check('driving home after dawn pays the photo but no bonus', lateHome.outcome === 'complete' && lateHome.last.bonus === 0
  && lateHome.last.earned > 0 && /no before-dawn bonus/.test(lateHome.body), lateHome.last);
await page.screenshot({ path: `${out}/05-home-after-dawn-results.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
