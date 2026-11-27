// Evidence quality grades and HQ verification check (#99). Run: npm run check:t99 [outDir]
// Through the real camera in Pine Hollow: a sharp, lit photo of Bigfoot, a dark one minutes later,
// and a clear close photo of the red-fox track (an ordinary-animal false lead). Drive home: HQ
// verification lists every entry with its grade and reason. The fox photo is REJECTED however
// sharp it is, the dark photo grades low and says "too dark", and the field UI shows no $ amounts.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t99';
mkdirSync(out, { recursive: true });
const PORT = 4599;
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


await setup(true);
await page.evaluate(() => { __pose(9); __light(true); });
const good = await snap();
await page.evaluate(() => { __game.hunt.elapsed += 120; __pose(9); __light(false); });
const dark = await snap();
await page.evaluate(() => {
  const g = __game, L = g.map.landmarks.campsite, x = L.x + 3, z = L.z + 3;
  __bf.mesh.visible = false;
  window.__clue = (c, d, pitch) => {
    const p = g.player, px = c.x, pz = c.z + d;
    p.position.set(px, g.map.heightAt?.(px, pz) ?? 0, pz); p.velocity.set(0, 0, 0);
    p.yaw = 0; p.pitch = pitch;
  };
  window.__fox = g.clues.spawn('foxTrack', { cryptidId: 'fox', position: { x, y: 0, z }, rotationY: 0, data: {} });
  __clue(__fox, 1.4, -0.9); __light(true);
});
const fox = await snap();
await shot('01-fox-track-photo-in-field');
const field = await page.evaluate(() => ({ text: document.body.innerText, item: __game.evidence.items.find((i) => i.clueId === __fox.id) ?? null }));
check('the clear fox-track photo is saved as evidence with good quality (Q 60+)', fox?.clue && fox.clue.quality.Q >= 60 && !!field.item, fox?.clue && { Q: fox.clue.quality.Q, item: field.item?.name });
check('the field never shows the hidden source tag or a sale amount', !/fox \(ordinary|ordinary animal|red fox/i.test(field.text) && !/\$\d/.test(field.text.replace(/BASE CAMP[^\n]*/g, '')), field.text.match(/.*(fox|ordinary|\$\d).*/gi)?.slice(0, 4) ?? []);

// Drive home: manifest review then out.
await page.evaluate(() => { const g = __game, v = g.HUNT.exit; g.player.position.set(v.x + 1, 0, v.z + 1); });
await page.waitForFunction(() => __game.hunt.inZone, null, { timeout: 20000 });
await page.keyboard.press('KeyH');
await page.waitForTimeout(300);
const manifest = await page.evaluate(() => document.body.innerText);
await shot('02-extraction-manifest');
check('the extraction manifest names no dollar value for the evidence', !/\$\d/.test(manifest.replace(/BASE CAMP[^\n]*/g, '').replace(/Trip cost[^\n]*/gi, '')), manifest.match(/.*\$\d.*/g)?.slice(0, 3) ?? []);
await page.keyboard.press('KeyH');
await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 20000 });
await page.waitForTimeout(800);
const hq = await page.evaluate(() => ({ v: __game.camp.lastHunt.verification, screen: __game.hunt.endBody?.innerText ?? '' }));
await shot('03-hq-verification');
console.log(hq.v.map((x) => `${x.name} ${x.subject} ${x.verdict} ${x.gradeName} ${x.reason} $${x.value}`).join('\n'));
const foxRow = hq.v.find((x) => x.name === 'Footprint photo');
check('ACCEPTANCE: the clear photo of the ordinary-animal track is rejected at HQ, with the reason, and pays $0',
  foxRow?.verdict === 'rejected' && foxRow.grade >= 3 && /ordinary animal: a red fox/.test(foxRow.reason) && foxRow.value === 0, foxRow);
const photos = hq.v.filter((x) => x.name === 'Creature photo');
const darkRow = photos.find((x) => /too dark/.test(x.reason));
check('ACCEPTANCE: the dark photo grades low (Weak or Inconclusive) with the visible reason "too dark"', darkRow && darkRow.grade <= 1, photos.map((x) => [x.gradeName, x.reason, x.value]));
const best = photos.reduce((a, x) => (x.value > (a?.value ?? -1) ? x : a), null);
check('the sharp lit photo is accepted at a high grade and paid by the GDD offer (T $250 x 0.01 x 35 x M)', best?.verdict === 'accepted' && best.grade >= 3 && best.value === Math.floor(250 * 0.01 * 35 * [0, 0.25, 0.55, 0.8, 1][best.grade] + 0.5 + 1e-9), best);
check('HQ verification screen lists every entry with its grade and reason', /HQ VERIFICATION/.test(hq.screen) && /REJECTED, ordinary animal: a red fox/.test(hq.screen) && /too dark/.test(hq.screen) && hq.v.length >= 3,
  hq.screen.split('\n').filter((l) => /HQ|photo,|REJECTED/.test(l)).slice(0, 8));
await page.evaluate(() => document.querySelector('#photo-album')?.remove());
await shot('04-hq-verification-results');

check('no page errors', errors.length === 0, errors);
console.log('\n' + results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
