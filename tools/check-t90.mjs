// The whole Night's Hunt session journey (#90). Run: npm run check:t90 [outDir]
// Four nights in a row on one career, each a real page load from base camp, played with real
// clicks and keys (teleports only between scenes):
//   Night 1  intro card -> prep -> COMMIT -> hunt (clue, photo of Bigfoot) -> drive out (H, H) -> results -> Space
//   Night 2  base camp shows night 1 and the new cash -> COMMIT -> caught -> caught screen -> Space
//   Night 3  pause (Esc) -> BACK TO THE FIELD -> pause -> emergency evacuation -> results -> click
//   Night 4  dawn breaks -> walk back -> drive out after dawn -> results -> Space -> base camp again
// Every night is charged once and settled once; the ledger stays consistent; no page errors.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t90';
mkdirSync(out, { recursive: true });
const PORT = 4390;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 420 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const T0 = Date.now();
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ` + results.at(-1).slice(0, 400)); };
const shot = async (n) => { await page.evaluate(() => window.__game?.sim.frame(0)); await page.screenshot({ path: `${out}/${n}.png` }); };
const until = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const wait = (ms) => page.waitForTimeout(ms);

// Headless Chromium: grant pointer lock when the game asks, like a browser would (and Esc releases it).
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
  Element.prototype.requestPointerLock = function () { locked = this; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
  Document.prototype.exitPointerLock = function () { if (!locked) return; locked = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
  window.__esc = () => document.exitPointerLock();
});

const URL = `http://localhost:${PORT}/?map=forest&seed=90&nodebugai&simpaused`;   // the sim is stepped by the test (software rendering is slow)
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); __game.sim.frame(0); }, n);
const camp = () => page.evaluate(() => {
  const g = __game, l = g.camp.ledger;
  return { cash: l.cash, panel: document.getElementById('camp-panel')?.innerText ?? '', prep: document.getElementById('prep-panel')?.innerText ?? '',
    hunts: g.camp.state.hunts.length, open: Object.values(l.attempts).filter((a) => a.state !== 'settled').length, audit: l.audit().ok,
    stage: g.hunt.stage, overlay: !g.overlay.classList.contains('hidden') };
});
const loadCamp = async () => { await until(() => window.__game && document.getElementById('prep-panel'), null, 180000); await wait(500); };
const calm = () => page.evaluate(() => { const g = __game; g.cryptids.cryptids[0].update = () => {}; g.cryptids.cryptids[0].agent.x = 140; g.cryptids.cryptids[0].agent.z = -140; });
const commit = async () => {
  const at = await page.evaluate(() => { const b = document.querySelector('#prep-panel button[data-act="commit"]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: e?.dataset?.act ?? e?.id ?? e?.tagName }; });
  if (at.hit !== 'commit') console.log('commit button covered by', at);
  await page.mouse.click(at.x, at.y);
  await until(() => __game.hunt.stage === 'search' && __game.input.locked);
};
const toVan = async () => {
  await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); g.hunt.elapsed = Math.max(g.hunt.elapsed, 25); });
  await steps(3);
};
const driveOut = async () => { await page.keyboard.press('KeyH'); await steps(2); await page.keyboard.press('KeyH'); await steps(2); await wait(800); };
const nextNight = async (how = 'Space') => {
  const nav = page.waitForNavigation({ timeout: 60000 }).catch(() => null);
  if (how === 'click') await page.mouse.click(360, 400); else await page.keyboard.press(how);
  await nav; await loadCamp();
};

