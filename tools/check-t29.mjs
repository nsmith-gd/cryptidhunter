// Night-vision goggles: see in the dark without light, narrower view, drains the battery, and
// cryptids don't react to them the way they react to the flashlight. Run: npm run check:t29
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t29';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4330', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const lum = () => page.evaluate(() => {
  const src = __game.renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const w = Math.floor(c.width * 0.3), h = Math.floor(c.height * 0.3);
  const d = g.getImageData(Math.floor(c.width * 0.35), Math.floor(c.height * 0.35), w, h).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return +(s / (d.length / 4)).toFixed(1);
});
const setup = async (q = '') => {
  await page.goto(`http://localhost:4330/?nodebugai&loadout=nightVision,spareBatteries,bait,trailCamera${q}`); // pack the goggles (#27 loadout)
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false; });
};

// ---- Seeing in the dark (Pine Hollow at night) ----
await setup('&map=forest');
await page.evaluate(() => {
  const g = __game; g.cryptids.update = () => {};
  const p = g.player; p.position.set(-45 + 14, 0, 68 + 9); p.yaw = Math.atan2(14, 9); p.pitch = 0.02;  // looking at the cabin
  if (g.flashlight.on) g.flashlight.toggle();
});
await page.waitForTimeout(600);
const dark = await lum();
await page.screenshot({ path: `${out}/01-cabin-naked-eye-light-off.png` });
const fov0 = await page.evaluate(() => __game.camera.fov);
await page.keyboard.press('KeyV');
await page.waitForTimeout(600);
const nvg = await lum();
const fov1 = await page.evaluate(() => __game.camera.fov);
await page.screenshot({ path: `${out}/02-cabin-night-vision.png` });
check('night vision shows the dark scene without any light', nvg > dark * 2.5 && nvg > 35, { dark, nvg, flashlightOn: false });
check('night vision narrows the view', fov1 < fov0 - 15, { fov0, fov1 });
// Deeper in the trees, too.
await page.evaluate(() => { const p = __game.player; p.position.set(28, 0, -16); p.yaw = Math.atan2(6, 24); p.pitch = 0.0; });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/03-creek-trail-night-vision.png` });

// ---- Battery ----
// (Step the goggles by game time: software rendering in CI runs slower than real time.)
const drain = await page.evaluate(() => {
  const g = __game, f = g.flashlight; f.battery = 1;
  g.nightVision.update(9);                       // 9 s of game time with the goggles on, torch off
  return { after9s: +f.battery.toFixed(3), torchOn: f.on };
});
check('night vision drains the battery, faster than the torch (10% in 9 s vs 7.5%)', !drain.torchOn && Math.abs(drain.after9s - 0.9) < 0.002, drain);
await page.evaluate(() => { __game.flashlight.battery = 0.004; });
await page.waitForTimeout(1200);
const dead = await page.evaluate(() => ({ on: __game.nightVision.on, fov: __game.camera.fov, battery: __game.flashlight.battery }));
check('at 0% battery the goggles switch off and the view widens again', !dead.on && dead.fov === fov0, dead);
await page.keyboard.press('KeyV');
const stillOff = await page.evaluate(() => __game.nightVision.on);
check('they won\'t switch on with a dead battery', !stillOff, { stillOff });

// ---- The camera still zooms from the goggle view ----
await page.evaluate(() => { __game.flashlight.battery = 1; __game.nightVision.toggle(true); });
await page.mouse.down({ button: 'right' });
await page.waitForTimeout(500);
const raised = await page.evaluate(() => __game.camera.fov);
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(500);
const lowered = await page.evaluate(() => __game.camera.fov);
check('raising the photo camera through the goggles zooms in, then back to the goggle view', raised < 45 && Math.abs(lowered - 50) < 0.5, { raised, lowered });

// ---- Cryptid reaction: flashlight vs night vision (test yard, Bigfoot standing watching the lane) ----
async function approach({ nightVision, light }) {
  await setup();
  await page.evaluate(([nv, light]) => {
    const g = __game, b = g.cryptids.cryptids[0];
    b.noticesPlayer = () => false; b.think = () => {};          // senses only: measure, don't run off
    b.agent.x = -28; b.agent.z = 30; b.agent.stop(); b.agent.heading = -Math.PI / 2; b.perception.reset();
    const p = g.player; p.position.set(12, 0, 30); p.yaw = Math.PI / 2; p.pitch = 0;
    if (g.flashlight.on !== light) g.flashlight.toggle();
    g.nightVision.toggle(nv);
  }, [nightVision, light]);
  await page.evaluate(() => __game.input.keys.add('KeyW'));
  let r; const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    r = await page.evaluate(() => { const b = __game.cryptids.cryptids[0], pc = b.perception;
      return { d: +b.playerDistance.toFixed(1), detected: pc.detected, beam: +pc.beamLevel.toFixed(2), see: +pc.sightLevel.toFixed(2) }; });
    if (r.detected || r.d < 2) break;
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => __game.input.keys.delete('KeyW'));
  return r;
}
const withTorch = await approach({ nightVision: false, light: true });
const withNvg = await approach({ nightVision: true, light: false });
await page.waitForTimeout(100);
await page.screenshot({ path: `${out}/04-close-to-bigfoot-through-night-vision.png` });
console.log('spotted at (m):', JSON.stringify({ withTorch: withTorch.d, withNvg: withNvg.d }));
check('Bigfoot spots a torch from far off, but you get much closer with night vision', withTorch.detected && withTorch.d > 15 && withNvg.d < withTorch.d / 2.5, { withTorch, withNvg });
check('night vision gives no "lit up" signal to the cryptid (no beam)', withNvg.beam === 0, withNvg);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
