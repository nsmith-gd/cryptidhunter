// Collectable evidence check (#73). Run: npm run check:t73 [outDir]
// Pine Hollow with a real Bigfoot trail (seeded). Bag a hair sample (X), cast a footprint (X),
// photograph a footprint, drive home from the van (H) and the evidence sells at base camp.
// A second hunt: collect, get caught, and the evidence is lost. Fixed-step sim (?simpaused).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t73';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4379', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${n}.png` }); };
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);

const open = async () => {
  await page.goto('http://localhost:4379/?map=forest&seed=73&nodebugai&simpaused');
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
    for (const c of g.cryptids.cryptids) { c.update = () => {}; c.agent.x = 140; c.agent.z = -140; }   // Bigfoot out of the way
  });
};
// Stand 1.6 m from a clue of `type` and look straight at it. Returns the clue id.
const goTo = (type, skip = []) => page.evaluate(([type, skip]) => {
  const g = __game, p = g.player;
  const c = g.clues.clues.find((q) => q.type === type && !skip.includes(q.id) && q.object.visible);
  if (!c) return null;
  p.position.set(c.x, 0, c.z + 1.6); p.velocity.set(0, 0, 0); p.yaw = 0;
  g.sim.step();
  const e = g.camera.position;
  p.pitch = -Math.atan2(e.y - (c.y + 0.03), Math.hypot(c.x - e.x, c.z - e.z));
  p.yaw = -Math.atan2(c.x - e.x, -(c.z - e.z));
  g.sim.step();
  return c.id;
}, [type, skip]);
const items = () => page.evaluate(() => __game.evidence.items.map((i) => ({ name: i.name, stage: i.stage, cryptid: i.cryptid })));

// ---- Hunt 1: collect, extract, sell ----
await page.goto('http://localhost:4379/');
await page.evaluate(() => localStorage.clear());
await open();
const money0 = await page.evaluate(() => __game.camp.state.money);
const hairId = await goTo('hair');
await page.keyboard.press('KeyX');
await steps(2);
const bagged = await items();
const hairGone = await page.evaluate((id) => !__game.clues.clues.find((c) => c.id === id)?.object.visible, hairId);
await shot('01-hair-sample-bagged');
check('aim at a hair tuft and press X: it goes into a sample pouch', hairId && bagged.some((i) => i.name === 'Hair sample' && i.stage === 'collected') && hairGone, { bagged, pouches: await page.evaluate(() => __game.evidence.pouches) });

const fpId = await goTo('footprint');
await page.keyboard.press('KeyX');
await steps(60);
const prompt = await page.evaluate(() => { __game.sim.frame(0); return document.querySelector('#evidence-prompt').textContent; });
await steps(4 * 60);
const cast = await items();
check('X on a footprint pours a cast that sets after a few seconds', fpId && /Cast setting/.test(prompt) && cast.some((i) => i.name === 'Footprint cast'), { prompt, cast });

// Photograph a different footprint with the real camera buttons.
const fp2 = await goTo('footprint', [fpId]);
await page.mouse.move(480, 270);
await page.mouse.down({ button: 'right' });
await steps(30);
await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
await page.mouse.up({ button: 'right' });
await steps(10);
const photographed = await items();
await shot('02-footprint-photographed');
check('a photo of a footprint is kept as a footprint-photo evidence item', fp2 && photographed.some((i) => i.name === 'Footprint photo'), photographed);

// Drive home from the van (no Bigfoot photo: you can leave after a short while).
await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); });
await steps(25 * 60);
await page.keyboard.press('KeyH');
await steps(2);
const sold = await page.evaluate(() => {
  const g = __game, h = g.camp.lastHunt;
  return { outcome: g.hunt.outcome, stages: g.evidence.items.map((i) => i.stage), evidenceSold: h?.evidenceSold, money: g.camp.state.money, screen: g.hunt.endBody.textContent };
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-results-evidence-sold.png` });
const evidenceTotal = (sold.evidenceSold ?? []).reduce((a, e) => a + e.value, 0);
check('driving home extracts the evidence and base camp sells every item', sold.stages.every((s) => s === 'sold') && sold.evidenceSold?.length === 3 && sold.money === money0 + evidenceTotal && evidenceTotal > 0, sold);
check('the hair sample shows as sold on the results', /Hair sample \(Bigfoot\): \$45/.test(sold.screen), sold.screen.slice(0, 600));

await page.goto('http://localhost:4379/?map=forest&seed=73');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
const panel = await page.evaluate(() => document.querySelector('#camp-panel')?.textContent ?? '');
await page.screenshot({ path: `${out}/04-base-camp-sold.png` });
check('base camp shows the sale next time', /Hair sample \(Bigfoot\): \$45/.test(panel) && /Footprint cast/.test(panel), panel);

// ---- Hunt 2: collect, then get caught -> evidence lost ----
await open();
const moneyB = await page.evaluate(() => __game.camp.state.money);
await goTo('hair');
await page.keyboard.press('KeyX');
await steps(2);
await page.evaluate(() => { __game.huntFailure.enabled = true; __game.huntFailure.caught('Bigfoot'); });
await steps(2);
const lost = await page.evaluate(() => ({ stages: __game.evidence.items.map((i) => i.stage), money: __game.camp.state.money, lost: __game.camp.lastHunt?.evidenceLost, reason: __game.huntFailure.reason.textContent }));
await page.screenshot({ path: `${out}/05-caught-evidence-lost.png` });
check('getting caught loses evidence you were carrying (no money)', lost.stages.length === 1 && lost.stages[0] === 'lost' && lost.money === moneyB && lost.lost === 1 && /1 evidence item lost/.test(lost.reason), lost);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