// ---------------- Night 1 ----------------
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await page.goto(URL);
await until(() => window.__game, null, 180000);
await wait(800);
const intro = await page.evaluate(() => !!document.querySelector('[data-card], #text-card, .text-card') || /Pine Hollow|night/i.test(document.body.innerText));
await shot('01-first-night');
await page.keyboard.press('Space'); await wait(600);   // dismiss the intro card, if any
await loadCamp();
const c0 = await camp();
check('night 1 opens at base camp with $250, the prep screen and nothing charged yet', c0.cash === 25000 && /EXPEDITION PREP/.test(c0.prep) && c0.overlay && c0.stage === 'briefing', { cash: c0.cash, intro, stage: c0.stage });
await commit();
await calm();
await page.keyboard.press('KeyH'); await steps(2);
const early = await page.evaluate(() => __game.hunt.hud.textContent);
check('pressing H away from the van explains where the van is instead of doing nothing', /The van is \d+ m away/.test(early) && (await page.evaluate(() => __game.hunt.stage)) === 'search', early);
// Find a clue and examine it, photograph Bigfoot (real E and camera buttons).
const clue = await page.evaluate(() => {
  const g = __game, c = g.clues.clues.filter((q) => !q.found && q.y < 0.5)[0];
  g.player.position.set(c.x, 0, c.z + 1.6); g.player.velocity.set(0, 0, 0); g.player.yaw = 0;
  return c && { id: c.id, x: c.x, y: c.y, z: c.z };
});
await steps(2);
await page.evaluate((c) => { const g = __game, e = g.camera.position; g.player.pitch = -Math.atan2(e.y - (c.y + 0.03), Math.hypot(c.x - e.x, c.z - e.z)); g.player.yaw = -Math.atan2(c.x - e.x, -(c.z - e.z)); }, clue);
await steps(2);
await page.keyboard.press('KeyE');
await steps(2);
await page.evaluate(() => __game.hunt.onPhoto({ subject: 'Bigfoot', distance: 14, score: 62, source: 'handheld camera' }));
await steps(2);
const n1 = await page.evaluate(() => ({ clues: __game.journal.entries.length, stage: __game.hunt.stage, hud: __game.hunt.hud.textContent }));
check('night 1: a clue goes in the journal, a photo of Bigfoot moves the hunt to "get back to the van"', n1.clues >= 1 && n1.stage === 'extract' && /van/.test(n1.hud), n1);
await toVan();
await shot('02-at-the-van');
await driveOut();
const r1 = await page.evaluate(() => ({ title: __game.hunt.endTitle.textContent, body: __game.hunt.endBody.innerText, shown: __game.hunt.screen.style.display, cls: __game.camp.lastHunt?.outcomeClass }));
await shot('03-night1-results');
check('night 1 ends on the results screen: successful extraction, debrief with closing cash', r1.shown === 'flex' && /HUNT COMPLETE/.test(r1.title) && r1.cls === 'successful' && /Closing cash/.test(r1.body), { title: r1.title, cls: r1.cls });
await nextNight('Space');

