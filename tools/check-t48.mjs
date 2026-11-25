// Pine Hollow level flow: start at the trailhead, Bigfoot beds down in one of its spawn zones
// after walking a real route out of a clue zone, and the hunt ends at the extraction van.
// Plays one full hunt start to finish on ?map=forest. Run: npm run check:t48
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t48';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4327', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

// Several loads: zones are picked per hunt, every pick must give a usable level.
const picks = new Set();
for (let i = 0; i < 3; i++) {
  await page.goto('http://localhost:4327/?map=forest&nodebugai');
  await page.waitForFunction(() => window.__game);
  const r = await page.evaluate(() => {
    const g = __game, f = g.levelFlow, b = g.cryptids.cryptids[0], z = f.cryptidZone, cz = f.clueZone;
    const first = g.clues.clues.filter((c) => c.type === 'footprint').sort((a, c) => c.age - a.age)[0];
    return { zone: z?.name, clueZone: cz?.name, inZone: z && Math.hypot(b.agent.x - z.x, b.agent.z - z.z) <= z.r + 2,
      walked: f.preroll?.metres, clues: g.clues.clues.length,
      trailStartsInClueZone: !!first && Math.hypot(first.x - cz.x, first.z - cz.z) <= cz.r + 3 };
  });
  picks.add(`${r.clueZone} -> ${r.zone}`);
  check(`load ${i + 1}: Bigfoot beds down inside its zone after walking a real route from a clue zone`, r.inZone && r.walked > 40 && r.clues > 30 && r.trailStartsInClueZone, r);
}
console.log('zone picks seen:', [...picks].join(' | '));

// ---- One full hunt ----
await page.goto('http://localhost:4327/?map=forest&nodebugai');
await page.waitForFunction(() => window.__game);
const start = await page.evaluate(() => {
  const g = __game, p = g.player.position, L = g.map.landmarks, ex = g.map.exit;
  return { atTrailhead: Math.hypot(p.x - L.trailhead.x, p.z - L.trailhead.z) < 1, vanAtExit: Math.hypot(g.HUNT.exit.x - ex.x, g.HUNT.exit.z - ex.z) < 0.01,
    vanFromStart: +Math.hypot(ex.x - p.x, ex.z - p.z).toFixed(1), stage: g.hunt.stage };
});
check('player starts at the trailhead, van parked at the exit nearby', start.atTrailhead && start.vanAtExit && start.vanFromStart < 20 && start.stage === 'briefing', start);
await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); });
// Look back at the van from the start.
await page.evaluate(() => { const g = __game, p = g.player, ex = g.map.exit; p.position.set(ex.x - 4, 0, ex.z - 9); p.yaw = Math.atan2(-(ex.x - p.position.x), -(ex.z + 3 - p.position.z)); p.pitch = -0.05; });
await page.waitForTimeout(500);
await shot('01-extraction-van-at-trailhead');

// The lead: walk up to the start of the fresh trail and examine a print there.
const lead = await page.evaluate(() => {
  const { clues, player, clueFinder, levelFlow } = __game, cz = levelFlow.clueZone;
  const pool = clues.clues.filter((c) => c.type === 'footprint').sort((a, b) => Math.hypot(a.x - cz.x, a.z - cz.z) - Math.hypot(b.x - cz.x, b.z - cz.z));
  for (const c of pool.slice(0, 20)) {
    let ax = c.origin.x - c.x + 0.8, az = c.origin.z - c.z + 0.3; const l = Math.hypot(ax, az);
    const px = c.x + (ax / l) * 1.8, pz = c.z + (az / l) * 1.8;
    player.position.set(px, 0, pz); player.velocity.set(0, 0, 0);
    const dx = c.x - px, dz = c.z - pz;
    player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(c.y + 0.03 - player.eyeHeight, Math.hypot(dx, dz));
    player.update(0.0001);
    if (clueFinder.update() === c) return { id: c.id, age: Math.round(c.age) };
  }
  return null;
});
await page.waitForTimeout(300);
await shot('02-fresh-trail-in-clue-zone');
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
const hint = await page.evaluate(() => __game.journal.entries.at(-1)?.hint ?? null);
check('the trail starts in the clue zone and examining it says which way Bigfoot went', !!lead && /heading (north|south|east|west)/.test(hint ?? ''), { lead, hint });
await shot('03-trail-hint');

// Find Bigfoot in its zone and photograph it from a spot with a clear view.
let lined = false;
for (let i = 0; i < 16 && !lined; i++) {
  lined = await page.evaluate((i) => {
    const g = __game, b = g.cryptids.cryptids[0], p = g.player;
    const a = (i / 16) * Math.PI * 2, x = b.agent.x + Math.sin(a) * 18, z = b.agent.z + Math.cos(a) * 18;
    if (Math.abs(x) > 145 || Math.abs(z) > 145) return false;
    p.position.set(x, 0, z); p.velocity.set(0, 0, 0); p.update(0.001);
    const c = g.camera.position, dx = b.agent.x - c.x, dy = 1.5 - c.y, dz = b.agent.z - c.z;
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); p.update(0.001);
    return g.photo.evaluate().subject === 'Bigfoot';
  }, i);
}
await page.waitForTimeout(80);
await shot('04-bigfoot-in-its-zone');
await page.evaluate(() => { const g = __game, b = g.cryptids.cryptids[0], c = g.camera.position, p = g.player;
  const dx = b.agent.x - c.x, dz = b.agent.z - c.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(1.5 - c.y, Math.hypot(dx, dz)); });
await page.waitForTimeout(40);
await page.mouse.down({ button: 'right' }); // raise the camera (#4: hold right mouse, left-click to snap)
await page.waitForFunction(() => __game.photo.raised, null, { timeout: 3000 });
await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(150);
const photo = await page.evaluate(() => ({ stage: __game.hunt.stage, photo: __game.hunt.photo }));
check('Bigfoot photographed in its bed-down zone', lined && photo.stage === 'extract', photo);

// Back to the van: walk the last stretch into its green ring.
await page.evaluate(() => { const g = __game, p = g.player, ex = g.map.exit; p.position.set(ex.x, 0, ex.z - 12); p.velocity.set(0, 0, 0); p.yaw = Math.PI; p.pitch = -0.05; });
await page.waitForTimeout(200);
await shot('05-back-at-the-van');
await page.evaluate(() => __game.input.keys.add('KeyW'));
// (software rendering in CI is slow, especially in the forest: allow plenty of time for the walk)
await page.waitForFunction(() => __game.hunt.inZone, null, { timeout: 30000 }).catch(() => {});
await page.evaluate(() => __game.input.keys.delete('KeyW'));
await page.waitForTimeout(300);
await page.keyboard.press('KeyH');   // you choose when to drive home
await page.waitForTimeout(400);
const end = await page.evaluate(() => ({ outcome: __game.hunt.outcome, title: __game.hunt.endTitle.textContent }));
check('at the van with the photo, H drives home: HUNT COMPLETE', end.outcome === 'complete' && end.title === 'HUNT COMPLETE', end);
await shot('06-hunt-complete');

// Overhead debug view of the zones (F3): red = cryptid zones, amber = clue zones, green = exit.
await page.goto('http://localhost:4327/?map=forest&debug&nodebugai');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const { player, camera, scene, overlay } = __game;
  overlay.classList.add('hidden');
  player.update = () => {};
  scene.fog.far = 1000;
  camera.position.set(0, 330, 0); camera.rotation.set(-Math.PI / 2, 0, 0); camera.far = 1000; camera.updateProjectionMatrix();
});
await page.waitForTimeout(600);
await shot('07-overhead-zones-debug');

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
