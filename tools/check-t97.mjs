// Ledger in game (#97). Run: npm run check:t97 [outDir]
// A new career opens with $250 in the integer-cent ledger. Base camp and the shop show the ledger's
// cash, and a purchase posts one transaction. A hunt you drive home from is settled once under its
// attempt ID; replaying the settlement pays nothing, and the money survives a reload.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t97';
mkdirSync(out, { recursive: true });
const PORT = 4397;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const URL = `http://localhost:${PORT}/?map=forest&seed=97&nodebugai&simpaused`;
const load = async () => { await page.goto(URL); await page.waitForFunction(() => window.__game && document.getElementById('shop-panel'), null, { timeout: 180000 }); };
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const view = () => page.evaluate(() => {
  const g = __game, l = g.camp.ledger;
  return { money: g.camp.state.money, cents: l.cash, tx: l.tx.map((t) => `${t.id} ${t.cents}`), audit: l.audit().ok,
    camp: document.getElementById('camp-panel')?.innerText.split('\n')[0], shop: document.getElementById('shop-panel')?.innerText.split('\n')[0] };
});

await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await load();
const v0 = await view();
check('a new career opens the ledger with $250 (25000 cents), shown at base camp and in the shop',
  v0.cents === 25000 && v0.money === 250 && /\$250$/.test(v0.camp) && /\$250 to spend/.test(v0.shop) && v0.tx.length === 1, v0);

await page.click('#shop-panel button[data-kind="gear"][data-key="bait"]');
const v1 = await view();
check('buying bait in the shop posts one $15 charge and both panels show the ledger balance',
  v1.cents === 23500 && v1.tx.includes('buy:bait:1 -1500') && /\$235$/.test(v1.camp) && /\$235 to spend/.test(v1.shop), v1);
await page.screenshot({ path: `${out}/01-camp-and-shop-read-the-ledger.png` });

// Hunt: shoot nothing, drive home with a planted Bigfoot photo so there is something to sell.
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  for (const c of g.cryptids.cryptids) { c.update = () => {}; c.agent.x = 140; c.agent.z = -140; }
  g.hunt.photos.push({ subject: 'Bigfoot', score: 60 });
  const e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0);
});
await steps(25 * 60);
await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH');   // #98: manifest review, then drive out
await steps(2);
const v2 = await page.evaluate(() => {
  const g = __game, l = g.camp.ledger, h = g.camp.lastHunt;
  const before = l.cash, again = l.settleAttempt(h.attemptId, { records: [{ id: `photo:${h.attemptId}:Bigfoot`, cents: 99999 }] });
  return { outcome: g.hunt.outcome, attemptId: h.attemptId, earned: h.earned, settledCents: h.settledCents, cents: l.cash,
    replay: { duplicate: again.duplicate, changed: l.cash !== before }, payTx: l.tx.filter((t) => t.attemptId === h.attemptId).map((t) => `${t.id} ${t.cents}`), audit: l.audit().ok };
});
check('driving home settles the hunt once under its attempt ID, in cents matching what the screen says',
  ['complete', 'abandoned'].includes(v2.outcome) && v2.earned > 0 && v2.settledCents === v2.earned * 100 && v2.cents === 23500 + v2.earned * 100 && v2.payTx.length > 0, v2);
check('settling the same attempt again pays nothing', v2.replay.duplicate === true && v2.replay.changed === false && v2.audit, v2.replay);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-results-settled.png` });

await load();
const v3 = await view();
check('after a reload base camp shows the same ledger balance', v3.cents === v2.cents && v3.audit && v3.camp.includes(`$${v2.cents / 100}`), v3);
await page.screenshot({ path: `${out}/03-base-camp-after-reload.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
