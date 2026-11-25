// Automated check for the post-hunt money screen. Run: npm run check:t12 [outDir]
// Plays the loop twice: take a "photo" (score fed in the way the camera will), press H to end the
// hunt, read the money screen, click "Hunt again", and verify the second hunt's earnings add on.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t12';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4332', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const ready = async () => {
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => {
    const g = __game;
    // Keep the placeholders from ending the hunt early.
    if (g.chupacabra) g.chupacabra.update = () => {};
    g.huntFailure.enabled = false;
    g.overlay.classList.add('hidden');
  });
  await page.waitForTimeout(300);
};
const screen = () => page.evaluate(() => ({
  visible: getComputedStyle(document.getElementById('hunt-end')).display !== 'none',
  text: document.getElementById('hunt-end').innerText.replace(/\s+/g, ' ').trim(),
  money: __game.wallet.money, hunts: __game.wallet.hunts,
}));

await page.goto('http://localhost:4332/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await ready();

// Hunt 1: two photos come in (best counts), via the camera's event.
await page.evaluate(() => {
  dispatchEvent(new CustomEvent('cryptid-photo', { detail: { score: 41, subject: 'Bigfoot' } }));
  dispatchEvent(new CustomEvent('cryptid-photo', { detail: { score: 72, subject: 'Bigfoot' } }));
});
await page.keyboard.press('h');
await page.waitForTimeout(300);
const hunt1 = await screen();
check('H ends the hunt and shows the money screen', hunt1.visible && /Hunt again/.test(hunt1.text), hunt1.text);
check('best photo (72) pays $360', hunt1.money === 360 && /\$360/.test(hunt1.text), hunt1);
await shot('01-hunt-1-earnings');

// Hunt again.
await page.waitForTimeout(700);
await page.click('#hunt-end button');
await page.waitForLoadState('load');
await ready();
const fresh = await screen();
check('"Hunt again" starts a fresh hunt with money kept', !fresh.visible && fresh.money === 360, fresh);
await shot('02-hunt-2-started');

// Hunt 2: no photo, so the stand-in sighting score pays. Look straight at Bigfoot from ~12 m.
await page.evaluate(() => {
  const g = __game, bf = g.cryptids.cryptids[0];
  g.cryptids.update = () => {};   // hold it still for the look
  const p = g.player, x = bf.agent.x, z = bf.agent.z + 12;
  p.position.set(x, 0, z); p.yaw = 0; p.pitch = 0;
});
await page.waitForTimeout(500);
const sight = await page.evaluate(() => __game.huntEnd.best);
check('looking at a cryptid gives a sighting score when no photo was taken', sight.score > 30 && sight.subject === 'Bigfoot', sight);
await page.keyboard.press('h');
await page.waitForTimeout(300);
const hunt2 = await screen();
const expected = 360 + sight.score * 5;
check('second hunt earnings add to the total', hunt2.money === expected && hunt2.hunts === 2 && hunt2.text.includes(`Total $${expected}`), { hunt2, expected });
await shot('03-hunt-2-total');

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
