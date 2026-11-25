// Automated check for placeable bait. Run: npm run check:t11 [outDir]
// Presses G to drop bait, backs the player off, fast-forwards the AI and verifies Bigfoot walks
// to the bait, eats it (bait disappears), and still bolts if the player rushes it mid-meal.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t11';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4331', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4331/');
await page.waitForFunction(() => window.__game);
// Park the other placeholders, and run the cryptid AI only from the script (fixed steps).
await page.evaluate(() => {
  const g = __game;
  if (g.chupacabra) { g.chupacabra.update = () => {}; g.chupacabra.mesh.visible = false; }
  g.mothman.update = () => {}; g.mothman.mesh.position.set(0, 60, 0);
  g.realCryptidUpdate = g.cryptids.update.bind(g.cryptids);
  g.cryptids.update = () => {};
  g.overlay.classList.add('hidden');
  g.input.locked = true;   // pretend the mouse is captured so G works
});

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const bf = () => page.evaluate(() => {
  const c = __game.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  const b = __game.bait.baits[0];
  return { state: c.state, x: +c.agent.x.toFixed(1), z: +c.agent.z.toFixed(1),
    toBait: b ? +Math.hypot(b.x - c.agent.x, b.z - c.agent.z).toFixed(1) : null, baitsOnGround: __game.bait.baits.length, carried: __game.bait.carried };
});
// Simulate seconds of AI; the player is held at (px, pz) (or chases toward the bait if rush).
const simulate = (seconds, px, pz) => page.evaluate(([seconds, px, pz]) => {
  const g = __game, dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) { g.player.position.set(px, 0, pz); g.realCryptidUpdate(dt); g.bait.update(dt); }
}, [seconds, px, pz]);

// Let Bigfoot roam a bit first, far from the player.
await simulate(5, -36, 36);
const before = await bf();
check('roaming before any bait', before.state === 'roam' && before.baitsOnGround === 0, before);

// Stand in the open and press G: a bait cube lands in front of you.
await page.evaluate(() => { const p = __game.player; p.position.set(0, 0, 8); p.yaw = 0; p.pitch = -0.35; p.velocity.set(0, 0, 0); });
await page.waitForTimeout(200);
await page.keyboard.press('g');
await page.waitForTimeout(200);
const placed = await page.evaluate(() => ({ baits: __game.bait.baits.map((b) => ({ x: +b.x.toFixed(2), z: +b.z.toFixed(2) })), carried: __game.bait.carried }));
check('G drops a bait in front of the player', placed.baits.length === 1 && Math.abs(placed.baits[0].z - 6.4) < 0.05 && placed.carried === 2, placed);
await shot('01-bait-placed');

// Back off to the far corner and watch Bigfoot go for it.
const track = [];
const start = await (async () => { await simulate(0.5, -36, 36); return bf(); })();
track.push(start);
for (let i = 0; i < 40; i++) {
  await simulate(1, -36, 36);
  const s = await bf();
  track.push(s);
  if (s.toBait !== null && s.toBait < 6 && !track.some((t) => t.shot)) {
    // First-person view from a safe distance as it closes in.
    await page.evaluate(([x, z]) => { const p = __game.player; p.position.set(-3, 0, 15); p.yaw = Math.atan2(-(x + 3), -(z - 15)); p.pitch = -0.12; }, [s.x, s.z]);
    await page.waitForTimeout(300);
    await shot('02-bigfoot-walking-to-bait');
    s.shot = true;
  }
  if (s.toBait !== null && s.toBait < 2) break;
}
const arrived = track[track.length - 1];
check('Bigfoot switches to investigating the bait', track.some((t) => t.state === 'investigate'), track.map((t) => t.state).slice(0, 6));
check('Bigfoot walks toward the bait and reaches it', start.toBait - arrived.toBait > 3 && arrived.toBait < 2, { start: start.toBait, end: arrived.toBait, steps: track.length });

await page.evaluate(([x, z]) => { const p = __game.player; p.position.set(-2.5, 0, 12); p.pitch = -0.2; p.yaw = Math.atan2(-(x + 2.5), -(z - 12)); }, [arrived.x, arrived.z]);
await page.waitForTimeout(300);
await shot('03-bigfoot-eating-bait');

// It lingers to eat, then the bait is used up and it roams again.
await simulate(8, -36, 36);
const ate = await bf();
check('bait is eaten (gone) and Bigfoot roams again', ate.baitsOnGround === 0 && ate.state === 'roam', ate);

// A second bait, then rush it mid-investigation: fleeing still wins.
await page.evaluate(() => { const p = __game.player; p.position.set(-20, 0, 30); p.yaw = 0; });
await page.keyboard.press('g');
await simulate(2, -36, 36);
const lured2 = await bf();
await page.evaluate(([x, z]) => { const p = __game.player; p.position.set(x + 5, 0, z + 5); }, [lured2.x, lured2.z]);
await simulate(0.2, lured2.x + 5, lured2.z + 5);
const rushed = await bf();
check('rushing an investigating Bigfoot makes it flee', lured2.state === 'investigate' && rushed.state === 'flee', { lured2, rushed });

// Bait runs out after three.
await page.keyboard.press('g'); await page.keyboard.press('g');
const empty = await page.evaluate(() => ({ carried: __game.bait.carried, onGround: __game.bait.baits.length }));
check('only three baits per hunt', empty.carried === 0 && empty.onGround <= 3, empty);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
