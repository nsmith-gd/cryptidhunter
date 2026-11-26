// Film roll + photo album check. Run: npm run check:t51 [outDir]
// Shoot the whole roll (mix of Bigfoot shots and empty frames) with the real camera buttons;
// once film runs out the shutter won't fire. Drive home: the results screen's album shows every
// shot as a thumbnail. Then a caught hunt: its album is stamped LOST.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t51';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4371', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

const open = async () => {
  await page.goto('http://localhost:4371/?nodebugai');
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
    if (g.huntFailure) g.huntFailure.enabled = false;
    const b = g.cryptids.cryptids[0]; b.update = () => {}; b.agent.x = 20; b.agent.z = 20; b.syncMesh?.();
    g.fear.update = () => {}; g.fear.value = 0;
  });
  await page.mouse.move(480, 300); await page.waitForTimeout(200);
};
// Aim at Bigfoot (or away from it) from 14 m south.
const aim = (atIt) => page.evaluate((atIt) => {
  const g = __game, p = g.player, b = g.cryptids.cryptids[0];
  p.position.set(20, 0, 34); p.velocity.set(0, 0, 0);
  p.yaw = atIt ? 0 : Math.PI; p.pitch = Math.atan2(b.profile.height * 0.5 - 1.68, 14);
}, atIt);
const click = async () => {
  await page.waitForFunction(() => __game.photo.cooldown === 0, null, { timeout: 30000 });
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(250);
};

// ---- Hunt 1: the whole roll, then drive home ----
await open();
const roll = await page.evaluate(() => ({ film: __game.photo.film, total: __game.photo.filmTotal }));
await page.mouse.down({ button: 'right' });
await page.waitForFunction(() => __game.photo.raised, null, { timeout: 30000 });
for (let i = 0; i < roll.total; i++) {
  await aim(i % 3 !== 2);                          // every third frame is an empty view
  await page.waitForTimeout(150);
  await click();
  if (i === 0) await shot('01-viewfinder-film-counter');
}
const afterRoll = await page.evaluate(() => ({ film: __game.photo.film, shots: __game.photo.log.length,
  counter: document.querySelector('#viewfinder .vf-film')?.textContent }));
await aim(true);
await click();
await click();
const empty = await page.evaluate(() => ({ film: __game.photo.film, shots: __game.photo.log.length, label: document.querySelector('#photo-label').textContent }));
await shot('02-out-of-film');
await page.mouse.up({ button: 'right' });
check(`the roll holds ${roll.total} shots and the counter counts down`, afterRoll.shots === roll.total && afterRoll.film === 0 && afterRoll.counter === `film 0/${roll.total}`, { roll, afterRoll });
check("once film runs out you can't shoot", empty.shots === roll.total && empty.film === 0 && /Out of film/.test(empty.label), empty);

await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); });
await page.waitForTimeout(400);
await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH');   // #98: manifest review, then drive out
await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 30000 });
await page.waitForTimeout(500);
const album = await page.evaluate(() => {
  const a = document.querySelector('#photo-album');
  const cards = [...(a?.querySelectorAll('.card') ?? [])];
  return { visible: !!a && getComputedStyle(__game.hunt.screen).display !== 'none', title: a?.querySelector('h3')?.textContent,
    cards: cards.length, withImages: cards.filter((c) => c.querySelector('img')?.src.startsWith('data:image/')).length,
    hits: cards.filter((c) => c.classList.contains('hit')).length, misses: cards.filter((c) => c.classList.contains('miss')).length,
    best: cards.filter((c) => c.classList.contains('best')).length };
});
await page.evaluate(() => document.querySelector('#photo-album')?.scrollIntoView());
await shot('03-album-after-driving-home');
check('every shot appears in the end-of-hunt album as a thumbnail', album.visible && album.cards === roll.total && album.withImages === roll.total, album);
check('album marks hits, misses and the best photo', album.hits === 8 && album.misses === 4 && album.best === 1, album);

// ---- Hunt 2: two shots, then caught -> album stamped LOST ----
await open();
await page.mouse.down({ button: 'right' });
await page.waitForFunction(() => __game.photo.raised, null, { timeout: 30000 });
await aim(true); await click(); await click();
await page.mouse.up({ button: 'right' });
await page.evaluate(() => { __game.huntFailure.enabled = true; __game.huntFailure.caught('Bigfoot'); });
await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 30000 });
await page.waitForTimeout(500);
const lost = await page.evaluate(() => {
  const a = __game.huntFailure.screen.querySelector('#photo-album');
  return { cards: a?.querySelectorAll('.card').length ?? 0, lost: a?.classList.contains('lost'), title: a?.querySelector('h3')?.textContent };
});
await shot('04-caught-album-lost');
check('caught: the album shows the shots, stamped LOST', lost.cards === 2 && lost.lost && /LOST/.test(lost.title), lost);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
