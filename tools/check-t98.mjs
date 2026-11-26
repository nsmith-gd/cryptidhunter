// Expedition lifecycle (#98). Run: npm run check:t98 [outDir]
// Plan -> Commit -> Investigate -> Extract -> Debrief in Pine Hollow, with the real buttons and keys.
// Clicking the start screen alone doesn't set off; COMMIT pays the $25 trip once and creates an
// attempt ID. At the van, H opens the extraction manifest, C backs out, H twice drives out. Each
// run is classed (partial, successful, empty, emergency) and its debrief matches the ledger.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t98';
mkdirSync(out, { recursive: true });
const PORT = 4398;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const URL = (seed) => `http://localhost:${PORT}/?map=forest&seed=${seed}&nodebugai&simpaused`;
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${n}.png` }); };
const load = async (seed) => { await page.goto(URL(seed)); await page.waitForFunction(() => window.__game && document.getElementById('prep-panel'), null, { timeout: 180000 }); };
const ledger = () => page.evaluate(() => { const l = __game.camp.ledger; return { cash: l.cash, trips: l.tx.filter((t) => t.kind === 'trip').map((t) => `${t.id} ${t.cents}`), audit: l.audit().ok }; });
// Commit with the real button, then enter the field (pointer lock doesn't exist headless).
const commitAndGo = async () => {
  await page.click('#prep-panel button[data-act="commit"]');
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
    for (const c of g.cryptids.cryptids) { c.update = () => {}; c.agent.x = 140; c.agent.z = -140; }   // Bigfoot out of the way
  });
};
const toVan = async () => { await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); }); await steps(25 * 60); };
const bagHair = () => page.evaluate(() => {
  const g = __game, p = g.player, c = g.clues.clues.find((q) => q.type === 'hair' && q.object.visible);
  if (!c) return false;
  p.position.set(c.x, 0, c.z + 1.6); p.velocity.set(0, 0, 0); g.sim.step();
  const e = g.camera.position;
  p.pitch = -Math.atan2(e.y - (c.y + 0.03), Math.hypot(c.x - e.x, c.z - e.z)); p.yaw = -Math.atan2(c.x - e.x, -(c.z - e.z)); g.sim.step();
  return true;
});
const ended = () => page.evaluate(() => {
  const g = __game, h = g.camp.lastHunt;
  return { stage: g.hunt.stage, outcome: g.hunt.outcome, cls: h?.outcomeClass, attempt: h?.attemptId, ledger: h?.ledger, debrief: g.hunt.endBody.textContent, title: g.hunt.endTitle.textContent };
});

// ---- 1. Plan: a fresh career sees the prep screen; clicking the screen doesn't set off ----
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await load(98);
const prep = await page.evaluate(() => document.getElementById('prep-panel').innerText);
check('the prep screen shows trip cost, cash before/after, deposits, carried mass, owned stock and required vs recommended capabilities',
  /Trip cost\s*\$25/.test(prep) && /\$250 → \$225/.test(prep) && /Deposits held/.test(prep) && /Carrying\s*[\d.]+ kg/.test(prep)
  && /Owned stock/.test(prep) && /Required to go/.test(prep) && /Recommended/.test(prep) && /COMMIT/.test(prep), prep);
await page.screenshot({ path: `${out}/01-prep-screen.png` });
await page.mouse.click(1050, 880);   // the start screen background
await page.waitForTimeout(200);
const idle = await page.evaluate(() => ({ stage: __game.hunt.stage, committed: __game.expedition.committed, cash: __game.camp.ledger.cash, hint: document.getElementById('prep-panel').innerText.includes('press COMMIT') }));
check('clicking the start screen without committing charges nothing and does not start the hunt', idle.stage === 'briefing' && !idle.committed && idle.cash === 25000 && idle.hint, idle);

// ---- 2. Commit -> collect a hair sample -> manifest review -> drive out: PARTIAL ----
await commitAndGo();
const c1 = await ledger();
const aid1 = await page.evaluate(() => __game.expedition.attemptId);
check('COMMIT debits the $25 trip once under a new attempt ID (starting the hunt again charges nothing)', c1.cash === 22500 && c1.trips.length === 1 && c1.trips[0] === `trip:${aid1} -2500`, { ...c1, aid1 });
await page.evaluate(() => document.exitPointerLock());   // Esc: the mouse is released and the start screen shows
await page.waitForTimeout(300);
await page.evaluate(() => { __game.input.locked = false; __game.overlay.classList.remove('hidden'); });
await shot('02-paused-expedition-under-way');
const paused = await page.evaluate(() => document.getElementById('prep-panel').innerText);
check('pausing shows the expedition under way, with emergency evacuation offered', /UNDER WAY/.test(paused) && /Emergency evacuation · \$40/.test(paused), paused);
await page.evaluate(() => { __game.overlay.classList.add('hidden'); __game.input.locked = true; });
const gotHair = await bagHair();
await page.keyboard.press('KeyX'); await steps(2);
await toVan();
await page.keyboard.press('KeyH'); await steps(2);
const review = await page.evaluate(() => ({ stage: __game.hunt.stage, text: document.getElementById('extraction-review')?.textContent ?? '', shown: document.getElementById('extraction-review')?.style.display }));
await shot('03-extraction-manifest');
check('H at the van opens the extraction manifest (evidence loaded, left behind, irreversible warning) without leaving yet',
  gotHair && review.stage === 'search' && review.shown === 'block' && /Hair sample/.test(review.text) && /LEFT BEHIND/.test(review.text) && /final/.test(review.text), review);
await page.keyboard.press('KeyC'); await steps(2);
const backed = await page.evaluate(() => ({ stage: __game.hunt.stage, shown: document.getElementById('extraction-review').style.display }));
check('C backs out of the manifest and the hunt goes on', backed.stage === 'search' && backed.shown === 'none', backed);
await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH'); await steps(2);
const r1 = await ended();
const l1 = await ledger();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/04-debrief-partial.png` });
check('driving out with only a hair sample is a PARTIAL extraction, and the debrief adds up to the ledger',
  r1.stage === 'ended' && r1.cls === 'partial' && r1.attempt === aid1 && /Outcome: Partial extraction/.test(r1.debrief)
  && r1.ledger.expense === 2500 && r1.ledger.closing === 22500 + r1.ledger.gross + r1.ledger.bonus && l1.cash === r1.ledger.closing
  && /Gross revenue/.test(r1.debrief) && /Expenses \(trip\)\s+-\$25/.test(r1.debrief) && /Closing cash/.test(r1.debrief) && l1.trips.length === 1, { r1: { ...r1, debrief: r1.debrief.slice(-400) }, l1 });

