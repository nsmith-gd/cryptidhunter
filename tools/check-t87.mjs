// Field kit (#87). Run: npm run check:t87 [outDir]
// Buys the new gear at the base-camp shop (real buttons), packs it, commits a Pine Hollow hunt and
// uses every item with its real key: binoculars (O), signal whistle (Y), field recorder (P),
// headlamp (I), and from quick slots with Q: emergency bivy, dry clothes, fire kit. Checks each
// one's effect, and that a recording sells at base camp after driving out.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t87';
mkdirSync(out, { recursive: true });
const PORT = 4387;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${n}.png` }); };
const base = `http://localhost:${PORT}/?map=forest&seed=87&nodebugai&simpaused`;
const load = async (q = '') => { await page.goto(base + q); await page.waitForFunction(() => window.__game && document.getElementById('shop-panel'), null, { timeout: 180000 }); };
const go = () => page.evaluate(() => {
  const g = __game; g.expedition.commit(); g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
  g.fear.update = () => {};
  const b = g.cryptids.cryptids[0]; b.update = () => {}; b.agent.x = 140; b.agent.z = -140;
});
const toast = () => page.evaluate(() => document.body.innerText.split('\n').filter((l) => /whistle|Recorder|Recorded|Headlamp|bivy|Bivy|Dry clothes|fire|Changing/i.test(l)).slice(-3).join(' | '));

// ---- Shop: buy the kit ----
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await load();
await page.evaluate(() => { __game.camp.state.money = 400; __game.camp.save(); __game.shop.render(); });
for (const k of ['binoculars', 'fieldRecorder', 'headlamp', 'bivy', 'fireKit']) await page.click(`#shop-panel button[data-kind="gear"][data-key="${k}"]`);
const shop = await page.evaluate(() => ({ gear: { ...__game.camp.state.gear }, cash: __game.camp.state.money, text: document.getElementById('shop-panel').innerText }));
await page.screenshot({ path: `${out}/01-shop-field-kit.png` });
check('the shop sells the field kit at GDD prices; durable items are bought once (OWNED); the starter kit has dry clothes and a whistle',
  shop.gear.binoculars === 1 && shop.gear.fieldRecorder === 1 && shop.gear.headlamp === 1 && shop.gear.bivy === 1 && shop.gear.fireKit === 6
  && shop.gear.dryClothes >= 1 && shop.gear.whistle >= 1 && shop.cash === 400 - 45 - 75 - 45 - 22 - 12 && /OWNED/.test(shop.text), shop);
const again = await page.evaluate(() => { const before = __game.camp.state.money; document.querySelector('#shop-panel button[data-key="binoculars"]').click(); return { before, after: __game.camp.state.money }; });
check('buying binoculars twice is refused', again.before === again.after, again);

// ---- Hunt 1: the hotkey items ----
await load('&loadout=binoculars,whistle,fieldRecorder,headlamp');
await go();
const fov0 = await page.evaluate(() => __game.camera.fov);
await page.keyboard.press('KeyO'); await steps(5);
const bino = await page.evaluate(() => ({ fov: __game.camera.fov, overlay: document.getElementById('binocular-overlay').style.display }));
await shot('02-binoculars');
await page.mouse.move(550, 380);
await page.mouse.down({ button: 'right' }); await steps(20); await page.mouse.up({ button: 'right' }); await steps(30);
const binoDown = await page.evaluate(() => ({ on: __game.fieldKit.binocularsOn, fov: __game.camera.fov }));
check('O raises the binoculars (much narrower view, eyepiece mask); raising the camera lowers them again', bino.fov < 20 && fov0 > 60 && bino.overlay === 'block' && !binoDown.on && binoDown.fov > 60, { fov0, bino, binoDown });

// Whistle: Bigfoot 45 m away, unaware, hears it.
await page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids[0];
  delete b.update;   // let it think again
  b.update = Object.getPrototypeOf(b).update.bind(b);
  const p = g.player.position; b.agent.x = p.x + 45; b.agent.z = p.z; b.agent.stop(); b.perception.reset(); b.enterRoam('test');
});
await steps(30);
await page.keyboard.press('KeyY'); await steps(20);
const whistle = await page.evaluate(() => { const b = __game.cryptids.cryptids[0]; return { radius: __game.player.noiseRadius, heard: b.perception.lastHeard != null, stage: b.stage, state: b.state, why: b.lastWhy, log: __game.fieldKit.log.map((l) => l.what) }; });
check('Y blows the whistle: a 60 m blast that Bigfoot hears from 45 m and comes to check out', whistle.heard && whistle.log.includes('blast') && ['investigate', 'observe', 'flee'].includes(whistle.state), whistle);
await page.evaluate(() => { const b = __game.cryptids.cryptids[0]; b.update = () => {}; });

