// Shared cryptid AI framework (#86). Run: npm run check:t86 [outDir]
// Pine Hollow with ?cryptid=gouger: the Sidehill Gouger is defined as data only (profile entry) and
// runs on the same CryptidAI, perception, stimulus memory, awareness stages, nav and clue trail as
// Bigfoot. Walking up to it noisily (real keys), it goes suspicious -> investigating -> identified/
// engaged (bolts); once you leave, it loses contact and resets. The F4 panel shows stage, memory, scores.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t86';
mkdirSync(out, { recursive: true });
const PORT = 4386;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${n}.png` }); };

await page.goto(`http://localhost:${PORT}/?map=forest&seed=86&cryptid=gouger&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  window.__gouger = g.cryptids.cryptids.find((c) => c.profile.id === 'gouger');
  window.__bigfoot = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
});

const info = await page.evaluate(() => {
  const go = __gouger, bf = __bigfoot;
  return { gouger: !!go, brain: go?.brain.pathText, legs: go?.mesh.children.filter((o) => o.isGroup).length, actions: go?.profile.actions,
    bigfootBrain: bf?.profile.brain, sharedClass: go?.constructor === bf?.constructor, samePerception: go?.perception.constructor === bf?.perception.constructor };
});
check('?cryptid=gouger adds the Sidehill Gouger from its data: shared CryptidAI and perception (same as Bigfoot), utility brain, quadruped body',
  info.gouger && info.sharedClass && info.samePerception && info.legs === 4 && info.bigfootBrain === 'bigfoot', info);

// Let it go about its business for two minutes with you far away: it wanders its contour and leaves signs.
const walked = await page.evaluate(() => {
  const g = __game, go = __gouger, start = { x: go.agent.x, z: go.agent.z };
  for (const c of g.cryptids.cryptids) if (c !== go) c.update = () => {};
  let far = 0;
  for (let i = 0; i < 120 * 30; i++) { g.player.position.set(140, 0, 140); g.cryptids.update(1 / 30); g.clueTrails.update(); g.clues.update(1 / 30); far = Math.max(far, Math.hypot(go.agent.x - start.x, go.agent.z - start.z)); }
  const signs = g.clues.clues.filter((c) => c.cryptidId === 'gouger');
  return { far: +far.toFixed(1), prints: signs.filter((c) => c.type === 'footprint').length, hair: signs.filter((c) => c.type === 'hair').length, stage: go.stage, state: go.state };
});
check('left alone it wanders its slope and leaves its own small tracks and hair (the shared clue trail reads its data)',
  walked.far > 15 && walked.prints > 10 && walked.hair > 0 && walked.stage === 'unaware', walked);

// Walk toward it noisily (real keys: hold W and Shift) from 25 m behind it, then stand in front of it with the torch on.
await page.evaluate(() => {
  const g = __game, go = __gouger, h = go.agent.heading;
  const x = go.agent.x + Math.sin(h) * 22, z = go.agent.z + Math.cos(h) * 22;   // behind it
  g.player.position.set(x, 0, z); g.player.velocity.set(0, 0, 0);
  g.player.yaw = Math.atan2(-(go.agent.x - x), -(go.agent.z - z)); g.player.pitch = 0;
  go.agent.stop(); go.pauseLeft = 30;
  g.aiDebug?.setVisible(true);
});
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
let noticed = null;
for (let i = 0; i < 40 && !noticed; i++) {
  await steps(10);
  noticed = await page.evaluate(() => (['suspicious', 'investigating', 'identified', 'engaged'].includes(__gouger.stage) ? __gouger.stage : null));
}
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await steps(60);
await shot('01-gouger-noticed-you');
await page.evaluate(() => {
  const g = __game, go = __gouger;
  g.player.position.set(go.agent.x - Math.sin(go.agent.heading) * 6, 0, go.agent.z - Math.cos(go.agent.heading) * 6);
  g.player.yaw = Math.atan2(-(go.agent.x - g.player.position.x), -(go.agent.z - g.player.position.z));
  g.player.pitch = -0.08;
  if (!g.flashlight.on) g.flashlight.toggle?.();
});
await steps(30);
await shot('02-gouger-identified-you');
await steps(90);
const mid = await page.evaluate(() => ({ stage: __gouger.stage, state: __gouger.state, memory: __gouger.perception.lastKnown()?.channel, scores: __gouger.brain.scores }));
await shot('03-gouger-bolting');
// Leave: far away and still.
await page.evaluate(() => { const g = __game; g.player.position.set(-120, 0, 120); g.player.velocity.set(0, 0, 0); });
await steps(70 * 60);
const after = await page.evaluate(() => ({ stage: __gouger.stage, log: __gouger.perception.stageLog.map((s) => s.to), states: __gouger.history.map((h) => h.to), attacked: __gouger.history.some((h) => h.to === 'aggress') }));
const seen = new Set(after.log);
check('walking up noisily makes it suspicious before it knows what you are', !!noticed && ['suspicious', 'investigating'].some((s) => seen.has(s)), { noticed, log: after.log });
check('standing in front of it with the torch on: identified, and it bolts (engaged); it remembers where you were', ['identified', 'engaged'].some((s) => seen.has(s)) && after.states.includes('flee') && !!mid.memory, { mid, states: after.states });
check('after you leave it loses contact, resets and is unaware again; it never attacked', seen.has('lost') && seen.has('reset') && after.stage === 'unaware' && !after.attacked, after);
const panel = await page.evaluate(() => { __game.sim.frame(0); return __game.aiDebug.panel.textContent.match(/Sidehill Gouger {2}\[[\s\S]{0,500}/)?.[0] ?? ''; });
check('the AI debug panel (F4) shows its awareness stage, remembered cue and action scores', /stage [A-Z]+/.test(panel) && /scores /.test(panel), panel.slice(0, 300));

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
