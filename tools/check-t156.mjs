// Final commitment prompt and canonical disappearance check (#156, GDD 9.1 / 11.2). Run: npm run check:t156 [outDir]
// On the G09 fixture: the explicit warning at the stones; turning back and leaving = ordinary extraction (recorded,
// case open); going on, then the authored end = the disappearance recorded on the career (complete, no payout,
// not a death); an ordinary death after committing stays an ordinary death.
// Three fresh loads of ?map=g09: (1) crossing, finite base, early withdrawal = ordinary extraction;
// (2) commitment, the changed return (landmarks, mimicry, truthful map), the authored end and the
// cut to black; (3) an ordinary death after commitment stays ordinary. Captures along the way.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || '.ballast/media/t156';
mkdirSync(out, { recursive: true });
const PORT = 4456;
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
const r1 = await page.evaluate(() => window.__gym.run());
record(r1, '(trip)');
await load();
await page.evaluate(() => { const g = __game; g.input.locked = true; g.overlay.classList.add('hidden'); if (g.hunt.stage === 'briefing') g.hunt.start();
  const s = g.map.landmarks.site; g.player.position.set(s.x, 0, s.z + 3); g.player.yaw = 0; g.gymHarness.world.commitStep(); g.renderer.render(g.scene, g.camera); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-the-final-commitment-prompt.png` });
await page.evaluate(() => __game.gymHarness.world.declineCommit());
const r2 = await page.evaluate(() => window.__gym.runCommitted());
const careerRecord = await page.evaluate(() => __game.camp.state.finale);
writeFileSync(`${out}/career-record-after-disappearance.json`, JSON.stringify(careerRecord, null, 1));
record(r2, '(committed)');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/02-cut-to-black-the-disappearance.png` });
await page.evaluate(() => { document.getElementById('g09-black').style.opacity = '0'; document.getElementById('g09-black').style.transition = 'none'; });
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
