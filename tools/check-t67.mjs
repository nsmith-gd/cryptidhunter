// Profiling recorder (#67): play ~2 minutes with recording on (walk, sprint, look around, take
// photos, log a clue, finish a hunt and sell), export from the F6 panel (real downloads), and
// validate summary.json, events.jsonl and manifest.json. Run: npm run check:t67 [outDir] [--short]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.ballast/media/t67';
const PLAY_MS = process.argv.includes('--short') ? 20000 : 120000;
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4337', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto('http://localhost:4337/?profile&nodebugai&seed=7');
await page.waitForFunction(() => window.__game?.profiler?.recording);
await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false; });

// Play: walk/sprint/turn in a loop, take photos now and then.
const keys = (down, codes) => page.evaluate(([d, c]) => c.forEach((k) => d ? __game.input.keys.add(k) : __game.input.keys.delete(k)), [down, codes]);
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < PLAY_MS) {
  const mode = i % 4;
  await keys(true, mode === 1 ? ['KeyW', 'ShiftLeft'] : mode === 3 ? ['KeyS'] : ['KeyW']);
  await page.evaluate((y) => { __game.player.yaw += y; }, 0.6);
  await page.waitForTimeout(2500);
  await keys(false, ['KeyW', 'ShiftLeft', 'KeyS']);
  if (i % 3 === 0) await page.evaluate((n) => { try { __game.photo.onPhoto?.({ subject: n % 2 ? 'Bigfoot' : null, score: 40 + (n % 5) * 8, distance: 20, visible: 4, samples: 6 }); } catch { /* HUD may reject a synthetic shot */ } }, i);
  i++;
}
// A photo, a clue and a completed hunt so evidence and economy events are present.
await page.evaluate(() => {
  const g = __game;
  g.photo.onPhoto({ subject: 'Bigfoot', score: 74, distance: 18, visible: 6, samples: 6, source: 'handheld camera' });
  const c = g.clues.clues[0]; if (c) g.journal.record(c);
  g.hunt.end('complete');
});
await page.waitForTimeout(500);
await page.evaluate(() => __game.profilerPanel.toggle(true));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/01-profiler-panel-after-2-minutes.png` });

// Export through the panel (a real click -> three downloads).
const downloads = [];
page.on('download', (d) => downloads.push(d));
await page.click('#profiler-panel button[data-a="export"]');
await page.waitForTimeout(1500);
const files = {};
for (const d of downloads) {
  const name = d.suggestedFilename(), path = `${out}/${name}`;
  await d.saveAs(path);
  const role = name.endsWith('.summary.json') ? 'summary.json' : name.endsWith('.events.jsonl') ? 'events.jsonl' : name.endsWith('.manifest.json') ? 'manifest.json' : name;
  files[role] = readFileSync(path, 'utf8');
}
const names = downloads.map((d) => d.suggestedFilename());
check('export downloads summary.json, events.jsonl and manifest.json with the contract name',
  names.length === 3 && names.every((n) => /^cryptozoology_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+\.(summary\.json|events\.jsonl|manifest\.json)$/.test(n)), names);

// Validate independently of the game code: every file parses, required fields, counts agree.
let summary = null, manifest = null, events = [];
try { summary = JSON.parse(files['summary.json']); } catch (e) { /* reported below */ }
try { manifest = JSON.parse(files['manifest.json']); } catch (e) { /* reported below */ }
let badLines = 0;
for (const l of (files['events.jsonl'] ?? '').split('\n').filter(Boolean)) { try { events.push(JSON.parse(l)); } catch { badLines++; } }
check('summary.json, manifest.json and every events.jsonl line are valid JSON', !!summary && !!manifest && badLines === 0, { badLines, events: events.length });
const fi = summary?.metrics?.frame_interval_ms;
check('summary has frame times with p95, and stalls over 100 ms counted', fi?.status === 'measured' && Number.isFinite(fi.p95) && fi.count > 100 && Number.isFinite(summary.metrics.stalls_over_100ms.count),
  { frames: fi?.count, p50: fi?.p50, p95: fi?.p95, max: fi?.max, stalls: summary?.metrics?.stalls_over_100ms });
check('recording covers about 2 minutes', summary?.capture?.duration_ms >= PLAY_MS * 0.95, { duration_ms: summary?.capture?.duration_ms });
const types = new Set(events.map((e) => e.type));
check('evidence and economy events were recorded', types.has('photo_taken') && types.has('evidence_sold') && types.has('hunt_started') && types.has('hunt_ended'), [...types]);
check('manifest lists the files and its event count matches events.jsonl', manifest?.files?.find((f) => f.role === 'events.jsonl')?.records === events.length && manifest?.run_id === summary?.run_id, { manifest: manifest?.files?.map((f) => [f.role, f.records]) });
check('unique event ids, each with t_ms and sim tick', new Set(events.map((e) => e.event_id)).size === events.length && events.every((e) => Number.isFinite(e.t_ms) && Number.isInteger(e.tick)), {});
const gameErrors = await page.evaluate(() => __game.profilerPanel.lastExport.errors);
check('the game\'s own validator agrees (no errors)', gameErrors.length === 0, gameErrors);
writeFileSync(`${out}/summary-excerpt.json`, JSON.stringify({ metrics: summary?.metrics, capture: summary?.capture, totals: summary?.totals }, null, 2));

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
