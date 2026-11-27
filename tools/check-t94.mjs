// Blackwater Swamp check (#94). Run: npm run check:t94 [outDir]
// The second map loads with its terrain, water, fog and lighting; it's on the expedition choice; it
// has authored clue spots (Mothman's high claw marks, snapped limbs, wing dust, and owl-feather
// false leads). A whole hunt plays: examine Mothman sign, photograph and bag it, photograph the
// Mothman, drive out, and HQ verifies the evidence.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t94';
mkdirSync(out, { recursive: true });
const PORT = 4594;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(results.at(-1).slice(0, 240)); };
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

// Raise the camera (right mouse), wait, click; returns the newest log entry (+ toast text).
const snap = async () => {
  await page.waitForTimeout(900);                                   // shutter cooldown
  await page.evaluate(() => { __game.photo.wantRaised = true; });
  await page.waitForFunction(() => __game.photo.raised, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const g = __game, e = g.photo.snap();
    const toast = document.querySelector('.vf-toast, #photo-toast, .photo-toast')?.innerText ?? '';
    return e && { result: e.result, subject: e.subject, score: e.score, frame: e.frame, steadiness: e.steadiness, ev: e.evidence ?? null, clue: e.clueEvidence ?? null, toast };
  });
  await page.evaluate(() => { __game.photo.wantRaised = false; });
  return r;
};
const toastText = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('body *')].filter((el) => el.childElementCount === 0 && /^Frame \d+\/\d+/.test(el.textContent ?? ''));
  return els.at(-1)?.innerText ?? '';
});



