// Dread (#114): over a real 12-minute session walking deeper into Pine Hollow, dread measurably
// escalates through its stages, and it changes play: the fog closes in, fear builds faster in the
// dark, the torch stutters, and the creature's escalation level rises. Staying by the van builds
// far less. Captures: the same view at low and high dread, a dread-over-time log, and the night
// soundscape at low and high dread as audio clips. The sim is stepped directly (?simpaused).
// Run: npm run check:t114 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t114';
mkdirSync(out, { recursive: true });
const PORT = 4414;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const errors = [];

async function open(extra = '') {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?map=forest&simpaused&nodebugai&seed=7&mute${extra}`);
  await page.waitForFunction(() => window.__game?.dread, null, { timeout: 150000 });
  await page.evaluate(() => {
    const g = __game;
    g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
    if (g.huntFailure) g.huntFailure.enabled = false;
    window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  });
  return page;
}

// 1. A 12-minute session: walk the main trail north, deeper and deeper, torch on.
const page = await open();
const session = await page.evaluate(() => {
  const g = __game, p = g.player, d = g.dread;
  const route = [[0, 100], [30, 70], [40, 45], [35, 20], [30, -10], [22, -40], [19, -62], [14, -85], [-5, -112], [-45, -115], [-110, -95], [-123, -62]];
  let wp = 0;
  const fogVal = () => (g.scene.fog.isFogExp2 ? g.scene.fog.density : g.scene.fog.far);
  const fogType = g.scene.fog.isFogExp2 ? 'density' : 'far';
  const fog0 = fogVal(), levels0 = g.cryptids.cryptids.map((c) => c.level);
  const perMinute = [];
  if (!g.flashlight.on) g.flashlight.toggle();
  for (let s = 0; s < 12 * 60 * 60; s++) {
    const [x, z] = route[Math.min(wp, route.length - 1)];
    if (Math.hypot(p.position.x - x, p.position.z - z) < 2 && wp < route.length - 1) wp++;
    p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z));
    g.input.keys.clear(); if (wp < route.length - 1 || Math.hypot(p.position.x - x, p.position.z - z) > 2) g.input.keys.add('KeyW');
    g.flashlight.battery = 1;                 // keep the torch alive: this run measures dread, not batteries
    g.survival.health.value = Math.max(g.survival.health.value, 50);
    g.sim.step();
    if (s % 3600 === 3599) perMinute.push({ min: (s + 1) / 3600, dread: +d.value.toFixed(1), stage: d.stageName, sightLeft: +d.sightShare.toFixed(2), depth: +d.depth().toFixed(2) });
  }
  return { perMinute, log: d.log, fogType, fog: [+fog0.toFixed(4), +fogVal().toFixed(4)], levels: [levels0, g.cryptids.cryptids.map((c) => c.level)], fearMul: +g.fear.dreadMul.toFixed(2), clues: g.journal.entries.length };
});
const dv = session.perMinute.map((m) => m.dread);
check('dread climbs through the session (higher every minute until it tops out, never falling while out)', dv.every((v, i) => i === 0 || v > dv[i - 1] || (v === 100 && dv[i - 1] === 100)), dv);
check('it keeps building for most of the night (the top stage comes after 6 minutes, not at once)', !session.log.some((e) => e.name === 'Dread' && e.t < 360), session.log.filter((e) => e.name));
check('it reaches the top stage (Dread) within a 12-minute night out', session.log.some((e) => e.name === 'Dread'), session.log.filter((e) => e.name));
check('the fog closes in as dread rises (you see less far)', session.fogType === 'density' ? session.fog[1] > session.fog[0] * 1.3 : session.fog[1] < session.fog[0] * 0.7,
  { fog: session.fogType, startEnd: session.fog, sightLeft: session.perMinute.at(-1).sightLeft });
check('the creature gets bolder: its escalation level rises', session.levels[1].some((l, i) => l > session.levels[0][i]), session.levels);
check('fear builds faster at high dread', session.fearMul > 1.5, { fearRiseMultiplier: session.fearMul });
writeFileSync(`${out}/dread-session.json`, JSON.stringify(session, null, 2));

// 2. Consequence, measured: fear in the dark for 5 s with low vs high dread (same spot, nothing near).
const fearTest = await page.evaluate(() => {
  const g = __game, f = g.fear, d = g.dread;
  const run = (v) => {
    d.value = v; d.stage = v >= 75 ? 3 : v >= 50 ? 2 : v >= 25 ? 1 : 0; d.applyEffects(0);
    g.player.position.set(-120, 0, -20); f.value = 0;
    if (g.flashlight.on) g.flashlight.toggle();
    const tmp = d.update; d.update = () => {};            // hold dread fixed for the measurement
    window.steps(300);
    d.update = tmp;
    return +f.value.toFixed(2);
  };
  return { lowDread: run(5), highDread: run(95) };
});
check('in the dark, fear rises much faster at high dread than low', fearTest.highDread > fearTest.lowDread * 1.4, fearTest);
// The torch stutters at Dread.
const torch = await page.evaluate(() => {
  const g = __game, d = g.dread; d.value = 95; d.stage = 3;
  if (!g.flashlight.on) g.flashlight.toggle(); g.flashlight.battery = 1;
  const tmp = d.update.bind(d); let dims = 0;
  for (let i = 0; i < 60 * 30; i++) { g.sim.step(); if (g.flashlight.dreadDim < 1) dims++; }
  void tmp;
  return { stepsDimmed: dims, of: 1800 };
});
check('at Dread the torch stutters now and then (not constantly)', torch.stepsDimmed > 0 && torch.stepsDimmed < 600, torch);
await page.close();

// 3. Staying by the van for the same 4 minutes builds far less than walking deep for 4 minutes.
const vanPage = await open();
const van = await vanPage.evaluate(() => {
  const g = __game, p = g.player; if (!g.flashlight.on) g.flashlight.toggle();
  p.position.set(0, 0, 112);                 // on the trail near the start: out in the woods, but not deep, not lit, not safe
  for (let s = 0; s < 4 * 3600; s++) { g.flashlight.battery = 1; g.sim.step(); }
  return +g.dread.value.toFixed(1);
});
check('staying out near the start builds dread more slowly than heading deep (and it still builds)', van > 5 && van < session.perMinute[3].dread * 0.8, { nearStartAfter4min: van, deepAfter4min: session.perMinute[3].dread });

// 4. Captures: the same view at low and high dread.
await vanPage.evaluate(() => { const g = __game, p = g.player; p.position.set(22, 0, -38); p.yaw = 0.12; p.pitch = 0.05; if (!g.flashlight.on) g.flashlight.toggle(); });
for (const [name, v] of [['01-same-view-low-dread-uneasy', 5], ['02-same-view-high-dread', 92]]) {
  await vanPage.evaluate((v) => { const g = __game, d = g.dread; d.value = v; d.stage = v >= 75 ? 3 : v >= 50 ? 2 : v >= 25 ? 1 : 0; d.applyEffects(0); g.flashlight.dreadDim = 1; d.render(); g.sim.paused = true; }, v);
  await vanPage.waitForTimeout(2500);
  await vanPage.screenshot({ path: `${out}/${name}.png` });
}
await vanPage.evaluate(() => __game.statusScreen.toggle(true));
await vanPage.waitForTimeout(800);
await vanPage.screenshot({ path: `${out}/03-status-screen-dread.png` });

// 5. Audio: the night soundscape rendered offline at low and high dread (6 s each), as WAV.
const audio = await vanPage.evaluate(async () => {
  const render = async (k) => {
    const sr = 22050, ctx = new OfflineAudioContext(1, sr * 6, sr);
    const a = __game.buildDreadAudio(ctx); a.set(k, 0); a.scheduleUntil(6);
    const buf = await ctx.startRendering(), d = buf.getChannelData(0);
    const bytes = new Uint8Array(44 + d.length * 2), v = new DataView(bytes.buffer);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, d.length * 2, true);
    let rms = 0, low = 0;
    for (let i = 0; i < d.length; i++) { const s = Math.max(-1, Math.min(1, d[i])); v.setInt16(44 + i * 2, s * 32767, true); rms += s * s; }
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    void low;
    return { b64: btoa(bin), rms: +Math.sqrt(rms / d.length).toFixed(4) };
  };
  return { low: await render(0.05), high: await render(0.9) };
});
writeFileSync(`${out}/04-night-sound-low-dread-crickets.wav`, Buffer.from(audio.low.b64, 'base64'));
writeFileSync(`${out}/05-night-sound-high-dread-silence-and-heartbeat.wav`, Buffer.from(audio.high.b64, 'base64'));
check('the soundscape changes with dread (audio clips rendered)', audio.low.rms > 0 && audio.high.rms > 0 && audio.low.rms !== audio.high.rms, { rmsLow: audio.low.rms, rmsHigh: audio.high.rms });

check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(results.join('\n'));
console.log(JSON.stringify(session.perMinute));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
