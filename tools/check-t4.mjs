// Camera check. Run: npm run check:t4 [outDir]
// Right mouse raises the camera (zoomed viewfinder); left click while raised snaps a photo that
// logs HIT if a cryptid is inside the view frustum and not fully blocked, MISS otherwise.
// Uses real mouse buttons; Bigfoot is held still so each case is deterministic.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t4';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4344', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [], logs = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.text().startsWith('[photo]') && logs.push(m.text()));
await page.goto('http://localhost:4344/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  g.cryptids.cryptids[0].update = () => {}; // hold Bigfoot still
});

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

// Put Bigfoot at (bx, bz), the player at (px, pz), and look at Bigfoot's chest turned by yawOff radians.
const setup = (bx, bz, px, pz, yawOff = 0) => page.evaluate(([bx, bz, px, pz, yawOff]) => {
  const g = __game, b = g.cryptids.cryptids[0], p = g.player;
  b.agent.x = bx; b.agent.z = bz; b.syncMesh?.();
  p.position.set(px, 0, pz); p.velocity.set(0, 0, 0);
  const dx = bx - px, dz = bz - pz;
  p.yaw = -Math.atan2(dx, -dz) + yawOff;
  p.pitch = Math.atan2(1.4 - 1.68, Math.hypot(dx, dz));
}, [bx, bz, px, pz, yawOff]);
const raise = async () => {
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => __game.photo.raised, null, { timeout: 3000 });
  await page.waitForTimeout(150);
};
const lower = () => page.mouse.up({ button: 'right' });
const snap = async () => {
  const before = await page.evaluate(() => __game.photo.log.length);
  await page.waitForFunction(() => __game.photo.cooldown === 0, null, { timeout: 3000 });
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(450); // let the shutter flash fade before captures
  return page.evaluate((n) => {
    const e = __game.photo.log[n];
    return e ? { result: e.result, subject: e.subject, distance: +e.distance.toFixed(1), visible: `${e.visible}/${e.samples}`, reason: e.reason } : null;
  }, before);
};

// 1) Clicking without raising the camera takes no photo.
await setup(20, 20, 20, 40);
await page.waitForTimeout(300);
await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
await page.waitForTimeout(150);
const noRaise = await page.evaluate(() => ({ photos: __game.photo.log.length, label: document.querySelector('#photo-label').textContent }));
check('left click with the camera lowered takes no photo', noRaise.photos === 0, noRaise);
await shot('01-camera-lowered');

// 2) Right mouse raises it: zoomed viewfinder.
await raise();
const raised = await page.evaluate(() => ({ raised: __game.photo.raised, fov: +__game.camera.fov.toFixed(1), overlay: +getComputedStyle(document.querySelector('#viewfinder')).opacity }));
check('right mouse raises the camera into the viewfinder', raised.raised && raised.fov < 45 && raised.overlay > 0.9, raised);

// 3) Bigfoot in the middle of the frame, 20 m away: HIT.
await page.waitForTimeout(400);
const hit = await snap();
await shot('02-hit-bigfoot-centre');
check('photo of Bigfoot in frame logs a HIT', hit?.result === 'HIT' && hit.subject === 'Bigfoot', hit);

// 4) Bigfoot near the edge of the frame (15° off centre, frame is ~±33° wide): still a HIT.
await setup(20, 20, 20, 40, 0.26);
await page.waitForTimeout(400);
const edge = await snap();
await shot('03-hit-bigfoot-edge-of-frame');
check('Bigfoot near the edge of the frame still counts', edge?.result === 'HIT', edge);

// 5) Bigfoot just outside the frame (45° off): MISS.
await setup(20, 20, 20, 40, 0.79);
await page.waitForTimeout(300);
const outside = await snap();
await shot('04-miss-bigfoot-outside-frame');
check('Bigfoot outside the frame is a MISS', outside?.result === 'MISS', outside);

// 6) Bigfoot directly behind a 3 m wall, in the frame but blocked: MISS.
await setup(-8, -17.5, -8, -4);
await page.waitForTimeout(400);
const blocked = await snap();
await shot('05-miss-bigfoot-behind-wall');
check('Bigfoot hidden behind a wall is a MISS', blocked?.result === 'MISS' && /blocked/.test(blocked.reason), blocked);

// 7) Empty view: MISS.
await setup(20, 20, 20, 40, Math.PI);
await page.waitForTimeout(300);
const empty = await snap();
await shot('06-miss-empty-view');
check('photo of an empty view logs a MISS', empty?.result === 'MISS' && empty.reason === 'nothing in frame', empty);
await lower();
await page.waitForTimeout(400);
const lowered = await page.evaluate(() => ({ raised: __game.photo.raised, fov: +__game.camera.fov.toFixed(1) }));
check('releasing right mouse lowers the camera', !lowered.raised && lowered.fov > 70, lowered);

// 8) In the forest, Bigfoot behind a pine trunk is blocked; step aside and it's a HIT.
await page.goto('http://localhost:4344/?map=forest');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  for (const c of [g.chupacabra, g.mothman]) if (c) { c.update = () => {}; if (c.mesh) c.mesh.visible = false; }
  g.cryptids.cryptids[0].update = () => {};
});
// Find a thick trunk with a clear sightline: from 8 m south only that trunk is between you and
// Bigfoot (1.6 m behind it); from 5 m to the side nothing is.
const spot = await page.evaluate(() => {
  const cols = __game.map.colliders.filter((c) => c.max.y > 0.4);
  const hits = (ax, az, bx, bz) => {
    const out = new Set();
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
      for (const c of cols) if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z) out.add(c);
    }
    return out;
  };
  const trunks = cols.filter((c) => c.max.y > 8 && c.max.x - c.min.x > 0.95 && c.max.x - c.min.x < 1.2);
  for (const c of trunks) {
    const tx = (c.min.x + c.max.x) / 2, tz = (c.min.z + c.max.z) / 2;
    const bx = tx, bz = tz - 1.6, px = tx, pz = tz + 8;
    const front = hits(px, pz, bx, bz);
    const ok = front.size === 1 && front.has(c) && hits(px + 5, pz, bx, bz).size === 0
      && [0.7, -0.7].every((o) => hits(px + o, pz, bx + o, bz).size <= 1 && hits(bx + o, bz - 0.6, bx + o, bz + 0.6).size === 0)
      && hits(px - 0.5, pz, px + 5.5, pz).size === 0;
    if (ok) return { bx, bz, px, pz, trunkWidth: +(c.max.x - c.min.x).toFixed(2) };
  }
  return null;
});
if (spot) {
  await raise();
  await setup(spot.bx, spot.bz, spot.px, spot.pz);
  await page.waitForTimeout(400);
  const tree = await snap();
  await shot('07-forest-bigfoot-behind-trunk');
  await setup(spot.bx, spot.bz, spot.px + 5, spot.pz);
  await page.waitForTimeout(400);
  const aside = await snap();
  await shot('08-forest-step-aside-hit');
  await lower();
  check('forest: a pine trunk can hide Bigfoot (MISS), stepping aside gets the shot (HIT)',
    tree?.result === 'MISS' && aside?.result === 'HIT', { behindTrunk: tree, steppedAside: aside, spot });
} else check('forest: found a test trunk', false, null);

check('every shot was logged to the console', logs.length === (await page.evaluate(() => __game.photo.log.length)) + 5, logs);
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
console.log(logs.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
