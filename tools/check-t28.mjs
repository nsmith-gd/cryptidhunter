// Trail camera + audio lure: both get results with the player far away.
// Run: npm run check:t28
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t28';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4329', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const load = async (q = '') => {
  await page.goto(`http://localhost:4329/?nodebugai${q}`);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => { const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false; });
};
const far = (x, z) => page.evaluate(([x, z]) => { const p = __game.player; p.position.set(x, 0, z); p.velocity.set(0, 0, 0); }, [x, z]);
const bfDist = (x, z) => page.evaluate(([x, z]) => { const b = __game.cryptids.cryptids[0]; return +Math.hypot(b.agent.x - x, b.agent.z - z).toFixed(1); }, [x, z]);

// ---------- 1. Trail camera alone ----------
await load();
await page.evaluate(() => {
  const g = __game, b = g.cryptids.cryptids[0];
  b.tickRoam = () => {}; b.agent.x = 20; b.agent.z = -27; b.agent.stop();
  g.trailCams.place({ x: 20, z: -3 }, 0);       // facing north (-z), down the lane Bigfoot will walk
});
await far(-30, 32);                               // ~60 m away, behind boxes: nowhere near
await page.evaluate(() => __game.cryptids.cryptids[0].agent.setDestination(20, -7));
await page.waitForFunction(() => __game.trailCams.photos.length > 0, null, { timeout: 25000 }).catch(() => {});
const tc = await page.evaluate(() => {
  const g = __game, ph = g.trailCams.photos[0], p = g.player.position;
  return { photo: ph && { subject: ph.subject, distance: +ph.distance.toFixed(1), score: ph.score, source: ph.source },
    playerToCam: +Math.hypot(p.x - 20, p.z + 3).toFixed(1), stage: g.hunt.stage, best: g.hunt.photo?.source };
});
check('trail camera photographs Bigfoot with the player 50 m+ away', tc.photo?.subject === 'Bigfoot' && tc.playerToCam > 50, tc);
check('a trail-camera shot counts as the hunt\'s photo of Bigfoot', tc.stage === 'extract' && /trail camera/.test(tc.best ?? ''), tc);
const scores = await page.evaluate(() => {
  const g = __game, ph = g.trailCams.photos[0];
  // Score the same framing as a handheld shot would get, for comparison.
  const handheld = Math.round(100 * Math.max(0, 1 - ph.distance / 60) ** 0.7 * Math.sqrt(ph.visible / ph.samples));
  return { trailCam: ph.score, handheldEquivalent: handheld };
});
check('trail-camera photos score lower than the same shot handheld', scores.trailCam > 0 && scores.trailCam < scores.handheldEquivalent, scores);
// Look at the camera from beside it, Bigfoot in front of it.
await page.evaluate(() => { const p = __game.player; p.position.set(22.5, 0, -0.5); p.yaw = Math.atan2(-(20 - 22.5), -(-8 - -0.5)) ; p.pitch = -0.12; });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/01-trail-camera-caught-bigfoot.png` });

// ---------- 2. Audio lure alone: Bigfoot comes to the call ----------
await load();
const lureAt = { x: -25, z: 20 };
const before = await bfDist(lureAt.x, lureAt.z);
await page.evaluate((l) => __game.audioLures.place(l), lureAt);
await far(32, 34);
let closest = before, heard = false;
for (let i = 0; i < 60 && closest > 5; i++) {
  await page.waitForTimeout(700);
  closest = Math.min(closest, await bfDist(lureAt.x, lureAt.z));
  heard ||= await page.evaluate(() => __game.cryptids.cryptids[0].history.some((h) => h.why === 'heard a call'));
}
const playerToLure = await page.evaluate((l) => { const p = __game.player.position; return +Math.hypot(p.x - l.x, p.z - l.z).toFixed(1); }, lureAt);
check('the audio lure draws Bigfoot in from far away (player not nearby)', heard && before > 40 && closest < 6 && playerToLure > 50, { before, closest, heard, playerToLure });
await page.evaluate((l) => { const p = __game.player; p.position.set(l.x + 7, 0, l.z + 7); const b = __game.cryptids.cryptids[0];
  p.yaw = Math.atan2(-(b.agent.x - p.position.x), -(b.agent.z - p.position.z)); p.pitch = -0.05; }, lureAt);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/02-bigfoot-came-to-the-lure.png` });

// ---------- 3. Combo: lure + trail camera on it, player far away ----------
await load();
await page.evaluate(() => { const g = __game; g.audioLures.place({ x: -20, z: 22 }); g.trailCams.place({ x: -20, z: 30 }, 0); }); // camera 8 m south of the lure, facing it
await far(34, 34);
await page.waitForFunction(() => __game.trailCams.photos.length > 0, null, { timeout: 60000 }).catch(() => {});
const combo = await page.evaluate(() => ({ photos: __game.trailCams.photos.map((p) => `${p.subject} ${p.score}`), stage: __game.hunt.stage }));
check('lure + trail camera: a photo of Bigfoot with nobody there', combo.photos.length > 0 && combo.photos[0].startsWith('Bigfoot') && combo.stage === 'extract', combo);

// ---------- 4. The call only works on the cryptid it's for ----------
await load('&sandbox');
const prowler = await page.evaluate(async () => {
  const g = __game, pr = g.cryptids.cryptids[1];
  g.cryptids.cryptids[0].update = () => {}; g.chupacabra.update = () => {}; g.mothman.update = () => {};
  pr.tickRoam = () => {}; pr.agent.stop();
  g.audioLures.place({ x: pr.agent.x + 20, z: pr.agent.z });
  g.player.position.set(35, 0, 35);
  await new Promise((r) => setTimeout(r, 5000));
  return { heard: pr.history.some((h) => h.why === 'heard a call'), state: pr.state };
});
check('other cryptids ignore a Bigfoot call', !prowler.heard && prowler.state === 'roam', prowler);

// ---------- Close-ups of the two devices ----------
await load();
await page.evaluate(() => { const g = __game; g.cryptids.cryptids[0].update = () => {};
  g.trailCams.place({ x: 0.45, z: -2.3 }, -0.5); g.audioLures.place({ x: -0.45, z: -2.0 });
  const p = g.player; p.position.set(0, 0, -0.3); p.yaw = 0; p.pitch = -0.55; });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/03-trail-camera-and-audio-lure.png` });

// ---------- Reference clip of the lure's call ----------
const wav = await page.evaluate(async () => {
  const rate = 44100, ctx = new OfflineAudioContext(1, rate * 3, rate);
  __game.synthWhoop(ctx, ctx.destination, 0.2);
  const buf = await ctx.startRendering(), d = buf.getChannelData(0);
  const bytes = new DataView(new ArrayBuffer(44 + d.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); bytes.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVEfmt '); bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true); bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true);
  bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); w(36, 'data'); bytes.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  let s = ''; const u = new Uint8Array(bytes.buffer); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}).catch((e) => null);
if (wav) writeFileSync(`${out}/04-audio-lure-call.wav`, Buffer.from(wav, 'base64'));
check('rendered the lure call clip', !!wav, { bytes: wav ? Math.round(wav.length * 0.75) : 0 });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
