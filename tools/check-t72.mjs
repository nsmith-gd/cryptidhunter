// Health / injury check (#72). Run: npm run check:t72 [outDir]
// A cryptid's contact wounds you instead of ending the hunt; damage applies once per contact;
// bleeding drains health until bandaged (B); the hunt ends only when health reaches 0.
// Drives the fixed-step sim directly (?simpaused) with Bigfoot moved onto the player.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t72';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4377', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${n}.png` }); };

const open = async () => {
  await page.goto('http://localhost:4377/?seed=72&nodebugai&simpaused');
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
    const b = g.cryptids.cryptids[0]; b.update = () => {}; b.agent.x = 30; b.agent.z = 30;
    g.player.position.set(0, 0, 10); g.player.yaw = 0;
  });
};
// Run n seconds of sim. contact: keep Bigfoot right on top of the player the whole time.
const run = (seconds, contact = false) => page.evaluate(([seconds, contact]) => {
  const g = __game, b = g.cryptids.cryptids[0], p = g.player;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    if (contact) { b.agent.x = p.position.x + 0.3; b.agent.z = p.position.z; } else if (Math.hypot(b.agent.x - p.position.x, b.agent.z - p.position.z) < 5) { b.agent.x = 30; b.agent.z = 30; }
    g.sim.step();
  }
  const h = g.survival.health;
  return { health: +h.value.toFixed(1), conditions: h.conditions.map((c) => `${c.kind}/${c.severity}`), firstAid: h.firstAid,
    events: h.log.length, stage: g.hunt.stage, caught: g.huntFailure.isCaught, flash: g.huntFailure.hitFlash.textContent,
    warnings: g.survival.warnings().map((w) => w.text) };
}, [seconds, contact]);

await open();
const hit = await run(1 / 60, true);
await shot('01-struck-bleeding');
check('Bigfoot\'s contact wounds you (heavy bleeding) instead of ending the hunt', hit.health === 40 && hit.conditions.includes('bleeding/heavy') && hit.stage !== 'ended' && !hit.caught && /struck you! −60 health/.test(hit.flash), hit);
const held = await run(1.5, true);
check('one contact deals damage once (grace window): staying in contact for 1.5 s adds no second hit', held.events === 1 && held.health > 30, held);
const bleeding = await run(4);
check('bleeding keeps draining health, with a warning that names the cause and the fix', bleeding.health < held.health && bleeding.warnings.some((w) => /Heavy bleeding \(Bigfoot\): losing health\. Bandage it \(B\)/.test(w)), bleeding);
await page.keyboard.press('KeyB');
const dressed = await run(2);
await shot('02-bandaged');
const stable = await run(10);
check('B bandages it: bleeding stops, a little health back, one first-aid kit used', dressed.conditions.includes('dressed/heavy') && !dressed.conditions.some((c) => c.startsWith('bleeding')) && dressed.firstAid === 2 && dressed.health > bleeding.health && stable.health === dressed.health, { bleeding: bleeding.health, dressed, stable: stable.health });
await run(1);                                   // past the grace window
const second = await run(2 / 60, true);           // the hunt closes on the step after the catch
await shot('03-second-hit-hunt-over');
check('a second big hit takes health to 0 and only then the hunt ends (caught)', second.health === 0 && second.caught && second.stage === 'ended', second);

// Untreated bleeding alone can end it too.
await open();
await run(1 / 60, true);
const bled = await run(40);
check('left untreated, heavy bleeding runs health down to 0 and ends the hunt', bled.health === 0 && bled.caught, bled);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
