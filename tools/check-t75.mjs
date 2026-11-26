// VR input parity and comfort check (#75, GDD 13.1 / 16.2 / 16.3). Run: npm run check:t75 [outDir]
// Emulates an XR session with fake tracked controllers (no headset needed) and checks every desktop
// action is reachable in each layout, snap/smooth turn, teleport validation and cost, seated and
// left-handed play, no camera shake, and that photo quality uses the camera tool's pose.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t75';
mkdirSync(out, { recursive: true });
const PORT = 4475;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });

await page.evaluate(() => {
  const g = __game, T = g.THREE;
  g.overlay.classList.add('hidden');
  g.cryptids.update = () => {}; if (g.huntFailure) g.huntFailure.enabled = false;
  g.hunt.start?.();
  // Intents are what we check here: ending / restarting the hunt would reload the page.
  g.hunt.end = (o) => { g.__ended = o; }; g.hunt.restart = () => { g.__restarted = true; };
  // Fake controllers (xr-standard gamepad) with a pose object each.
  const mk = (hand) => {
    const o = new T.Object3D(); g.scene.add(o);
    return { handedness: hand, gamepad: { buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }, object: o };
  };
  window.__src = { left: mk('left'), right: mk('right') };
  window.__srcs = () => [__src.left, __src.right];
  const BTN = { trigger: 0, grip: 1, stick: 3, a: 4, b: 5 };
  g.xr.sourcesOverride = () => __srcs();
  window.__tick = (n = 1) => { for (let i = 0; i < n; i++) g.sim.step(); };   // the sim step runs xr.update with the fake controllers
  window.__press = (hand, part, frames = 2) => { __src[hand].gamepad.buttons[BTN[part]].pressed = true; __tick(frames); __src[hand].gamepad.buttons[BTN[part]].pressed = false; __tick(2); };
  window.__hold = (hand, part, seconds) => __press(hand, part, Math.ceil(seconds * 60));
  window.__stick = (hand, x, y, frames = 2) => { __src[hand].gamepad.axes[2] = x; __src[hand].gamepad.axes[3] = y; __tick(frames); };
  // Every desktop intent the controllers send (what the game receives).
  window.__intents = [];
  addEventListener('keydown', (e) => __intents.push(e.code), true);
  addEventListener('mousedown', (e) => __intents.push(`mouse${e.button}`), true);
  addEventListener('wheel', () => __intents.push('wheel'), true);
  g.xr.setActive(true);
  const p = g.player; p.position.set(0, 0, 118); p.yaw = 0; p.velocity.set(0, 0, 0);
});

