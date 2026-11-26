// Gym G00 check (#77, GDD 15.2 / 13.2 / 14.2): render and pixel settings must not change AI or
// evidence. Runs the G00 bench script (src/gym/g00.js) with the same seed under different render
// settings, each in a fresh page (fixture reset), and asserts identical AI detection records and
// evidence results. Run: npm run build && node tools/check-t77.mjs [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t77';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4377', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// Variants: the pixel pipeline as shipped, pixel pipeline OFF (full-resolution, no view snapping),
// a much coarser pixel grid, a different window shape, and display settings (brightness, FOV is
// gameplay so it stays fixed; reduced shake is presentation).
const VARIANTS = [
  { id: 'pixel-on', q: '', view: [960, 540] },
  { id: 'pixel-on-repeat', q: '', view: [960, 540] },
  { id: 'pixel-off', q: '&scale=1&nosnap', view: [960, 540] },
  { id: 'pixel-coarse', q: '&rows=120', view: [960, 540] },
  { id: 'window-4x3', q: '', view: [800, 600] },
  { id: 'display-settings', q: '', view: [960, 540], settings: { brightness: 1.6, reducedShake: true } },
];
const runs = {};
for (const v of VARIANTS) {
  const page = await browser.newPage({ viewport: { width: v.view[0], height: v.view[1] } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:4377/?map=gym&seed=77&simpaused&nodebugai${v.q}`);
  await page.waitForFunction(() => window.__game && window.__gym, null, { timeout: 180000 });
  if (v.settings) await page.evaluate((s) => __game.settings.set(s), v.settings);
  const t0 = Date.now();
  const r = await page.evaluate(() => {
    const out = __gym.run();
    const px = __game.pixels;
    return { ...out, render: { w: px.width, h: px.height, scale: px.scale, snap: px.snap } };
  });
  r.seconds = Math.round((Date.now() - t0) / 1000);
  r.errors = errors;
  runs[v.id] = r;
  writeFileSync(`${out}/record-${v.id}.json`, JSON.stringify(r.record, null, 1));
  await page.evaluate(() => { const g = __game; g.player.position.set(0, 0, 9); g.player.yaw = 0; g.player.pitch = 0.05; g.sim.frame(1 / 30); });
  await page.screenshot({ path: `${out}/${v.id}.png`, timeout: 150000 });
  await page.close();
}
const base = runs['pixel-on'];
const summary = (r) => ({ digest: r.digest, render: r.render, perceptionChanges: r.record.perception.length, events: r.record.events.length,
  photos: r.record.photos.map((p) => `${p.result} ${p.subject ?? ''} ${p.score ?? ''}`.trim()), journal: r.record.journal.length, seconds: r.seconds });
check('the bench exercises AI and evidence (perception changes, photos and a journal entry)', base.record.perception.length > 5 && base.record.photos.length === 3 && base.record.journal.length >= 1, summary(base));
check('fixture reset + fixed seed: the same settings give an identical record', runs['pixel-on-repeat'].digest === base.digest, summary(runs['pixel-on-repeat']));
const firstDiff = (a, b) => {
  for (const k of Object.keys(a.record)) {
    const x = JSON.stringify(a.record[k]), y = JSON.stringify(b.record[k]);
    if (x !== y) { let i = 0; while (x[i] === y[i]) i++; return { section: k, at: i, a: x.slice(Math.max(0, i - 60), i + 80), b: y.slice(Math.max(0, i - 60), i + 80) }; }
  }
  return null;
};
for (const id of ['pixel-off', 'pixel-coarse', 'window-4x3', 'display-settings']) {
  const r = runs[id];
  check(`${id}: identical AI detection and evidence to pixel-on`, r.digest === base.digest, r.digest === base.digest ? summary(r) : { ...summary(r), diff: firstDiff(base, r) });
}
check('no page errors in any run', Object.values(runs).every((r) => !r.errors.length), Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.errors])));
console.log(results.join('\n'));
await browser.close();
server.kill();
