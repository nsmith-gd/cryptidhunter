// G09 finale rehearsal fixture check (#155, GDD 15.2 G09 / 11.2). Run: npm run check:t155 [outDir]
// Three fresh loads of ?map=g09: (1) crossing, finite base, early withdrawal = ordinary extraction;
// (2) commitment, the changed return (landmarks, mimicry, truthful map), the authored end and the
// cut to black; (3) an ordinary death after commitment stays ordinary. Captures along the way.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || '.ballast/media/t155';
mkdirSync(out, { recursive: true });
const PORT = 4455;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); };
const load = async () => { await page.goto(`http://localhost:${PORT}/?map=g09&simpaused`); await page.waitForFunction(() => window.__gym?.harness?.world, null, { timeout: 120000 }); };
const view = async (name, fn) => { await page.evaluate(fn); await page.evaluate(() => { const g = __game; g.renderer.render(g.scene, g.camera); g.gymHarness.render(); }); await page.waitForTimeout(800); await page.screenshot({ path: `${out}/${name}.png` }); };
const record = (r, tag) => { for (const c of r.criteria) check(`G09 ${tag} ${c.id}: ${c.text}`, c.status !== 'fail', { status: c.status, ...c.detail }); };

await load();
await view('01-from-the-trailhead-north-to-the-river', () => { const g = __game; document.querySelector('#overlay').style.visibility = 'hidden'; g.camera.position.set(0, 1.7, 30); g.camera.lookAt(0, 1, 0); });
await page.evaluate(() => { document.querySelector('#overlay').style.visibility = ''; });
const r1 = await page.evaluate(() => window.__gym.run());
record(r1, '(trip)');
await load();
await view('02-the-stones-final-site', () => { const g = __game; document.querySelector('#overlay').style.visibility = 'hidden'; g.camera.position.set(4, 2.2, -22); g.camera.lookAt(0, 1.5, -34); });
await page.evaluate(() => { document.querySelector('#overlay').style.visibility = ''; });
const r2 = await page.evaluate(() => window.__gym.runCommitted());
record(r2, '(committed)');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/04-cut-to-black-at-the-last-extraction.png` });
await page.evaluate(() => { document.getElementById('g09-black').style.opacity = '0'; document.getElementById('g09-black').style.transition = 'none'; });
await view('03-the-encounter-at-the-trailhead', () => { const g = __game; g.camera.position.set(0, 1.7, 36); g.camera.lookAt(0, 4, 39); });
writeFileSync(`${out}/run-committed.json`, JSON.stringify(r2, null, 1));
await load();
const r3 = await page.evaluate(() => window.__gym.runDeath());
record(r3, '(death)');
check('G09 loads from ?map=g09 with its fixed seed', r1.seed === 909, { seed: r1.seed });
check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 330)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
