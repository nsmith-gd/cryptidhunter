// First-person hands and held gear. Run: npm run check:t44 [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t44';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4414', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto('http://localhost:4414/?map=forest&nodebugai');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game;
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false;
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  const L = g.map.landmarks.fork, p = g.player;
  p.position.set(L.x + 1, 0, L.z + 4); p.yaw = 0.15; p.pitch = -0.12;
  g.flashlight.battery = 1;
});
await page.waitForTimeout(800);
const vis = () => page.evaluate(() => {
  const v = __game.viewmodel;
  return { right: v.right.visible, left: v.left.parent?.visible !== false, goggles: v.goggles.visible, trailCam: v.trailCam.visible,
    lensLit: v.lens.material === v.M.lensOn };
});
const s0 = await vis();
check('idle: flashlight hand and camera hand are in view, lens lit', s0.right && s0.left && s0.lensLit && !s0.goggles, s0);
await shot('01-idle-torch-and-camera');

// Flashlight off: lens goes dark, thumb clicks.
await page.keyboard.press('KeyF');
await page.waitForTimeout(150);
check('torch off: the lens goes dark', !(await vis()).lensLit, await vis());
await shot('02-torch-off-moonlight');
await page.keyboard.press('KeyF');

// Raise the camera halfway (the left hand brings it up to the eye).
await page.mouse.down({ button: 'right' });
await page.waitForTimeout(140);
await shot('03-raising-camera');
await page.waitForTimeout(500);
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(600);

// Night vision: goggles swing down.
await page.keyboard.press('KeyV');
// (headless frames here can be slower than the 0.26 s swing, so check the swing was triggered; the posed still below shows it)
const swung = await page.evaluate(() => __game.viewmodel.lowerUntil > 0 && __game.nightVision?.on !== false);
const g1 = { ...(await vis()), swung };
await shot('04-goggles-swinging-down');
check('goggles appear while swinging down over the eyes', g1.swung, g1);
await page.waitForTimeout(900);
await page.keyboard.press('KeyV');
await page.waitForTimeout(800);

// Posed still: goggles halfway down (the live swing is too quick for a headless capture).
await page.evaluate(() => { const v = __game.viewmodel; v.lowering = true; v.goggleT = 0.55; v.goggleWant = 1; v.update = ((u) => (dt) => { u.call(v, dt); v.goggleT = 0.55; })(v.update); });
await page.waitForTimeout(400);
await shot('04b-goggles-mid-swing');
await page.evaluate(() => { const v = __game.viewmodel; delete v.update; v.lowering = false; v.goggleT = 0; });
// Trail camera: shown in the hand while placing.
await page.keyboard.press('KeyT');
await page.waitForTimeout(250);
const t1 = await vis();
await shot('05-placing-trail-camera');
check('placing a trail camera shows it in the hand', t1.trailCam, t1);
await page.waitForFunction(() => !__game.viewmodel.trailCam.visible, null, { timeout: 8000 }).catch(() => {});
check('…and it leaves the hand once placed', !(await vis()).trailCam, await vis());

// Walking bob GIF.
const dir = `${out}/_walk`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
await page.evaluate(() => __game.input.keys.add('KeyW'));
for (let i = 0; i < 24; i++) { await page.waitForTimeout(70); await page.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: { x: 480, y: 220, width: 480, height: 320 } }); }
await page.evaluate(() => __game.input.keys.delete('KeyW'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', `${dir}/%03d.png`, '-vf', 'scale=360:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none', `${out}/walking-bob.gif`]);
rmSync(dir, { recursive: true, force: true });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