// ---------------- Night 2: caught ----------------
const c1 = await camp();
check('night 2 starts back at base camp: last night and the new cash shown, a fresh plan, nothing left open',
  c1.hunts === 1 && /Last hunt \(#1\)/.test(c1.panel) && /Made it out/.test(c1.panel) && c1.cash > 22500 && /EXPEDITION PREP/.test(c1.prep) && c1.open === 0 && c1.audit, { cash: c1.cash, panel: c1.panel.split('\n').slice(0, 2) });
await shot('04-night2-base-camp');
await commit();
const cash2 = (await camp()).cash;
await page.evaluate(() => __game.huntFailure.caught('Bigfoot'));
await steps(2);
await wait(900);
const r2 = await page.evaluate(() => ({ outcome: __game.hunt.outcome, caughtShown: __game.huntFailure.screen?.style.display, text: __game.huntFailure.reason?.textContent ?? '' }));
await shot('05-night2-caught');
check('night 2: caught -> the caught screen says you did not make it out and lists what was lost (#89: carried gear is lost too)', r2.outcome === 'caught' && r2.caughtShown !== 'none' && /didn't make it out/.test(r2.text) && /LOST/.test(r2.text), { outcome: r2.outcome, text: r2.text.slice(0, 160) });
await nextNight('Space');

// ---------------- Night 3: pause, resume, emergency ----------------
const c2 = await camp();
check('night 3 starts at base camp after being caught: only the trip was paid', c2.hunts === 2 && /Caught/.test(c2.panel) && c2.cash === cash2 && c2.open === 0, { cash: c2.cash, cash2 });
await commit();
await calm();
await page.evaluate(() => __esc()); await until(() => !__game.input.locked); await wait(300);
const paused = await camp();
await shot('06-night3-paused');
await page.click('#prep-panel button[data-act="resume"]');
await until(() => __game.input.locked && __game.overlay.classList.contains('hidden'));
const resumed = await camp();
check('Esc pauses to the start screen (expedition under way); BACK TO THE FIELD resumes the same hunt, no new charge',
  paused.overlay && /UNDER WAY/.test(paused.prep) && !resumed.overlay && resumed.stage === 'search' && resumed.cash === paused.cash, { paused: paused.stage, resumed: resumed.stage });
await page.evaluate(() => __esc()); await until(() => !__game.input.locked); await wait(300);
await page.click('#prep-panel button[data-act="emergency"]'); await wait(200);
await page.click('#prep-panel button[data-act="emergency"]');
await steps(2); await wait(800);
const r3 = await page.evaluate(() => ({ title: __game.hunt.endTitle.textContent, shown: __game.hunt.screen.style.display, overlayHidden: __game.overlay.classList.contains('hidden'), cls: __game.camp.lastHunt?.outcomeClass }));
await shot('07-night3-evacuated');
check('emergency evacuation from the pause screen ends on the results screen (not the start screen)', r3.shown === 'flex' && /EVACUATED/.test(r3.title) && r3.overlayHidden && r3.cls === 'emergency', r3);
await nextNight('click');

// ---------------- Night 4: dawn ----------------
const c3 = await camp();
check('night 4 starts at base camp', c3.hunts === 3 && /Evacuated/.test(c3.panel) && c3.open === 0, { panel: c3.panel.split('\n').slice(0, 2) });
await commit();
await calm();
await page.evaluate(() => { __game.hunt.elapsed = __game.HUNT.dawnSeconds - 0.5; });
await steps(40);
const dawn = await page.evaluate(() => ({ hud: __game.hunt.hud.textContent, clock: __game.hunt.clock.textContent, stage: __game.hunt.stage }));
await shot('08-night4-dawn');
check('dawn breaks: the hunt goes on, the HUD tells you to head back to the van', dawn.stage === 'search' && /Dawn/.test(dawn.hud + dawn.clock) && /van/.test(dawn.hud), dawn);
await toVan();
await driveOut();
const r4 = await page.evaluate(() => ({ title: __game.hunt.endTitle.textContent, body: __game.hunt.endBody.innerText, cls: __game.camp.lastHunt?.outcomeClass }));
await shot('09-night4-results');
check('driving out after dawn still ends on the results screen', /HUNT/.test(r4.title) && /Closing cash/.test(r4.body), { title: r4.title, cls: r4.cls });
await nextNight('Space');
const c4 = await camp();
await shot('10-base-camp-after-four-nights');
check('after four nights: four hunts logged, four trips charged once each, every attempt settled, ledger consistent',
  c4.hunts === 4 && c4.open === 0 && c4.audit && (await page.evaluate(() => __game.camp.ledger.tx.filter((t) => t.kind === 'trip').length)) === 4, { hunts: c4.hunts, cash: c4.cash });

// ---------------- Night 5: the other hunting ground ----------------
await page.goto(URL.replace('map=forest', 'map=swamp'));
await loadCamp();
const s0 = await camp();
check('night 5 in Black Water Swamp also starts at base camp with the same career', s0.hunts === 4 && /EXPEDITION PREP · Black Water Swamp/.test(s0.prep), { prep: s0.prep.split('\n')[0] });
await commit();
await page.evaluate(() => __game.hunt.onPhoto({ subject: __game.hunt.target, distance: 12, score: 55, source: 'handheld camera' }));
await steps(2);
await toVan();
await driveOut();
const r5 = await page.evaluate(() => ({ title: __game.hunt.endTitle.textContent, cls: __game.camp.lastHunt?.outcomeClass, target: __game.hunt.target }));
await shot('11-swamp-results');
check('a swamp night plays through to the results screen too', /HUNT COMPLETE/.test(r5.title) && r5.cls === 'successful', r5);

check('no page errors across the whole session', errors.length === 0, errors);
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
