// Renders the style-guide boards into docs/style/ (and the task captures folder).
// Run: node tools/capture-t33.mjs   (starts its own vite dev server)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';

const outs = ['docs/style', process.argv[2] || '.ballast/media/t33'];
outs.forEach((o) => mkdirSync(o, { recursive: true }));
const server = spawn('npx', ['vite', '--port', '4373', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shots = [
  ['palette', 'board=palette'], ['texture-set', 'board=textures'],
  ['mockup-trail-moonlight', 'board=diorama&view=0'], ['mockup-boulder-torch', 'board=diorama&view=1'], ['mockup-lantern-low', 'board=diorama&view=2'],
];
for (const [name, query] of shots) {
  await page.goto(`http://localhost:4373/tools/styleboard/index.html?${query}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outs[0]}/${name}.png` });
  copyFileSync(`${outs[0]}/${name}.png`, `${outs[1]}/${name}.png`);
}
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'boards rendered');
await browser.close();
server.kill();
