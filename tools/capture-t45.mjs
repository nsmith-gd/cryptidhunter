// Base-camp bounty board captures (#45): a fresh save, then after selling a 72-score Bigfoot photo.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || '.ballast/media/t45';
const server = spawn('npx', ['vite', 'preview', '--port', '4335', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4335/?nodebugai');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__game && document.getElementById('bounty-panel'));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-base-camp-bounty-board.png` });
// Bring home a good Bigfoot photo, then come back to camp.
const sale = await page.evaluate(() => __game.camp.settleHunt({ outcome: 'complete', photos: [{ subject: 'Bigfoot', score: 72 }], gearLeft: {}, target: 'Bigfoot' }));
await page.reload();
await page.waitForFunction(() => window.__game && document.getElementById('bounty-panel'));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/02-after-selling-bigfoot-72.png` });
const text = await page.evaluate(() => document.getElementById('bounty-panel').innerText);
console.log(JSON.stringify({ earned: sale.earned, bounties: sale.bounties.map((b) => b.id), errors }));
console.log(text);
await browser.close(); server.kill();