// Field recorder: knocks 30 m away, first not recording (nothing), then recording (EV07).
const knockAt = (d) => page.evaluate((d) => { const g = __game, b = g.cryptids.cryptids[0], p = g.player.position; b.agent.x = p.x + d; b.agent.z = p.z; g.knocks.cryptidKnock(b, 'call'); }, d);
await steps(6 * 60);   // let the whistle's racket die down: your own noise spoils a recording
await knockAt(30); await steps(2);
const ev0 = await page.evaluate(() => __game.evidence.items.filter((i) => i.type === 'audioRecording').length);
await page.keyboard.press('KeyP'); await steps(2);
await knockAt(30); await steps(2);
const rec = await page.evaluate(() => __game.evidence.items.filter((i) => i.type === 'audioRecording').map((i) => ({ name: i.name, ev: i.evId, q: i.quality, sound: i.sound })));
await knockAt(85); await steps(2);
const recFar = await page.evaluate(() => __game.fieldKit.recordings.map((r) => r.quality));
check('P records: a wood knock 30 m away becomes an acoustic recording (EV07) only while recording; further away, lower quality', ev0 === 0 && rec.length === 1 && rec[0].ev === 'EV07' && rec[0].q > 0.4 && (recFar.length === 1 || recFar[1] < rec[0].q), { ev0, rec, recFar });

// Headlamp: wider, shorter, slower drain.
const lamp0 = await page.evaluate(() => { const L = __game.flashlight.light; return { angle: L.angle, distance: L.distance, life: __game.flashlight.batteryLife }; });
await page.keyboard.press('KeyI'); await steps(5);
const lamp1 = await page.evaluate(() => { const L = __game.flashlight.light; return { angle: L.angle, distance: L.distance, life: __game.flashlight.batteryLife, on: __game.flashlight.on }; });
await shot('03-headlamp');
check('I switches to the headlamp: wider beam, shorter reach, longer battery life', lamp1.on && lamp1.angle > lamp0.angle && lamp1.distance < lamp0.distance && lamp1.life > lamp0.life, { lamp0, lamp1 });
await page.keyboard.press('KeyI'); await steps(2);

// Drive out: the recording sells.
await page.evaluate(() => { const g = __game, e = g.HUNT.exit; g.player.position.set(e.x, 0, e.z); g.player.velocity.set(0, 0, 0); });
await steps(25 * 60);
await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH'); await steps(2);
const sold = await page.evaluate(() => (__game.camp.lastHunt?.evidenceSold ?? []).map((e) => `${e.name} $${e.value}`));
check('the recording is carried out and sells at base camp', sold.some((s) => /Acoustic recording/.test(s)), sold);

// ---- Hunt 2: the quick-slot items (Q) ----
await load('&loadout=bivy,dryClothes,fireKit,whistle');
await go();
const q = async (slot) => { await page.keyboard.press(`Digit${slot}`); await page.keyboard.press('KeyQ'); await steps(2); };
await page.evaluate(() => { const g = __game, p = g.player; p.position.set(0, 0, 104); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = -0.2; });
await steps(5);
await q(1);
await steps(30);
const bivy = await page.evaluate(() => ({ at: !!__game.fieldKit.bivyAt, near: __game.survival.thermo.nearHeat }));
await shot('04-emergency-bivy');
await page.evaluate(() => { __game.player.position.x += 3; }); await steps(5);
const bivyGone = await page.evaluate(() => !__game.fieldKit.bivyAt);
check('Q with the bivy slotted: you shelter where you stand (counts as a heat source); moving off packs it away', bivy.at && bivy.near === 'emergency bivy' && bivyGone, { bivy, bivyGone });

await page.evaluate(() => { __game.survival.thermo.wetness = 80; });
await q(2);
await steps(6 * 60);
const dry = await page.evaluate(() => ({ wet: __game.survival.thermo.wetness, left: __game.fieldKit.carried.dryClothes }));
check('Q with dry clothes: a few seconds standing still and your wetness is gone (the bundle is used up)', dry.wet < 1 && dry.left === 0, dry);

const before = await page.evaluate(() => __game.fieldKit.carried.fireKit);
await q(3);
await steps(10);
const fire = await page.evaluate(() => { const g = __game, f = g.fieldKit.fires[0]; if (f) { g.player.position.set(f.x + 1.5, 0, f.z); } return { lit: !!f, left: g.fieldKit.carried.fireKit }; });
await steps(10);
const warm = await page.evaluate(() => __game.survival.thermo.nearHeat);
await page.evaluate(() => { const g = __game, f = g.fieldKit.fires[0]; g.player.position.set(f.x, 0, f.z + 3.5); g.player.yaw = 0; g.player.pitch = -0.25; g.flashlight.on && g.flashlight.toggle(); });
await steps(3);
await shot('05-fire');
await steps(245 * 60);
const out1 = await page.evaluate(() => __game.fieldKit.fires.length);
check('Q with the fire kit: a small fire in front of you that warms you, uses one of its 6 uses, and burns out after a few minutes',
  fire.lit && fire.left === before - 1 && warm === 'your fire' && out1 === 0, { before, fire, warm, out1 });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