// ---- 3. Next attempt: a photo of Bigfoot comes home: SUCCESSFUL ----
await load(99);
const open2 = (await ledger()).cash;
await commitAndGo();
await page.evaluate(() => __game.hunt.onPhoto({ subject: 'Bigfoot', distance: 20, score: 55, source: 'handheld camera' }));
await toVan();
await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH'); await steps(2);
const r2 = await ended();
const l2 = await ledger();
check('a new attempt ID, charged once, and a Bigfoot photo brought home is a SUCCESSFUL documented extraction',
  r2.cls === 'successful' && r2.attempt !== aid1 && r2.ledger.closing === open2 - 2500 + r2.ledger.gross + r2.ledger.bonus && l2.trips.length === 2, { cls: r2.cls, attempt: r2.attempt, ledger: r2.ledger, trips: l2.trips });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/05-debrief-successful.png` });

// ---- 4. Nothing collected: EMPTY ----
await load(100);
const open3 = (await ledger()).cash;
await commitAndGo();
await toVan();
await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH'); await steps(2);
const r3 = await ended();
check('driving out empty-handed is an EMPTY extraction: only the trip is paid', r3.cls === 'empty' && r3.ledger.gross === 0 && r3.ledger.closing === open3 - 2500, { cls: r3.cls, ledger: r3.ledger });

// ---- 5. Emergency evacuation from the pause screen, carrying a hair sample ----
await load(101);
const open4 = (await ledger()).cash;
await commitAndGo();
await bagHair(); await page.keyboard.press('KeyX'); await steps(2);
await page.evaluate(() => document.exitPointerLock());   // Esc: the mouse is released and the start screen shows
await page.waitForTimeout(300);
await page.evaluate(() => { __game.input.locked = false; __game.overlay.classList.remove('hidden'); });
await page.waitForTimeout(800);   // the start screen fades back in
await page.click('#prep-panel button[data-act="emergency"]');
const armed = await page.evaluate(() => ({ stage: __game.hunt.stage, text: document.getElementById('prep-panel').innerText }));
await page.waitForTimeout(300);
await page.click('#prep-panel button[data-act="emergency"]');
await steps(2);
const r4 = await ended();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/06-debrief-emergency.png` });
check('emergency evacuation asks to confirm, then is an EMERGENCY extraction: carried evidence sells and the $40 fee is charged once',
  armed.stage === 'search' && /CONFIRM/.test(armed.text) && r4.cls === 'emergency' && r4.title === 'EVACUATED' && r4.ledger.gross > 0 && r4.ledger.charges === 4000
  && r4.ledger.closing === open4 - 2500 - 4000 + r4.ledger.gross + r4.ledger.bonus && /Emergency charges\s+-\$40/.test(r4.debrief), { cls: r4.cls, ledger: r4.ledger });

// ---- 6. Quit mid-hunt: the attempt closes unextracted; nothing refunded or charged again ----
await load(102);
await commitAndGo();
const mid = await ledger();
await load(103);
const after = await page.evaluate(() => { const g = __game, l = g.camp.ledger; return { cash: l.cash, open: Object.values(l.attempts).filter((a) => a.state !== 'settled').length, committed: g.expedition.committed, audit: l.audit().ok }; });
check('closing the game mid-hunt settles that attempt as unextracted: no refund, no second charge, a fresh plan next time',
  after.cash === mid.cash && after.open === 0 && !after.committed && after.audit, { mid: mid.cash, after });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
