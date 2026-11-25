// Perception: hearing (noise + distance) and sight (view cone, light level, flashlight).
// Walks the player straight at a stationary Bigfoot in different ways and records how close
// they got before it detected them. Run: npm run check:t21
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t21';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4325', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4325/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true;
  g.huntFailure.enabled = false;
  const b = g.cryptids.cryptids[0];
  b.noticesPlayer = () => false;   // measure detection without it running off
  b.think = () => {};              // ...or turning to stare: senses only
  b.tickRoam = () => {};
  b.findLure = () => false;
});
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// Bigfoot stands at (-28, 30). facing: 'toward' looks down the lane at the player, 'away' turns its back.
async function approach({ keys, light, facing = 'toward', shot, start = 40 }) {
  await page.evaluate(([light, facing, start]) => {
    const g = __game, b = g.cryptids.cryptids[0];
    b.agent.x = -28; b.agent.z = 30; b.agent.stop?.(); b.agent.heading = facing === 'toward' ? -Math.PI / 2 : Math.PI / 2;
    b.perception.reset(); b.perception.awareness = 0;
    const p = g.player; p.position.set(-28 + start, 0, 30); p.velocity.set(0, 0, 0); p.yaw = Math.PI / 2; p.pitch = 0;
    p.stamina = 1; p.exhausted = false; p.noise = 0;
    g.flashlight.battery = 1;
    if (g.flashlight.on !== light) g.flashlight.toggle();
  }, [light, facing, start]);
  await page.waitForTimeout(300);
  await page.evaluate((k) => k.forEach((c) => __game.input.keys.add(c)), keys);
  let r = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    r = await page.evaluate(() => {
      const b = __game.cryptids.cryptids[0], pc = b.perception;
      b.agent.heading = b.agent.heading; // hold facing
      return { d: +b.playerDistance.toFixed(1), detected: pc.detected, hear: +pc.hearLevel.toFixed(2), see: +pc.sightLevel.toFixed(2), beam: +pc.beamLevel.toFixed(2), aware: +pc.awareness.toFixed(2) };
    });
    if (r.detected || r.d < 1.6) break;
    await page.waitForTimeout(40);
  }
  if (shot) await page.screenshot({ path: `${out}/${shot}.png` });
  await page.evaluate((k) => k.forEach((c) => __game.input.keys.delete(c)), keys);
  return r;
}

const crouchDark = await approach({ keys: ['KeyW', 'ControlLeft'], light: false, start: 18, shot: '01-crouch-dark-detected-close' });
const walkDark = await approach({ keys: ['KeyW'], light: false });
const walkLight = await approach({ keys: ['KeyW'], light: true });
const sprintLight = await approach({ keys: ['KeyW', 'ShiftLeft'], light: true, shot: '02-sprint-light-detected-far' });
const crouchBehind = await approach({ keys: ['KeyW', 'ControlLeft'], light: false, start: 18, facing: 'away', shot: '03-crouch-behind' });
const sprintBehind = await approach({ keys: ['KeyW', 'ShiftLeft'], light: false, facing: 'away' });

const D = (r) => (r.detected ? r.d : 0);
console.log('detection distances (m):', JSON.stringify({ crouchDark: D(crouchDark), walkDark: D(walkDark), walkLight: D(walkLight), sprintLight: D(sprintLight), crouchBehind: D(crouchBehind), sprintBehind: D(sprintBehind) }));
check('crouching in the dark gets much closer than sprinting with the light on', D(crouchDark) < D(sprintLight) / 3, { crouchDark, sprintLight });
check('crouch-dark < walk-dark < walk-with-light', D(crouchDark) < D(walkDark) && D(walkDark) < D(walkLight), { crouchDark: D(crouchDark), walkDark: D(walkDark), walkLight: D(walkLight) });
check('sprinting with the light on is spotted from 20 m+', D(sprintLight) >= 20, sprintLight);
check('crouching in the dark still gets noticed up close (not invisible)', crouchDark.detected && crouchDark.d <= 6, crouchDark);
check('from behind, sight is out: crouching gets right up close', crouchBehind.detected && D(crouchBehind) <= 4, { crouchBehind, crouchDark });
check('from behind it still hears a sprint', sprintBehind.detected && sprintBehind.d >= 10 && sprintBehind.see === 0, sprintBehind);

// A box between you and it blocks sight (light on, standing still, in its cone).
const blocked = await page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids[0];
  // Box at (-12, 4) is 2 wide x 6 deep, 2.5 tall: put Bigfoot on one side, the player on the other.
  b.agent.x = -16; b.agent.z = 4; b.agent.heading = -Math.PI / 2; b.perception.reset();
  const p = g.player; p.position.set(-8, 0, 4); p.velocity.set(0, 0, 0); p.noise = 0;
  if (!g.flashlight.on) g.flashlight.toggle();
  return true;
});
await page.waitForTimeout(800);
const behindBox = await page.evaluate(() => { const pc = __game.cryptids.cryptids[0].perception; return { see: pc.sightLevel, aware: +pc.awareness.toFixed(2) }; });
check('a solid box blocks its line of sight', behindBox.see === 0, behindBox);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