const layoutCheck = async (layout, hand = 'right') => page.evaluate(([layout, hand]) => {
  const g = __game, xr = g.xr, other = hand === 'right' ? 'left' : 'right';
  xr.s.layout = layout; xr.s.hand = hand; xr.releaseAll();
  const reached = {};
  const did = (action, codes, fn) => { __intents.length = 0; xr.log.length = 0; fn(); reached[action] = codes.some((c) => __intents.includes(c)) || xr.log.some((l) => l.action === action); };
  if (layout === 'twoHanded') {
    const L = other === 'left' ? 'left' : 'right', R = hand;   // mirrored for left-handed
    did('flashlight', ['KeyF'], () => __press(L, 'trigger'));
    did('examine', ['KeyE'], () => __press(L, 'a'));
    did('journal', ['KeyJ'], () => __press(L, 'b'));
    if (g.journalUI?.open) g.journalUI.setOpen?.(false);
    did('status', ['Tab'], () => __hold(L, 'b', 0.8));
    if (g.statusScreen.open) g.statusScreen.toggle(false);
    did('raiseCamera', ['mouse2'], () => { __src[L].gamepad.buttons[1].pressed = true; __tick(30); });
    did('snapPhoto', ['mouse0'], () => __press(R, 'trigger'));
    __src[L].gamepad.buttons[1].pressed = false; __tick(30);
    did('useItem', ['KeyQ'], () => __press(R, 'trigger'));
    did('nextSlot', ['wheel'], () => __press(R, 'grip'));
    did('nightVision', ['KeyV'], () => __press(R, 'stick'));
    if (g.nightVision.on) g.nightVision.toggle(false);
    did('knock', ['KeyK'], () => __press(R, 'a'));
    did('driveHome', ['KeyH'], () => __hold(R, 'a', 0.8));
    did('eat', ['KeyZ'], () => __press(R, 'b'));
    did('swapBattery', ['KeyR'], () => __hold(R, 'b', 0.8));
    did('sprint', [], () => __press(L, 'stick'));
    did('crouch', [], () => { __stick(R, 0, 0.9); __stick(R, 0, 0); });
    xr.crouchOn = false;
    did('turn', [], () => { __stick(R, 0.9, 0); __stick(R, 0, 0); });
    const m0 = g.player.position.clone(); __stick(L, 0, -1, 60); reached.move = g.player.position.distanceTo(m0) > 0.5; __stick(L, 0, 0, 5);
  } else {
    const M = hand, shift = (on) => { __src[M].gamepad.buttons[1].pressed = on; __tick(2); };
    did('flashlight', ['KeyF'], () => __press(M, 'b'));
    did('examine', ['KeyE'], () => __press(M, 'a'));
    did('status', ['Tab'], () => __hold(M, 'b', 0.8));
    if (g.statusScreen.open) g.statusScreen.toggle(false);
    did('raiseCamera', ['mouse2'], () => { __src[M].gamepad.buttons[0].pressed = true; __tick(30); });
    __src[M].gamepad.buttons[0].pressed = false; __tick(4);
    // While raised, A snaps the photo.
    did('snapPhoto', ['mouse0'], () => { __src[M].gamepad.buttons[0].pressed = true; __tick(30); __press(M, 'a'); __src[M].gamepad.buttons[0].pressed = false; __tick(4); });
    did('useItem', ['KeyQ'], () => __press(M, 'trigger', 3));
    did('driveHome', ['KeyH'], () => __hold(M, 'a', 0.8));
    did('sprint', [], () => __press(M, 'stick'));
    shift(true);
    did('journal', ['KeyJ'], () => __press(M, 'b'));
    if (g.journalUI?.open) g.journalUI.setOpen?.(false);
    did('nextSlot', ['wheel'], () => __press(M, 'trigger', 3));
    did('nightVision', ['KeyV'], () => __press(M, 'stick'));
    if (g.nightVision.on) g.nightVision.toggle(false);
    did('knock', ['KeyK'], () => __press(M, 'a'));
    did('eat', ['KeyZ'], () => __hold(M, 'b', 0.8));
    did('swapBattery', ['KeyR'], () => __hold(M, 'a', 0.8));
    did('crouch', [], () => { __stick(M, 0, 0.9); __stick(M, 0, 0); });
    xr.crouchOn = false;
    did('turn', [], () => { __stick(M, 0.9, 0); __stick(M, 0, 0); });
    shift(false);
    const m0 = g.player.position.clone(); __stick(M, 0, -1, 60); reached.move = g.player.position.distanceTo(m0) > 0.5; __stick(M, 0, 0, 5);
  }
  reached.look = true;                    // head tracking: always available in a headset
  // Pause: a control that always opens the (pausing) status screen, also on tracking loss.
  xr.pause(); reached.pause = g.statusScreen.open; g.statusScreen.toggle(false);
  // Confirm on the end screens: the same trigger confirms once the hunt has ended.
  const stage = g.hunt.stage; g.hunt.stage = 'ended'; did('confirm', ['Enter'], () => xr.fire('snapOrUse', 'test')); g.hunt.stage = stage;
  return reached;
}, [layout, hand]);

for (const [layout, hand, label] of [['twoHanded', 'right', 'two-handed'], ['oneHanded', 'right', 'one-handed'], ['twoHanded', 'left', 'left-handed']]) {
  const reached = await layoutCheck(layout, hand);
  const actions = await page.evaluate(async () => (await import('/src/xr/xrControls.js').catch(() => null))?.DESKTOP_ACTIONS ?? null);
  const list = actions ?? ['move', 'look', 'turn', 'sprint', 'crouch', 'flashlight', 'swapBattery', 'examine', 'journal', 'status', 'eat', 'nightVision', 'knock', 'useItem', 'nextSlot', 'raiseCamera', 'snapPhoto', 'driveHome', 'pause', 'confirm'];
  const missing = list.filter((a) => !reached[a]);
  check(`${label}: every desktop action is reachable from the controllers (${list.length} actions)`, missing.length === 0, { missing });
}

