// Camera & evidence capture check (#85). Run: npm run check:t85 [outDir]
// In Pine Hollow, through the real camera: a creature photo gets a GDD 4.5 quality snapshot
// (clarity, identification, completeness, provenance -> Q) measured from the game's light sources,
// and an evidence record (GDD 4.3) on the roll; the field preview names problems, not the species
// or a score; clue photos are validated and scored the same way; frames of one sighting share an
// event; drive home and the records are extracted into the career archive (kept across reloads);
// get caught and they're lost. The album reviews every frame's evidence.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t85';
mkdirSync(out, { recursive: true });
const PORT = 4585;
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

// ---- 1. a good creature photo: scored and saved as an evidence record ---------------------------
await page.evaluate(() => { __pose(9); __light(true); });
const good = await snap();
const goodToast = await toastText();
await shot('01-good-shot-preview');
const rec = good?.ev;
check('a creature photo becomes an EV03 evidence record on the roll (GDD 4.3 fields)', !!rec && rec.type === 'EV03' && rec.attemptId && rec.eventId && rec.location && rec.state === 'secured' && rec.device && rec.frame === good.frame,
  rec && { id: rec.id, type: rec.type, attempt: rec.attemptId, event: rec.eventId, state: rec.state, device: rec.device, at: rec.time });
check('it is scored at the shutter with the GDD 4.5 components: clarity, identification, completeness, provenance -> Q', rec && ['C', 'I', 'K', 'P'].every((k) => rec.quality[k] >= 0 && rec.quality[k] <= 1) && rec.quality.Q >= 60,
  rec?.quality && { C: rec.quality.C, I: rec.quality.I, K: rec.quality.K, P: rec.quality.P, Q: rec.quality.Q, light: rec.quality.light });
check('the field preview names no species and no score (film is judged when developed)', /^Frame \d+\/\d+/.test(goodToast) && !/Bigfoot|SCORE|score/i.test(goodToast), goodToast);

// ---- 2. light, night vision, head out of frame ---------------------------------------------------
await page.evaluate(() => { __pose(9); __light(false); });
const dark = await snap();
const darkToast = await toastText();
await shot('02-dark-shot-preview');
check('the same shot with the torch off is "too dark": lower clarity and Q, named in the preview', dark?.ev && dark.ev.quality.C < rec.quality.C - 0.3 && dark.ev.quality.Q < rec.quality.Q && /Too dark/.test(darkToast),
  { litC: rec.quality.C, darkC: dark?.ev?.quality.C, litQ: rec.quality.Q, darkQ: dark?.ev?.quality.Q, preview: darkToast });
check('in the dark his features can\'t be made out: identification drops too, coverage doesn\'t (a black frame is no proof)', dark?.ev && dark.ev.quality.I < rec.quality.I && dark.ev.quality.K === rec.quality.K && dark.ev.quality.Q < 60, { I: [rec.quality.I, dark?.ev?.quality.I], K: [rec.quality.K, dark?.ev?.quality.K], Q: [rec.quality.Q, dark?.ev?.quality.Q] });
await page.evaluate(() => { __pose(9); __light(false); __game.nightVision.toggle(true); });
const nv = await snap();
await page.evaluate(() => __game.nightVision.toggle(false));
check('night vision makes a dark subject readable (clarity back up)', nv?.ev && nv.ev.quality.C > dark.ev.quality.C + 0.2, { darkC: dark?.ev?.quality.C, nightVisionC: nv?.ev?.quality.C });
await page.evaluate(() => { __pose(7, { aimY: 0.4 }); __light(true); });
const low = await snap();
check('aiming at his legs (head out of the shot) lowers identification and says so', low?.ev && low.ev.quality.I < rec.quality.I && /Head not in the shot|hidden or cut off/.test(low.ev.quality.problems.join()), low?.ev && { I: low.ev.quality.I, problems: low.ev.quality.problems });

// ---- 3. one sighting = one event ------------------------------------------------------------------
const events = await page.evaluate(() => __game.photo.records.filter((r) => r.kind === 'creature').map((r) => r.eventId));
check('frames of the same sighting share one event ID (not independent evidence)', new Set(events).size === 1 && events.length >= 4, events);
const later = await page.evaluate(() => { __game.hunt.elapsed += 120; return null; });
await page.evaluate(() => { __pose(9); __light(true); });
const second = await snap();
check('a later sighting (minutes on) is a new event', second?.ev && second.ev.eventId !== events[0], { first: events[0], later: second?.ev?.eventId });

