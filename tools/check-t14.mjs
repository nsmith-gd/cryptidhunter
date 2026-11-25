// Greybox loop: briefing -> examine a clue -> photograph Bigfoot -> extract at the truck.
// Also dawn and give-up endings. Run: npm run check:t14
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t14';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4324', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async () => {
  await page.goto('http://localhost:4324/');
  await page.waitForFunction(() => window.__game);
};
const begin = () => page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); });
const st = () => page.evaluate(() => {
  const h = __game.hunt;
  return { stage: h.stage, outcome: h.outcome, photo: h.photo && +h.photo.distance.toFixed(1), clues: __game.journal.entries.length,
    hud: h.hud.textContent.split('\n')[0], clock: h.clock.textContent, screen: h.screen.style.display, title: h.endTitle.textContent };
});
// Aim the camera at a world point.
const aim = (x, y, z) => page.evaluate(([x, y, z]) => {
  const g = __game, c = g.camera.position, p = g.player;
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}, [x, y, z]);

// ---- Full successful loop ----
await load();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/01-briefing.png` });
const brief = await st();
check('starts on the briefing, no dawn clock yet', brief.stage === 'briefing' && brief.clock === '', brief);
check('default hunt has no Chupacabra/Mothman', await page.evaluate(() => !__game.chupacabra.mesh.visible && !__game.mothman.mesh.visible), {});
await begin();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/02-hunt-start-objective.png` });
const s0 = await st();
check('starting shows the objective and the dawn clock', s0.stage === 'search' && /Photograph Bigfoot/.test(s0.hud) && /dawn in 6:5\d/.test(s0.clock), s0);

// Bigfoot lays a trail; walk up to its newest footprint and examine it.
// (Pick one well away from Bigfoot: surprise it up close and it turns on you.)
const farPrint = () => { const b = __game.cryptids.cryptids[0].agent;
  return __game.clues.clues.find((c) => c.type === 'footprint' && Math.hypot(c.x - b.x, c.z - b.z) > 12); };
await page.waitForFunction(`(${farPrint.toString()})()`, null, { timeout: 30000 });
const clue = await page.evaluate(`(() => { const c = (${farPrint.toString()})(); return { x: c.x, y: c.y, z: c.z }; })()`);
await page.evaluate(([x, z]) => { const p = __game.player; p.position.set(x, 0, z + 1.6); p.velocity.set(0, 0, 0); }, [clue.x, clue.z]);
await page.waitForTimeout(100);
await aim(clue.x, clue.y, clue.z);
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/03-examine-track.png` });
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
const s1 = await st();
check('examining a track logs a clue', s1.clues === 1, s1);

// Spot Bigfoot from ~20 m (outside its 15 m flee range) and take the photo.
// (Examining the track may have spooked it; let it settle first.)
await page.evaluate(() => { __game.player.position.set(-35, 0, 35); });
await page.waitForFunction(() => __game.cryptids.cryptids[0].state === 'roam', null, { timeout: 15000 });
// Try spots 20 m away around it until one has a clear view (boxes can block the shot).
let lined = false;
for (let i = 0; i < 8 && !lined; i++) {
  lined = await page.evaluate((i) => {
    const g = __game, b = g.cryptids.cryptids[0], p = g.player;
    const a = (i / 8) * Math.PI * 2, x = b.agent.x + Math.sin(a) * 20, z = b.agent.z + Math.cos(a) * 20;
    if (Math.abs(x) > 37 || Math.abs(z) > 37) return false;
    p.position.set(x, 0, z); p.velocity.set(0, 0, 0);
    p.update(0.001);
    const c = g.camera.position, dx = b.agent.x - c.x, dy = 1.5 - c.y, dz = b.agent.z - c.z;
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.update(0.001);
    return g.photo.evaluate().subject === 'Bigfoot';
  }, i);
}
await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/04a-bigfoot-in-view.png` });
await aim(...await page.evaluate(() => { const b = __game.cryptids.cryptids[0]; return [b.agent.x, 1.5, b.agent.z]; }));
await page.mouse.down({ button: 'right' }); // raise the camera (#4)
await page.waitForFunction(() => __game.photo.raised, null, { timeout: 3000 });
await page.mouse.click(480, 270);
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}/04b-photo-snapped.png` });
const s2 = await st();
check('clicking with Bigfoot in frame takes the photo', s2.stage === 'extract' && s2.photo > 10 && /Return to the van/.test(s2.hud), s2);

// Head back to the truck and walk into the green ring.
await page.evaluate(() => { const p = __game.player; p.position.set(0, 0, -6); p.velocity.set(0, 0, 0); p.yaw = Math.PI; p.pitch = 0; });
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/05-back-to-truck.png` });
await page.evaluate(() => __game.input.keys.add('KeyW'));
await page.waitForFunction(() => __game.hunt.inZone, null, { timeout: 8000 }).catch(() => {});
await page.evaluate(() => __game.input.keys.delete('KeyW'));
await page.waitForTimeout(400);
const atVan = await st();
check('reaching the van with the photo does not end the hunt by itself (you choose)', atVan.stage === 'extract' && /\[H\] Drive home/.test(await page.evaluate(() => __game.hunt.hud.textContent)), atVan);
await page.screenshot({ path: `${out}/05b-at-the-van-choose-to-leave.png` });
await page.keyboard.press('KeyH');
await page.waitForTimeout(250);
const s3 = await st();
check('pressing H at the van with the photo completes the hunt', s3.outcome === 'complete' && s3.screen === 'flex' && s3.title === 'HUNT COMPLETE', s3);
await page.screenshot({ path: `${out}/06-hunt-complete.png` });
await page.waitForTimeout(700); // results screen ignores input for a moment so a held key can't skip it
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__game && __game.hunt.stage === 'briefing', null, { timeout: 8000 });
check('Space after the results starts a fresh hunt', true, {});

// ---- A miss doesn't count ----
await begin();
// Empty view: look directly away from Bigfoot (the viewfinder frame is wide, so anywhere near it counts).
await aim(...await page.evaluate(() => { const b = __game.cryptids.cryptids[0], p = __game.player.position;
  return [p.x - (b.agent.x - p.x), 1.5, p.z - (b.agent.z - p.z)]; }));
await page.mouse.down({ button: 'right' });
await page.waitForFunction(() => __game.photo.raised, null, { timeout: 3000 });
await page.mouse.click(480, 270);
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(100);
const miss = await st();
check('a photo of nothing keeps you searching', miss.stage === 'search' && miss.photo === null, miss);

// ---- Walking to the truck without a photo doesn't end it, but H (after a while) gives up ----
await page.evaluate(() => { __game.player.position.set(0, 0, 5.5); __game.hunt.elapsed = 25; });
await page.waitForTimeout(200);
const atTruck = await st();
check('truck without a photo: still hunting, give-up offered', atTruck.stage === 'search' && /\[H\]/.test(await page.evaluate(() => __game.hunt.hud.textContent)), atTruck);
await page.keyboard.press('KeyH');
await page.waitForTimeout(150);
const gaveUp = await st();
check('H ends the hunt as abandoned', gaveUp.outcome === 'abandoned' && gaveUp.title === 'HUNT ABANDONED', gaveUp);

// ---- Dawn ----
await load();
await begin();
await page.evaluate(() => { __game.hunt.elapsed = __game.hunt.constructor.name && 7 * 60 - 1; });
await page.waitForTimeout(1500);
const dawn = await st();
check('running out of night ends the hunt at dawn', dawn.outcome === 'dawn' && dawn.title === 'DAWN BROKE', dawn);
await page.screenshot({ path: `${out}/07-dawn-broke.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