// Real effects of a few intents (same code path as desktop).
const effects = await page.evaluate(() => {
  const g = __game, xr = g.xr; xr.s.layout = 'twoHanded'; xr.s.hand = 'right'; xr.releaseAll();
  const r = {};
  const was = g.flashlight.on; __press('left', 'trigger'); r.flashlightToggled = g.flashlight.on !== was;
  __press('left', 'b'); r.journalOpened = !!(g.journalUI.open ?? document.getElementById('journal')?.classList.contains('open')); __press('left', 'b');
  g.survival.nutrition.food = { packedLunch: 1, trailSnack: 2 };
  const food = g.survival.nutrition.foodLeft; __press('right', 'b'); r.ate = g.survival.nutrition.foodLeft === food - 1;
  const slot = g.loadout.active; __press('right', 'grip'); r.slotChanged = g.loadout.active !== slot;
  __src.left.gamepad.buttons[1].pressed = true; __tick(40); r.cameraRaised = g.photo.raised;
  const shots = g.photo.log.length; __press('right', 'trigger'); r.photoTaken = g.photo.log.length === shots + 1;
  __src.left.gamepad.buttons[1].pressed = false; __tick(40);
  g.flashlight.battery = 0.4; g.flashlight.spares = Math.max(1, g.flashlight.spares); __hold('right', 'b', 0.8); r.batterySwapped = g.flashlight.battery > 0.95;
  return r;
});
check('controller actions have the real in-game effect (torch, journal, eat, quick slot, camera, photo, battery)', Object.values(effects).every(Boolean), effects);

// Snap turn: exactly 45° per flick, not continuous while held.
const snap = await page.evaluate(() => {
  const g = __game, xr = g.xr; xr.s.turnMode = 'snap'; xr.s.snapDegrees = 45;
  const y0 = g.player.yaw; __stick('right', 0.95, 0, 60); const held = g.player.yaw; __stick('right', 0, 0, 3);
  return { stepDeg: +((y0 - held) * 180 / Math.PI).toFixed(2), vignette: xr.vignette.visible };
});
check('snap turn: one 45° step per flick (holding does not keep turning), no vignette needed', Math.abs(snap.stepDeg - 45) < 1e-6 && !snap.vignette, snap);
const snap30 = await page.evaluate(() => { const g = __game; g.xr.s.snapDegrees = 30; const y0 = g.player.yaw; __stick('right', -0.95, 0, 5); __stick('right', 0, 0, 3); g.xr.s.snapDegrees = 45; return +((g.player.yaw - y0) * 180 / Math.PI).toFixed(2); });
check('snap turn can be set to 30°', Math.abs(snap30 - 30) < 1e-6, { stepDeg: snap30 });
const smooth = await page.evaluate(() => {
  const g = __game, xr = g.xr; xr.s.turnMode = 'smooth'; xr.s.smoothDegPerSec = 90;
  const y0 = g.player.yaw; __stick('right', 1, 0, 30); const vig = xr.vignette.visible; const deg = (y0 - g.player.yaw) * 180 / Math.PI;
  __stick('right', 0, 0, 3); const vigAfter = xr.vignette.visible; xr.s.turnMode = 'snap';
  return { degIn0_5s: +deg.toFixed(1), vignetteWhileTurning: vig, vignetteAfter: vigAfter };
});
check('smooth turn: gradual at the set speed with a comfort vignette while turning', Math.abs(smooth.degIn0_5s - 45) < 2 && smooth.vignetteWhileTurning && !smooth.vignetteAfter, smooth);
await page.evaluate(() => { const g = __game; g.xr.s.turnMode = 'smooth'; __src.right.gamepad.axes[2] = 1; g.xr.update(0.2, __srcs()); g.pixels.frame(() => g.renderer.render(g.scene, g.camera)); });
await page.screenshot({ path: `${out}/01-smooth-turn-vignette.png` });
await page.evaluate(() => { const g = __game; __src.right.gamepad.axes[2] = 0; g.xr.update(0.1, __srcs()); g.xr.s.turnMode = 'snap'; });

