// Automated check for wood-knock call and response. Run: npm run check:t23 [outDir]
// Bigfoot knocks; the player presses K; Bigfoot knocks back and walks toward the player.
// A control run (no knock back) shows it doesn't come over on its own. Also renders the
// knock sounds to WAV files in the captures folder.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t23';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4353', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

const setup = async () => {
  await page.goto('http://localhost:4353/?nodebugai');
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => {
    const g = __game;
    g.overlay.classList.add('hidden');
    g.huntFailure.enabled = false;
    g.realUpdate = { cryptids: g.cryptids.update.bind(g.cryptids), knocks: g.knocks.update.bind(g.knocks) };
    g.cryptids.update = () => {}; g.knocks.update = () => {};
    g.player.update = () => {};
    g.input.locked = true;
    if (g.flashlight.on) g.flashlight.toggle();   // dark and silent: it shouldn't spot you by itself
    g.knocks.rand = () => 0.5;
    // Stand in the corner furthest from Bigfoot, still and silent.
    const bf = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot');
    const half = 36;
    const px = bf.agent.x > 0 ? -half : half, pz = bf.agent.z > 0 ? -half : half;
    g.hold = { x: px, z: pz };
    g.player.position.set(px, 0, pz);
    g.player.noise = 0; g.player.noiseRadius = 0;
  });
};
const bf = () => page.evaluate(() => {
  const g = __game, c = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'), p = g.player.position;
  return { state: c.state, why: c.lastWhy, d: +Math.hypot(c.agent.x - p.x, c.agent.z - p.z).toFixed(1),
    knocks: g.knocks.log.filter((k) => k.who === 'Bigfoot').length, x: +c.agent.x.toFixed(1), z: +c.agent.z.toFixed(1) };
});
const simulate = (seconds) => page.evaluate((seconds) => {
  const g = __game, dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    g.player.position.set(g.hold.x, 0, g.hold.z); g.player.noise = 0; g.player.noiseRadius = 0;
    g.realUpdate.cryptids(dt); g.realUpdate.knocks(dt);
  }
}, seconds);

// ---- Call and response ----
await setup();
await simulate(2);
await page.evaluate(() => { const g = __game; g.knocks.cryptidKnock(g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'), 'call'); });
const before = await bf();
await page.waitForTimeout(200);
await shot('01-bigfoot-knocks-caption');
check('Bigfoot knocks (and you are told where from)', before.knocks === 1 && /knock/i.test(await page.evaluate(() => __game.knocks.caption.textContent)), before);

await page.keyboard.press('k');
const pressed = await page.evaluate(() => __game.knocks.log.filter((k) => k.who === 'player').length);
check('K knocks back with your stick', pressed === 1, { playerKnocks: pressed });
const loaded = await page.waitForFunction(() => __game.knocks.audio.buffers?.heavy?.length === 5 && __game.knocks.audio.buffers.light.length === 5, null, { timeout: 10000 }).then(() => true).catch(() => false);
check('the recorded knock sounds load in game', loaded, {});
await simulate(3);
const replied = await bf();
await shot('02-it-answers');
check('Bigfoot answers with its own knocks', replied.knocks === 2, replied);
check('…and heads over to investigate', replied.state === 'investigate' && replied.why === 'answered your knock', replied);

let minD = replied.d;
for (let i = 0; i < 25; i++) { await simulate(1); minD = Math.min(minD, (await bf()).d); }
const after = await bf();
check('knocking back pulls it toward you', before.d - minD > 15 && minD > 12, { start: before.d, closest: minD, end: after });

// First-person look toward where it came to (it stays a cautious distance away).
await page.evaluate(() => {
  const g = __game, c = g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'), p = g.player;
  if (!g.flashlight.on) g.flashlight.toggle();
  p.yaw = Math.atan2(-(c.agent.x - p.position.x), -(c.agent.z - p.position.z)); p.pitch = 0.02;
  g.camera.position.set(p.position.x, 1.68, p.position.z); g.camera.rotation.set(p.pitch, p.yaw, 0);
});
await page.waitForTimeout(400);
await shot('03-it-came-closer');

// ---- Control: same start, no knock back ----
await setup();
await simulate(2);
await page.evaluate(() => { const g = __game; g.knocks.cryptidKnock(g.cryptids.cryptids.find((c) => c.profile.id === 'bigfoot'), 'call'); });
const c0 = await bf();
let cMin = c0.d;
for (let i = 0; i < 28; i++) { await simulate(1); cMin = Math.min(cMin, (await bf()).d); }
check('without knocking back it does not come over', cMin > 40, { start: c0.d, closest: cMin });

// ---- Render the sounds ----
const rendered = await page.evaluate(async () => {
  const toWav = (buf) => {
    const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate, bytes = 44 + len * ch * 2;
    const v = new DataView(new ArrayBuffer(bytes));
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len * ch * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i])); v.setInt16(o, s * 0x7fff, true); o += 2; }
    let bin = ''; const u = new Uint8Array(v.buffer); for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return btoa(bin);
  };
  const render = async (opts) => {
    const ctx = new OfflineAudioContext(2, 44100 * 2, 44100);
    const K = __game.knocks.constructor;
    K.scheduleKnocks(ctx, ctx.destination, 0.05, { ...opts, buffers: await K.loadKnockBuffers(ctx) });
    return toWav(await ctx.startRendering());
  };
  return {
    'bigfoot-knock-close': await render({ count: 3, distance: 15, pan: -0.4, heavy: true }),
    'bigfoot-knock-far': await render({ count: 2, distance: 90, pan: 0.6, heavy: true }),
    'player-knock-stick': await render({ count: 2, distance: 1, pan: 0, heavy: false }),
  };
}).catch((e) => ({ error: e.message }));
if (rendered.error) check('knock sounds render', false, rendered);
else { for (const [k, b64] of Object.entries(rendered)) writeFileSync(`${out}/${k}.wav`, Buffer.from(b64, 'base64')); check('knock sounds render', true, Object.keys(rendered)); }

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
