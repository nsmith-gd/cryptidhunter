// Story text cards in the browser. Run: npm run check:t16 [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t16';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4386', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const card = () => page.evaluate(() => ({ open: __game.textCard.open?.id ?? null, title: document.getElementById('text-card').innerText.split('\n')[0] }));

await page.goto('http://localhost:4386/?cards');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__game);
await page.waitForTimeout(300);
const intro = await card();
check('a new game opens on the intro card', intro.open === 'intro', intro);
await page.screenshot({ path: `${out}/01-intro-card.png` });
await page.waitForTimeout(600);
await page.keyboard.press('Space');
await page.waitForTimeout(200);
check('any key dismisses it, revealing the briefing', (await card()).open === null, await card());
await page.screenshot({ path: `${out}/02-after-intro-briefing.png` });

// Reputation below max: no outro. At max: outro once.
await page.evaluate(() => __game.reputation.set(60));
check('no outro below max reputation', (await card()).open === null, await page.evaluate(() => __game.reputation.value));
await page.keyboard.press('F8');
await page.waitForTimeout(200);
const outro = await card();
check('max reputation shows the finale card', outro.open === 'outro', outro);
await page.screenshot({ path: `${out}/03-outro-card.png` });
await page.waitForTimeout(600);
await page.mouse.click(480, 270);
await page.evaluate(() => { __game.reputation.set(10); __game.reputation.set(__game.reputation.max); });
await page.waitForTimeout(200);
check('the finale shows only once', (await card()).open === null, await card());

// A returning player (has hunt history) gets no intro.
await page.evaluate(() => { __game.camp.state.hunts.push({ outcome: 'complete', earned: 10, sold: [] }); __game.camp.state.money = 10; __game.camp.save(); });
await page.reload();
await page.waitForFunction(() => window.__game);
await page.waitForTimeout(300);
check('a returning game shows no intro', (await card()).open === null, await card());

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