// ---- 4. clue photos: validated and scored ----------------------------------------------------------
const clueSetup = await page.evaluate(() => {
  const g = __game, L = g.map.landmarks.campsite, x = L.x + 3, z = L.z + 3;
  __bf.mesh.visible = false;
  const fp = g.clues.spawn('footprint', { cryptidId: 'bigfoot', position: { x, y: 0, z }, rotationY: 0, data: { length: 0.42, width: 0.2, toes: 5 } });
  const deer = g.clues.spawn('deerTrack', { cryptidId: 'deer', position: { x: x + 6, y: 0, z }, rotationY: 0, data: {} });
  window.__clue = (c, d, pitch) => {
    const p = g.player, px = c.x, pz = c.z + d;
    p.position.set(px, g.map.heightAt?.(px, pz) ?? 0, pz); p.velocity.set(0, 0, 0);
    p.yaw = 0; p.pitch = pitch;
  };
  window.__fp = fp; window.__deer = deer;
  return { fp: fp.id, deer: deer.id };
});
await page.evaluate(() => { __clue(__fp, 1.6, -0.82); __light(true); });
const fpClose = await snap();
await shot('03-footprint-close-from-above');
await page.evaluate(() => { const g = __game; g.evidence.items = g.evidence.items.filter((i) => i.clueId !== __fp.id); __clue(__fp, 6.2, -0.26); });
const fpFar = await snap();
check('a footprint photo is validated, scored and saved as EV01 (close and from above)', fpClose?.clue?.type === 'EV01' && fpClose.clue.quality.Q >= 60 && fpClose.clue.source.kind === 'clue',
  fpClose?.clue && { Q: fpClose.clue.quality.Q, comps: [fpClose.clue.quality.C, fpClose.clue.quality.I, fpClose.clue.quality.K, fpClose.clue.quality.P], problems: fpClose.clue.quality.problems });
check('from far away and low, the same print scores lower and the preview says why', fpFar?.clue && fpFar.clue.quality.Q < fpClose.clue.quality.Q - 15 && /Too far|from above/.test(fpFar.clue.quality.problems.join()),
  fpFar?.clue && { Q: fpFar.clue.quality.Q, problems: fpFar.clue.quality.problems });
await page.evaluate(() => { __clue(__deer, 1.6, -0.82); });
const deerShot = await snap();
const deerItem = await page.evaluate(() => __game.evidence.items.some((i) => i.clueId === __deer.id));
check('deer tracks: the photo stays on the roll (source: ordinary animal) but is no cryptid evidence to sell', deerShot?.clue && /deer/.test(deerShot.clue.source.actual) && !deerItem, deerShot?.clue && { source: deerShot.clue.source, saleable: deerItem });

// ---- 5. storage and review: extract (drive home) -> archive; review the album ---------------------
const before = await page.evaluate(() => __game.photo.records.length);
await page.evaluate(() => { const g = __game, v = g.HUNT.exit; g.player.position.set(v.x + 1, 0, v.z + 1); });
await page.waitForFunction(() => __game.hunt.inZone, null, { timeout: 20000 });
await page.keyboard.press('KeyH');
await page.waitForFunction(() => __game.hunt.stage === 'ended', null, { timeout: 20000 });
await page.waitForTimeout(800);
const ext = await page.evaluate(() => {
  const g = __game, recs = g.photo.records;
  return { states: [...new Set(recs.map((r) => r.state))], archived: g.evidenceArchive.records.length, outcome: g.hunt.outcome,
    album: [...document.querySelectorAll('#photo-album .ev')].map((e) => e.innerText.replace(/\s+/g, ' ')) };
});
await page.evaluate(() => document.getElementById('photo-album')?.scrollIntoView());
await page.waitForTimeout(300);
await shot('04-album-review-after-extraction');
check('driving home extracts every record on the roll into the career evidence archive', ext.outcome === 'complete' && ext.states.length === 1 && ext.states[0] === 'extracted' && ext.archived === before, ext);
check('the album reviews each frame\'s evidence: type, Q and component bars', ext.album.length >= before && ext.album.every((t) => /EV0\d .* Q \d+/.test(t)), ext.album.slice(0, 4));
await setup(false);
const kept = await page.evaluate(() => ({ archived: __game.evidenceArchive.records.length, panel: document.getElementById('camp-panel')?.innerText ?? '', attempt: __game.huntAttemptId }));
await page.evaluate(() => { __game.overlay.classList.remove('hidden'); });
await page.waitForTimeout(300);
await shot('05-base-camp-archive');
check('the archive is kept in the save: after a reload, base camp shows it', kept.archived === before && /Evidence archive: \d+ photo records? brought home · best quality \d+\/100/.test(kept.panel), { archived: kept.archived, panel: kept.panel.split('\n').find((l) => /Evidence/.test(l)) });

// ---- 6. caught: the roll is lost --------------------------------------------------------------
await page.evaluate(() => { __game.overlay.classList.add('hidden'); __pose(9); __light(true); });
const s2 = await snap();
await page.evaluate(() => { const g = __game; g.huntFailure.enabled = true; g.hunt.end('caught'); });
await page.waitForTimeout(400);
const lost = await page.evaluate(() => ({ states: [...new Set(__game.photo.records.map((r) => r.state))], archived: __game.evidenceArchive.records.length }));
check('getting caught loses the roll: records marked lost and not archived', s2?.ev && lost.states.length === 1 && lost.states[0] === 'lost' && lost.archived === before, lost);

check('no page errors', errors.length === 0, errors);
console.log('\n' + results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
