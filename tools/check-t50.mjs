// Photo scoring check. Run: npm run check:t50 [outDir]
// Each photo is scored on centring, size in frame, visibility (not hidden) and camera motion.
// A close, centred, still shot must score > 80; a far, blurry one < 30. Also shows each factor
// on its own: off-centre, half hidden behind a wall, and turning the camera while you shoot.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t50';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4369', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

const open = async (q) => {
  await page.goto(`http://localhost:4369/?nodebugai&${q}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
    if (g.huntFailure) g.huntFailure.enabled = false;
    for (const c of g.cryptids.cryptids) c.update = () => {};
    g.fear.update = () => {};
  });
  await page.mouse.move(470, 270); await page.waitForTimeout(300); // park the pointer so later jiggles stay small
};
// Bigfoot at (bx, bz); you at (px, pz), looking at its middle turned by yawOff; fear set.
const setup = ({ bx, bz, px, pz, yawOff = 0, fear = 0 }) => page.evaluate(([bx, bz, px, pz, yawOff, fear]) => {
  const g = __game, b = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'), p = g.player;
  b.agent.x = bx; b.agent.z = bz; b.syncMesh?.();
  p.position.set(px, 0, pz); p.velocity.set(0, 0, 0);
  const dx = bx - px, dz = bz - pz;
  p.yaw = -Math.atan2(dx, -dz) + yawOff;
  p.pitch = Math.atan2(b.profile.height * 0.5 - 1.68, Math.hypot(dx, dz));
  g.fear.value = fear;
}, [bx, bz, px, pz, yawOff, fear]);
// Raise, (optionally keep turning the view), snap, lower. Returns the logged photo.
const photo = async (name, { pan = false } = {}) => {
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => __game.photo.raised, null, { timeout: 30000 });
  await page.waitForFunction((pan) => __game.photo.cooldown === 0 && (pan || __game.fear.value > 35 || __game.photo.lookSpeed < 0.5),
    pan, { timeout: 30000 }); // ready, and (for a still shot) settled after re-aiming
  const n = await page.evaluate(() => __game.photo.log.length);
  if (pan) for (let i = 0; i < 12; i++) { await page.mouse.move(470 + (i % 2) * 20, 270); await page.waitForTimeout(60); } // small fast jiggles
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(500);
  await shot(name);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  return page.evaluate((n) => { const e = __game.photo.log[n]; return e && { result: e.result, score: e.score, parts: e.parts, distance: +e.distance.toFixed(1) }; }, n);
};

// Forest: the straight trail from the trailhead north gives a long clear view.
await open('map=forest');
await setup({ bx: 0, bz: 112, px: 0, pz: 124 });
const close = await photo('01-close-centred-still');
check('close, centred, still shot scores more than 80', close?.score > 80, close);
await setup({ bx: 0, bz: 100, px: 0, pz: 146, fear: 95 });
const far = await photo('02-far-blurry', { pan: true });
check('far, blurry shot (terrified, turning the camera) scores less than 30', far?.result === 'HIT' && far.score < 30, far);
await setup({ bx: 0, bz: 112, px: 0, pz: 124, yawOff: 0.22 });
const offc = await photo('03-off-centre');
check('off-centre loses centring points', offc?.parts.centring < close.parts.centring - 25 && offc.score < close.score, offc);
await setup({ bx: 0, bz: 112, px: 0, pz: 124 });
const pan = await photo('04-turning-while-shooting', { pan: true });
check('turning the camera while shooting blurs it (steadiness drops)', pan?.parts.steadiness < 80 && pan.score < close.score, pan);
await setup({ bx: 0, bz: 112, px: 0, pz: 140 });
const mid = await photo('05-further-away-smaller');
check('further away = smaller in frame = lower size points', mid?.parts.size < close.parts.size && mid.score < close.score, mid);

// Test yard: Bigfoot behind the 3 m wall, only its head showing.
await open('');
await setup({ bx: -8, bz: -17.5, px: -8, pz: -4 });
const hidden = await photo('06-mostly-hidden-behind-wall');
check('mostly hidden behind a wall loses visibility points', hidden?.result === 'HIT' && hidden.parts.visibility < 60 && hidden.score < close.score, hidden);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
