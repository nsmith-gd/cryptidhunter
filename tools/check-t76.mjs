// Gamepad + accessibility settings check (#76). Run: npm run build && node tools/check-t76.mjs [outDir]
// A fake standard gamepad is injected (navigator.getGamepads) and a whole hunt is played with it only:
// start, walk, look, flashlight, examine a clue, raise the camera and photograph Bigfoot, open the
// map, walk to the van and drive home, confirm the end screen. Also: settings persist in the save,
// key remapping works with real key presses, brightness never changes detection, captions show.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t76';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4376', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
// Fake pad: window.__pad.buttons[i] / axes[i] are set by the test.
await ctx.addInitScript(() => {
  const pad = { id: 'Test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  window.__pad = pad;
  navigator.getGamepads = () => [pad];
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async (q = '') => { await page.goto(`http://localhost:4376/?map=forest&nodebugai&simpaused${q}`); await page.waitForFunction(() => window.__game, null, { timeout: 180000 }); };
// Press a pad button for a few frames, then release (real frames drive the pad poll).
// The test drives the game loop itself (?simpaused): each frame polls the pad, steps the world, draws.
const frames = (n) => page.evaluate((n) => { for (let k = 0; k < n; k++) __game.sim.frame(1 / 30); }, n);
const press = async (...btns) => {
  await page.evaluate((b) => { for (const i of b) { __pad.buttons[i].pressed = true; __pad.buttons[i].value = 1; } }, btns);
  await frames(3);
  await page.evaluate((b) => { for (const i of b) { __pad.buttons[i].pressed = false; __pad.buttons[i].value = 0; } }, btns);
  await frames(3);
};
const axes = (a) => page.evaluate((a) => { __pad.axes = a; }, a);

await load();
await page.evaluate(() => { localStorage.removeItem('cryptidhunter.save.json'); });
await load();
await page.evaluate(() => { const g = __game; g.huntFailure.enabled = false; if (g.fear) g.fear.update = () => {}; });

// --- 1) A whole hunt with only the gamepad ---------------------------------------------------
await page.screenshot({ path: `${out}/01-start-screen-settings.png`, timeout: 150000 });
await press(0);                                                   // A on the start screen: play
const started = await page.evaluate(() => ({ locked: __game.input.locked, hidden: __game.overlay.classList.contains('hidden'), stage: __game.hunt.stage }));
check('A on the start screen starts the hunt with no mouse or keyboard', started.locked && started.hidden && started.stage === 'search', started);

const p0 = await page.evaluate(() => ({ x: __game.player.position.x, z: __game.player.position.z, yaw: __game.player.yaw }));
await axes([0, -1, 0, 0]); await frames(40); await axes([0, 0, 0, 0]); await frames(3);
const p1 = await page.evaluate(() => ({ x: __game.player.position.x, z: __game.player.position.z, yaw: __game.player.yaw }));
await axes([0, 0, 1, 0]); await frames(20); await axes([0, 0, 0, 0]); await frames(3);
const p2 = await page.evaluate(() => ({ yaw: __game.player.yaw }));
check('left stick walks, right stick looks', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.5 && Math.abs(p2.yaw - p1.yaw) > 0.1, { moved: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2), turned: +(p2.yaw - p1.yaw).toFixed(2) });

const fl0 = await page.evaluate(() => __game.flashlight.on);
await press(2);                                                   // X: flashlight
const fl1 = await page.evaluate(() => __game.flashlight.on);
check('X toggles the flashlight', fl0 !== fl1, { before: fl0, after: fl1 });
if (!fl1) await press(2);

// Examine a clue: stand over the first one, look down at it, press A.
await page.evaluate(() => {
  const g = __game, c = g.clues.clues.find((x) => !x.found), p = g.player;
  p.position.set(c.x, 0, c.z + 1.2); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = -Math.atan2(1.68 - c.y, 1.2);
});
await frames(3);
const j0 = await page.evaluate(() => __game.journal.entries.length);
await press(0);                                                   // A: examine
const j1 = await page.evaluate(() => __game.journal.entries.length);
check('A examines a clue (logged in the journal)', j1 > j0, { before: j0, after: j1 });

// Photograph Bigfoot: it stands 9 m ahead; hold LT to raise the camera, RT to snap.
await page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'), p = g.player;
  g.cryptids.update = () => {};
  p.position.set(0, 0, 60); p.yaw = 0; p.pitch = 0.12;
  b.agent.x = 0; b.agent.z = 51; b.mesh.position.set(0, 0, 51); b.mesh.rotation.y = Math.PI;
  b.mesh.userData.animate?.(0.016, 0, 'observe');
});
await page.evaluate(() => { __pad.buttons[6].pressed = true; __pad.buttons[6].value = 1; });
await frames(50);
await press(7);
await frames(10);
await page.screenshot({ path: `${out}/02-gamepad-camera-raised.png`, timeout: 150000 });
await page.evaluate(() => { __pad.buttons[6].pressed = false; __pad.buttons[6].value = 0; });
await frames(30);
const shot = await page.evaluate(() => ({ photos: __game.hunt.photos.length, stage: __game.hunt.stage, best: __game.hunt.photo?.score ?? null }));
check('LT raises the camera and RT takes the photo of Bigfoot', shot.photos > 0 && shot.stage === 'extract', shot);