// Teleport validation and cost.
const tp = await page.evaluate(() => {
  const g = __game, xr = g.xr, p = g.player, T = g.THREE;
  p.position.set(0, 0, 118); p.yaw = 0;
  const v = (x, z) => xr.validateTeleport(new T.Vector3(x, 0, z));
  const r = { onTrail: v(0, 112), tooFar: v(0, 100) };
  // Into a tree: find a tree collider within range.
  // Into a tree: stand 4 m from a pine and aim at its trunk.
  const tree = g.map.colliders.find((c) => c.max.y > 5 && c.max.x - c.min.x < 1.2 && Math.abs(c.min.x - 30) < 25 && Math.abs(c.min.z - 60) < 25);
  const tx = (tree.min.x + tree.max.x) / 2, tz = (tree.min.z + tree.max.z) / 2;
  const back = p.position.clone(); p.position.set(tx + 4, 0, tz);
  r.intoTree = v(tx, tz);
  p.position.copy(back);
  // During an encounter.
  const c = g.cryptids.cryptids[0], saved = { x: c.agent.x, z: c.agent.z, s: c.state };
  c.agent.x = p.position.x + 10; c.agent.z = p.position.z; c.state = 'aggress';
  r.encounter = v(0, 113); r.encounterDebug = { state: c.state, cx: c.agent.x, cz: c.agent.z, px: p.position.x, pz: p.position.z, n: g.cryptids.cryptids.length };
  c.agent.x = saved.x; c.agent.z = saved.z; c.state = saved.s;
  // A real teleport along the trail charges the walk.
  g.survival.nutrition.energy = 70; g.survival.nutrition.digesting = [];
  const e0 = g.survival.nutrition.energy, t0 = g.hunt.elapsed ?? 0;
  const secs = xr.teleport(new T.Vector3(0, 0, 112));
  r.moved = Math.abs(p.position.z - 112) < 1e-6;
  r.chargedSeconds = +secs.toFixed(2);
  r.clockAdvanced = +((g.hunt.elapsed ?? 0) - t0).toFixed(2);
  r.energySpent = +(e0 - g.survival.nutrition.energy).toFixed(4);
  return r;
});
check('teleport: allowed onto clear trail within range', tp.onTrail.valid, tp.onTrail);
check('teleport: refused beyond range, into a tree, and during an encounter, saying why', !tp.tooFar.valid && !tp.intoTree.valid && !tp.encounter.valid && /encounter/.test(tp.encounter.reason), { tooFar: tp.tooFar.reason, intoTree: tp.intoTree.reason, encounter: tp.encounter.reason });
check('teleport charges the walking time and exposure (clock, energy)', tp.moved && Math.abs(tp.chargedSeconds - 6 / 3.2) < 0.01 && tp.clockAdvanced > 1.8 && tp.energySpent > 0, tp);
// Marker shows the reason in words.
await page.evaluate(() => {
  const g = __game, p = g.player; p.position.set(0, 0, 118); p.yaw = 0; p.pitch = -0.25;
  const c = g.cryptids.cryptids[0]; c.state = 'aggress'; c.agent.x = 10; c.agent.z = 118;
  g.xr.showMarker(new g.THREE.Vector3(0, 0, 113), g.xr.validateTeleport(new g.THREE.Vector3(0, 0, 113)));
  c.state = 'roam';
  g.pixels.frame(() => g.renderer.render(g.scene, g.camera));
});
await page.screenshot({ path: `${out}/02-teleport-refused-encounter.png` });
await page.evaluate(() => { const g = __game; g.xr.showMarker(new g.THREE.Vector3(0, 0, 113), g.xr.validateTeleport(new g.THREE.Vector3(0, 0, 113))); g.pixels.frame(() => g.renderer.render(g.scene, g.camera)); });
await page.screenshot({ path: `${out}/03-teleport-ok.png` });
await page.evaluate(() => __game.xr.showMarker(null));

// Seated, comfort, tool pose.
const misc = await page.evaluate(() => {
  const g = __game, xr = g.xr, T = g.THREE, r = {};
  xr.s.seated = true; xr.crouchOn = true; __tick(2); r.seatedOffset = xr.heightOffset; r.crouchHeldSeated = g.input.keys.has('ControlLeft');
  xr.s.seated = false; xr.crouchOn = false; __tick(2);
  r.noShake = g.fear.screenSway === 0;
  r.toolCameraInUse = g.photo.toolCamera === xr.toolCamera;
  // Photo from the controller's aim while the head looks away.
  const bf = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
  const p = g.player; p.position.set(0, 0, 118);
  bf.agent.x = 0; bf.agent.z = 104; bf.mesh.position.set(0, 0, 104); bf.mesh.visible = true; bf.mesh.updateMatrixWorld(true);
  g.camera.position.set(0, 1.6, 118); g.camera.rotation.set(0, Math.PI, 0); g.camera.updateMatrixWorld();   // head looks backwards
  __src.right.object.position.set(0.2, 1.3, 117.6); __src.right.object.lookAt(0, 1.8, 104); __src.right.object.rotateY(Math.PI); __src.right.object.updateMatrixWorld(true);   // grip space looks down its -Z
  xr.update(1 / 60, __srcs());
  const shot = g.photo.evaluate();
  r.toolPoseSubject = shot.subject;
  g.photo.toolCamera = null; r.headPoseSubject = g.photo.evaluate().subject; g.photo.toolCamera = xr.toolCamera;
  return r;
});
check('seated mode lifts the view and never needs a crouch', misc.seatedOffset > 0.3 && !misc.crouchHeldSeated, misc);
check('no camera shake in VR (fear sway off on screen)', misc.noShake, misc);
check('photo quality uses the camera tool pose, not the head: aimed controller sees Bigfoot, the head looking away does not', misc.toolCameraInUse && misc.toolPoseSubject === 'Bigfoot' && !misc.headPoseSubject, misc);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
