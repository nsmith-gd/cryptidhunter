// Results screen: the numbers shown must match what happened. Run: npm run check:t31 [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t31';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4388', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

const play = async ({ shots, clues, leaveAfterDawn = false, startMoney = 0 }) => {
  await page.goto('http://localhost:4388/?nodebugai');
  await page.evaluate((m) => { localStorage.clear(); }, startMoney);
  await page.reload();
  await page.waitForFunction(() => window.__game);
  return page.evaluate(({ shots, clues, leaveAfterDawn, startMoney }) => {
    const g = __game;
    g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false;
    if (startMoney) { g.camp.state.money = startMoney; g.camp.save(); }
    g.hunt.start();
    // Clues: log real-looking clue records through the journal.
    clues.forEach((type, i) => g.journal.record({ id: `test-${i}`, type, x: i, z: 0, y: 0, age: 30, data: {} }));
    // Photos, as the camera reports them (subject null = a miss).
    for (const s of shots) g.hunt.onPhoto({ subject: s.subject, distance: s.distance, score: s.score, source: 'handheld camera' });
    if (leaveAfterDawn) g.hunt.elapsed = 15 * 60 + 1;
    g.hunt.update(0.01);
    g.player.position.set(g.HUNT.exit.x, 0, g.HUNT.exit.z);
    g.hunt.update(0.01);
    if (g.hunt.canLeaveWithPhoto()) g.hunt.end('complete'); else g.hunt.end('abandoned');
    return { r: g.hunt.results(), camp: g.camp.lastHunt, money: g.camp.state.money, text: g.hunt.endBody.textContent };
  }, { shots, clues, leaveAfterDawn, startMoney });
};

// ---- Hunt 1: four shots (one miss), three of Bigfoot; two clues; home before dawn ----
const shots = [
  { subject: 'Bigfoot', distance: 31, score: 55 },
  { subject: null, distance: 0, score: 0 },
  { subject: 'Bigfoot', distance: 18, score: 82 },
  { subject: 'Bigfoot', distance: 24, score: 70 },
];
const h1 = await play({ shots, clues: ['footprint', 'hair'] });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/01-results-home-before-dawn.png` });
check('photos taken = 4, of Bigfoot = 3', h1.r.shotsTaken === 4 && h1.r.photosOfTarget === 3, h1.r);
check('best score = 82, listed first and starred', h1.r.bestScore === 82 && h1.r.list[0].score === 82 && h1.r.list[0].best && /★ score  82/.test(h1.text), h1.r.list);
check('clues found = 2, by type', h1.r.clues === 2 && /Footprint ×1/i.test(h1.r.clueTypes) && /hair/i.test(h1.r.clueTypes), h1.r.clueTypes);
check('money shown matches base camp: photos + bonus = earned, total = wallet',
  h1.r.money.earned === h1.camp.earned && h1.r.money.bonus === h1.camp.bonus && h1.r.money.photoValue + h1.r.money.bonus === h1.r.money.earned
  && h1.r.money.total === h1.money && h1.camp.bonus > 0, { shown: h1.r.money, camp: { earned: h1.camp.earned, bonus: h1.camp.bonus }, wallet: h1.money });
check('the screen prints those same numbers', h1.text.includes(`$${h1.r.money.earned}`) && h1.text.includes(`$${h1.r.money.total}`) && /Best score\s+82 \/ 100/.test(h1.text), h1.text);

// ---- Hunt 2: one photo, after dawn, with $100 already banked ----
const h2 = await play({ shots: [{ subject: 'Bigfoot', distance: 30, score: 40 }], clues: [], leaveAfterDawn: true, startMoney: 100 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-results-after-dawn.png` });
check('after dawn: no bonus, earned = photo value, total = 100 - $25 trip + earned',
  h2.r.money.bonus === 0 && h2.r.money.earned === h2.camp.earned && h2.r.money.total === 100 - 25 + h2.camp.earned, { shown: h2.r.money, camp: h2.camp.earned });
check('no clues -> found 0', h2.r.clues === 0 && /Found\s+0/.test(h2.text), h2.r.clues);

// ---- Hunt 3: no photos, leave empty-handed ----
const h3 = await play({ shots: [{ subject: null, distance: 0, score: 0 }], clues: ['scratch'] });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-results-empty-handed.png` });
check('empty-handed: 1 shot, 0 of Bigfoot, best none, $0 earned', h3.r.shotsTaken === 1 && h3.r.photosOfTarget === 0 && h3.r.bestScore === null
  && h3.r.money.earned === 0 && /Best score\s+none/.test(h3.text), h3.r);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
