// Event entitlements and the per-attempt ceiling check (#100). Run: npm run check:t100 [outDir]
// Hunt 1: photograph one Bigfoot footprint twice and Bigfoot once, drive home: the print pays once.
// Hunt 2 (same seed, same print): photograph the print again and a new Bigfoot sighting: the print
// is 'duplicate: $0', the new sighting pays at novelty 0.5. Every attempt's payout stays within T.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t100';
mkdirSync(out, { recursive: true });
const PORT = 4600;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(results.at(-1).slice(0, 240)); };
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

const setup = async (fresh) => {
  if (fresh) { await page.goto(`http://localhost:${PORT}/?map=forest&seed=8505&nodebugai`); await page.evaluate(() => localStorage.clear()); }
  await page.goto(`http://localhost:${PORT}/?map=forest&seed=8505&nodebugai`);
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = __game;
    g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
    g.cryptids.update = () => {};
    g.hunt.onRestart = () => {};
    window.__bf = g.cryptids.cryptids[0];
    // Bigfoot standing in the open at the campsite; you at `d` metres, looking at his chest.
    // The darkest landmark with the torch off (no lamps or fires nearby): the hollow, normally.
    window.__pose = (d = 9, { aimY = 2.3, ang = 0 } = {}) => {
      const L = g.map.landmarks.hollow, bf = __bf;
      bf.agent.x = L.x; bf.agent.z = L.z; bf.syncMesh(); bf.mesh.visible = true;
      const x = L.x + Math.sin(ang) * d, z = L.z + Math.cos(ang) * d, p = g.player;
      p.position.set(x, g.map.heightAt?.(x, z) ?? 0, z); p.velocity.set(0, 0, 0);
      p.yaw = Math.atan2(-(L.x - x), -(L.z - z));
      p.pitch = Math.atan2(aimY - (p.position.y + p.eyeHeight), d);
    };
    window.__light = (on) => { if (g.flashlight.on !== on) g.flashlight.toggle(); g.flashlight.battery = 1; };
  });
};
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



const helpers = () => page.evaluate(() => {
  const g = __game;
  window.__clue = (c, d, pitch) => { const p = g.player, px = c.x, pz = c.z + d; p.position.set(px, g.map.heightAt?.(px, pz) ?? 0, pz); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = pitch; };
  const L = g.map.landmarks.campsite;
  window.__fp = g.clues.spawn('footprint', { cryptidId: 'bigfoot', position: { x: L.x + 3, y: 0, z: L.z + 3 }, rotationY: 0, data: { length: 0.42, width: 0.2, toes: 5 } });
  return __fp.id;
});
const driveHome = async (name) => {
  await page.evaluate(() => { const g = __game, v = g.HUNT.exit; g.player.position.set(v.x + 1, 0, v.z + 1); });
  await page.waitForFunction(() => __game.hunt.inZone, null, { timeout: 20000 });
  await page.keyboard.press('KeyH'); await page.waitForTimeout(300); await page.keyboard.press('KeyH');
  await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('#photo-album')?.remove());
  await shot(name);
  return page.evaluate(() => { const h = __game.camp.lastHunt; return { v: h.verification, ceiling: h.ceiling, earned: h.earned, screen: __game.hunt.endBody?.innerText ?? '', book: __game.camp.state.entitlements }; });
};
const fpSnaps = async () => {
  await page.evaluate(() => { __bf.mesh.visible = false; __clue(__fp, 1.4, -0.9); __light(true); });
  const a = await snap();
  await page.evaluate(() => { __game.player.position.x += 0.2; });
  const b = await snap();
  return [a, b];
};

// ---- hunt 1 ----
await setup(true);
const id1 = await helpers();
await page.evaluate(() => { __pose(9); __light(true); });
await snap();
await page.evaluate(() => { __game.hunt.elapsed += 60; });
const [f1, f2] = await fpSnaps();
const h1 = await driveHome('01-hunt1-results');
const fpRows1 = h1.v.filter((x) => x.name === 'Footprint photo');
check('the same footprint photographed twice pays once', fpRows1.filter((x) => x.value > 0).length === 1 && fpRows1.reduce((a, x) => a + x.value, 0) > 0,
  { shots: [f1?.result, f2?.result], rows: fpRows1.map((x) => [x.entitlement, x.value]) });
check('hunt 1 payout stays within the attempt ceiling T', h1.ceiling && h1.ceiling.paid <= h1.ceiling.T, h1.ceiling);
check('entitlements are a plain serialisable object in the save', h1.book && JSON.stringify(JSON.parse(JSON.stringify(h1.book))) === JSON.stringify(h1.book) && Object.keys(h1.book.paid).length >= 2, Object.keys(h1.book?.paid ?? {}));

// ---- hunt 2: replay ----
await setup(false);
const id2 = await helpers();
await page.evaluate(() => { __game.hunt.elapsed += 300; __pose(9); __light(true); });
await snap();
await page.evaluate(() => { __game.hunt.elapsed += 60; });
await fpSnaps();
const h2 = await driveHome('02-hunt2-replay-results');
const fp2 = h2.v.find((x) => x.name === 'Footprint photo');
const bf2 = h2.v.find((x) => x.name === 'Creature photo' && x.value > 0);
check('a replay: the same print is the same event (same clue id after reload)', id1 === id2, { id1, id2 });
check('a replay pays only new events: the print is "duplicate: $0", a new sighting pays at novelty 0.5', fp2?.entitlement === 'duplicate' && fp2.value === 0 && bf2?.novelty === 0.5 && /duplicate: \$0/.test(h2.screen),
  { fp: fp2 && [fp2.entitlement, fp2.value], bf: bf2 && [bf2.entitlement, bf2.value, bf2.novelty] });
check('hunt 2 payout stays within the attempt ceiling T', h2.ceiling && h2.ceiling.paid <= h2.ceiling.T, h2.ceiling);
const clipped = [h1, h2].find((h) => h.ceiling?.clipped > 0);
check('when the attempt would pay more than T it is clipped and the results say so', !!clipped && /Attempt ceiling \$250 reached/.test(clipped.screen),
  { h1: h1.ceiling, h2: h2.ceiling, line: clipped?.screen.split('\n').find((l) => /ceiling/.test(l)) });

check('no page errors', errors.length === 0, errors);
console.log('\n' + results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