await page.goto(`http://localhost:${PORT}/?map=swamp&nodebugai`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=swamp&nodebugai`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const map = await page.evaluate(() => {
  const g = __game;
  return { mapId: g.mapId, target: g.hunt.target, water: !!g.water, fog: !!g.scene.fog, fogType: g.scene.fog?.constructor?.name,
    lights: (() => { let n = 0; g.scene.traverse((o) => { if (o.isLight) n++; }); return n; })(),
    clues: g.clues.clues.map((c) => ({ type: c.type, who: c.cryptidId, y: +c.y.toFixed(2) })),
    picker: document.getElementById('map-picker')?.innerText ?? '' };
});
await page.screenshot({ path: `${out}/01-start-screen-expedition-choice.png` });
check('Blackwater Swamp loads as its own map with water, fog and night lighting', map.mapId === 'swamp' && map.water && map.fog && map.lights >= 3, { water: map.water, fog: map.fogType, lights: map.lights });
check('it is on the expedition choice (target: Mothman)', /Blackwater Swamp — target: Mothman/.test(map.picker) && map.target === 'Mothman', map.picker.split('\n').filter((l) => /Swamp/.test(l)));
const mothSigns = map.clues.filter((c) => c.who === 'mothman');
check('authored clue spots: Mothman claw marks and snapped limbs high on trunks, wing dust on its perches, plus false leads',
  mothSigns.filter((c) => c.type === 'scratch' && c.y > 2).length >= 2 && mothSigns.some((c) => c.type === 'branch') && mothSigns.filter((c) => c.type === 'wingDust').length >= 3 && map.clues.some((c) => c.type === 'owlFeather'),
  map.clues.map((c) => `${c.type}@${c.y}`));

await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  g.mothman.update = () => {}; g.chupacabra.update = () => {};
  g.chupacabra.mesh.position.set(-40, 0.3, 40);
  if (!g.flashlight.on) g.flashlight.toggle();
  window.__light = (on) => { if (g.flashlight.on !== on) g.flashlight.toggle(); g.flashlight.battery = 1; };
  // Stand at (x, z) on the deck and look at a point.
  window.__look = (x, y, z, tx, ty, tz) => {
    const p = g.player; p.position.set(x, y, z); p.velocity.set(0, 0, 0);
    const eye = y + p.eyeHeight;
    p.yaw = Math.atan2(-(tx - x), -(tz - z)); p.pitch = Math.atan2(ty - eye, Math.hypot(tx - x, tz - z));
  };
  window.__lookAtClue = (c, back = 2.2) => {
    const dx = Math.sin(c.object.rotation.y), dz = Math.cos(c.object.rotation.y);
    const onDeck = c.y < 1;   // dust lies on the boards: stand back along the walk
    const x = onDeck ? c.x + 1.6 : c.x + dx * back, z = onDeck ? c.z + 0.4 : c.z + dz * back;
    __look(x, onDeck ? c.y : 0.34, z, c.x, c.y + 0.03, c.z);
  };
});
// 1. Examine a high claw mark from the boardwalk.
const scratch = await page.evaluate(() => {
  const g = __game, c = g.clues.clues.find((k) => k.type === 'scratch' && k.cryptidId === 'mothman');
  __lookAtClue(c, 2.6); window.__scr = c; return { x: c.x, y: c.y, z: c.z };
});
await page.waitForTimeout(600);
const exam = await page.evaluate(() => { const g = __game; const r = g.clueFinder.examine(); return { ok: !!r, entries: g.journal.entries.map((e) => e.text ?? e.label ?? e.clue?.type) }; });
await page.screenshot({ path: `${out}/02-examine-high-claw-marks.png` });
check('you can examine Mothman\'s high claw marks from the boardwalk (journal entry)', exam.ok, { scratch, exam });
// 2. Photograph and bag wing dust on the bridge.
await page.evaluate(() => { const g = __game, c = g.clues.clues.find((k) => k.type === 'wingDust'); window.__dust = c; __lookAtClue(c); __light(true); });
const dustShot = await snap();
await page.screenshot({ path: `${out}/03-wing-dust-on-the-bridge.png` });
await page.evaluate(() => { const g = __game, c = __dust; __look(c.x + 1.2, c.y, c.z, c.x, c.y, c.z); });
await page.waitForTimeout(500);
const bag = await page.evaluate(() => { const r = __game.evidence.collect(); return r && { type: r.type, name: r.name }; });
check('wing dust photographs as disturbance evidence and can be bagged as a scale sample', dustShot?.clue?.type === 'EV04' && bag?.type === 'scaleSample', { photo: dustShot?.clue?.type, Q: dustShot?.clue?.quality?.Q, bag });
// 3. Photograph the Mothman perched on the bridge.
await page.evaluate(() => {
  const g = __game, m = g.mothman.mesh;
  m.position.set(0, 7, -24); m.visible = true;
  __look(0, 0.34 + 0.3 * 7, -15, 0, 7, -24);
});
const moth = await snap();
await page.screenshot({ path: `${out}/04-mothman-on-the-bridge.png` });
check('the Mothman can be photographed in the swamp', moth?.result === 'HIT' && moth.subject === 'Mothman', moth && { result: moth.result, subject: moth.subject });
// 4. Drive out.
await page.evaluate(() => { const g = __game, v = g.HUNT.exit; g.player.position.set(v.x + 1, 0.34, v.z - 1); });
await page.waitForFunction(() => __game.hunt.inZone, null, { timeout: 20000 });
await page.keyboard.press('KeyH'); await page.waitForTimeout(300); await page.keyboard.press('KeyH');
await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 20000 });
await page.waitForTimeout(800);
const end = await page.evaluate(() => { const h = __game.camp.lastHunt; return { outcome: h.outcome, target: h.target, v: (h.verification ?? []).map((x) => `${x.name}, ${x.subject}: ${x.verdict} ${x.gradeName} $${x.value}`), earned: h.earned }; });
await page.evaluate(() => document.querySelector('#photo-album')?.remove());
await page.screenshot({ path: `${out}/05-results-after-the-swamp-hunt.png` });
check('a whole hunt plays: you drive out and HQ verifies the Mothman photo and the sign you brought home', end.outcome === 'complete' && end.target === 'Mothman' && end.v.some((l) => /Creature photo, Mothman: accepted/.test(l)) && end.v.some((l) => /Scale sample, Mothman: accepted/.test(l)), end);

check('no page errors', errors.length === 0, errors);
console.log('\n' + results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
