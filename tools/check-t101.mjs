// Research dossier check (#101). Run: npm run build && node tools/check-t101.mjs [outDir]
// Fresh career in Pine Hollow: the swamp is locked. Hunt 1 brings home only an ambiguous Bigfoot
// photo (grade 1): no milestone, no credibility, still locked. Hunt 2 brings home a usable photo
// (grade 2) and examined a huge footprint: Located +1 and Documented +2; after the successful
// extraction the swamp unlocks (and can be afforded). The journal shows the dossier.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t101';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4401', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async () => {
  await page.goto('http://localhost:4401/?map=forest&nodebugai&simpaused');
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
};
const picker = () => page.evaluate(() => {
  const el = document.getElementById('map-picker');
  return { text: el?.innerText ?? '', swampOpen: !el?.querySelector('button[data-id="swamp"]')?.disabled };
});
// Play a hunt to the end: optionally examine a huge footprint, take a photo of the given score, drive home.
const playHunt = (score, footprint) => page.evaluate(([score, footprint]) => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  if (footprint) {
    const c = g.clues.clues.find((x) => x.type === 'footprint' && (x.data?.length ?? 0) >= 0.38 && !x.found);
    if (c) g.journal.record(c);
  }
  g.hunt.photos.push({ subject: 'Bigfoot', score, distance: 20, source: 'handheld camera', at: 1 });
  g.hunt.photo = g.hunt.photos[g.hunt.photos.length - 1]; g.hunt.stage = 'extract';
  const e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.hunt.update(0);
  g.hunt.end('complete');
  const h = g.camp.lastHunt;
  return { outcome: h.outcome, research: h.research, text: g.hunt.screen?.innerText ?? '' };
}, [score, footprint]);

await page.goto('http://localhost:4401/'); await page.evaluate(() => localStorage.clear());
await load();
const p0 = await picker();
const buyers0 = await page.evaluate(() => document.getElementById('camp-panel')?.innerText.split('\n').find((l) => l.startsWith('Buyers')) ?? '');
check('new career: the swamp is locked, and says what it needs (extraction + Bigfoot Documented)', !p0.swampOpen && /Documented/.test(p0.text) && /extraction/.test(p0.text), p0.text.split('\n').slice(0, 4));

const h1 = await playHunt(20, false);
check('an ambiguous record (grade 1 photo) earns no milestone and no credibility', h1.research && h1.research.newly.length === 0 && h1.research.credibility === 0 && /ambiguous/.test(h1.research.ignored.join(' ')) && /none \(ambiguous record\)/.test(h1.text), { research: h1.research, screen: h1.text.split('\n').filter((l) => /RESEARCH|milestone|credibility/i.test(l)) });
await page.screenshot({ path: `${out}/01-debrief-ambiguous-photo-no-credibility.png` });
await load();
const p1 = await picker();
check('after a successful extraction with only an ambiguous record the swamp stays locked (Documented missing)', !p1.swampOpen && /Documented/.test(p1.text) && !/extraction/.test(p1.text), p1.text.split('\n').slice(0, 4));

const h2 = await playHunt(62, true);
const got = (h2.research?.newly ?? []).map((n) => n.milestone);
check('a usable record (grade 2) and a huge footprint: Located +1 and Documented +2 (credibility 3)', got.includes('documented') && got.includes('located') && h2.research.credibility === 3, h2.research);
check('the end-of-hunt screen names the milestones and the credibility earned', /Bigfoot Documented\s+\+2 credibility/.test(h2.text) && /Career credibility\s+3/.test(h2.text), h2.text.split('\n').filter((l) => /RESEARCH|credibility/i.test(l)));
await page.screenshot({ path: `${out}/02-debrief-documented.png` });

await load();
const p2 = await picker();
const buyers2 = await page.evaluate(() => document.getElementById('camp-panel')?.innerText.split('\n').find((l) => l.startsWith('Buyers')) ?? '');
check('buyers: only local enthusiasts at first; folklore publishers open once expedition 2 is unlocked (enthusiasts always)', /Buyers: Local enthusiasts\s+·\s+next: Folklore/.test(buyers0) && /Buyers: Local enthusiasts, Folklore publishers/.test(buyers2), { buyers0, buyers2 });
check('reaching Documented (after a successful extraction, with the trip affordable) unlocks the next map', p2.swampOpen, p2.text.split('\n').slice(0, 4));
await page.evaluate(() => document.getElementById('map-picker')?.scrollIntoView({ block: 'center' }));
await page.screenshot({ path: `${out}/03-start-screen-swamp-unlocked.png` });

// Credibility is earned once: a second Documented-quality photo adds nothing.
const h3 = await playHunt(80, false);
check('credibility is awarded once per milestone (another good photo adds none)', h3.research.newly.every((n) => n.milestone !== 'documented') && h3.research.credibility === 3, h3.research);

// Field journal shows the dossier.
await load();
const dossier = await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.journalUI.setOpen(true); return document.querySelector('#journal .dossier')?.innerText ?? ''; });
await page.waitForTimeout(500); await page.screenshot({ path: `${out}/04-journal-dossier.png`, timeout: 120000 });
check('the field journal shows the Bigfoot dossier: milestones, credibility and what the next one needs', /DOSSIER/.test(dossier) && /✓ Documented/.test(dossier) && /credibility 3/.test(dossier) && /Next: Characterized/.test(dossier), dossier);
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