await press(12);                                                  // D-pad up: map
const mapUp = await page.evaluate(() => __game.fieldMap.held);
await page.screenshot({ path: `${out}/03-gamepad-map-up.png`, timeout: 150000 });
await press(12);
check('D-pad up raises and lowers the map', mapUp && !(await page.evaluate(() => __game.fieldMap.held)), { mapUp });

// Back to the van: stand in the ring, hold View + A to drive home, then A to confirm.
await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z + 1); });
await frames(5);
await page.evaluate(() => { __pad.buttons[8].pressed = true; __pad.buttons[8].value = 1; });
await frames(3);
await press(0);
await page.evaluate(() => { __pad.buttons[8].pressed = false; __pad.buttons[8].value = 0; });
await frames(5);
const end = await page.evaluate(() => ({ stage: __game.hunt.stage, outcome: __game.hunt.outcome, statusOpen: __game.statusScreen?.open ?? false }));
await page.screenshot({ path: `${out}/04-gamepad-hunt-complete.png`, timeout: 150000 });
check('View + A at the van drives home and ends the hunt (with the photo)', end.stage === 'ended' && end.outcome === 'complete' && !end.statusOpen, end);
const log = await page.evaluate(() => __game.gamepad.log.map((l) => l.action));
check('every step above came from the pad (no keyboard or mouse used)', log.includes('KeyE') && log.includes('KeyF') && log.includes('mouse2') && log.includes('KeyH'), log);

// --- 2) Settings persist in the save, and apply on load ---------------------------------------
await page.evaluate(() => __game.settings.set({ fov: 90, lookSensitivity: 1.5, invertY: true, reducedShake: true, brightness: 1.3, captions: true }));
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cryptidhunter.save.json')).settings);
await load();
const applied = await page.evaluate(() => ({ fov: __game.camera.fov, look: __game.player.lookScale, inv: __game.player.invertY, sway: __game.fear.screenSway,
  filter: __game.renderer.domElement.style.filter, money: JSON.parse(localStorage.getItem('cryptidhunter.save.json')).money }));
check('settings are saved in the save file and applied on the next load', saved?.fov === 90 && applied.fov === 90 && applied.look === 1.5 && applied.inv && applied.sway === 0 && /1.3/.test(applied.filter), { saved, applied });

// --- 3) Key remapping with real key presses ---------------------------------------------------
await page.evaluate(() => { const g = __game; g.settingsPanel.open(); });
await page.screenshot({ path: `${out}/05-settings-panel.png`, timeout: 150000 });
const remap = await page.evaluate(async () => {
  const g = __game;
  g.settingsPanel.waiting = 'flashlight';
  return true;
});
await page.keyboard.press('KeyX');                                 // bind flashlight to X
const bound = await page.evaluate(() => __game.settings.values.bindings);
await page.evaluate(() => { __game.input.locked = true; __game.overlay.classList.add('hidden'); });
const r0 = await page.evaluate(() => __game.flashlight.on);
await page.keyboard.press('KeyX');
const r1 = await page.evaluate(() => __game.flashlight.on);
await page.keyboard.press('KeyF');
const r2 = await page.evaluate(() => __game.flashlight.on);
check('rebinding: the flashlight moves to X, and F no longer toggles it', bound.flashlight === 'KeyX' && r0 !== r1 && r1 === r2, { bound, r0, r1, r2 });

// --- 4) Brightness never changes detection ----------------------------------------------------
const det = await page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'), per = b.perception;
  const run = (brightness) => {
    g.settings.set({ brightness });
    g.player.position.set(0, 0, 60); g.player.yaw = 0; g.player.pitch = 0;
    g.camera.position.set(0, 1.68, 60); g.camera.rotation.set(0, 0, 0); g.camera.updateMatrixWorld();
    if (!g.flashlight.on) g.flashlight.toggle();
    per.reset();
    const r = [];
    for (let i = 0; i < 60; i++) { per.update(1 / 30, 0, 45, 0); r.push([per.sightLevel, per.beamLevel, per.awareness].map((v) => +v.toFixed(6)).join(',')); }
    return { last: r[r.length - 1], all: r.join('|') };
  };
  const dim = run(0.6), bright = run(1.6);
  return { same: dim.all === bright.all, dim: dim.last, bright: bright.last };
});
check('brightness changes the picture only: detection is identical at 0.6 and 1.6', det.same, det);

// --- 5) Captions with a direction cue ---------------------------------------------------------
const cap = await page.evaluate(() => {
  const g = __game; g.settings.set({ captions: true });
  g.player.position.set(0, 0, 60); g.player.yaw = 0;
  g.audioLures.playCall({ x: 20, z: 60, cryptid: true });          // east of you, you face north
  const row = document.querySelector('#captions .cap');
  const text = row?.innerText ?? '';
  g.settings.set({ captions: false });
  g.audioLures.playCall({ x: -20, z: 60, cryptid: true });
  return { text, rows: document.querySelectorAll('#captions .cap').length, hasArrow: !!row?.querySelector('.dir i') };
});
check('a sound gets a caption with direction (whoop to the east: "to your right"), and captions can be turned off', /whoop/i.test(cap.text) && /right/.test(cap.text) && cap.hasArrow && cap.rows === 1, cap);
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
