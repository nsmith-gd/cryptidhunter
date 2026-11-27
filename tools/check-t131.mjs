// Dread feedback (#131): dread shows only in the world (breathing, heartbeat, a tremor in the hands
// holding the tools) and as a short "Shaken" label while it affects you; the status screen lists it
// with its cause and what to do. No meter anywhere. The label appears as dread rises (walking deep
// into Pine Hollow) and clears as it falls (resting at the van), and at every point it agrees with
// what the hands, the sound and the status screen are doing. The view itself never shakes from it.
// Run: npm run check:t131 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t131';
mkdirSync(out, { recursive: true });
const PORT = 4431;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai&seed=7`);
await page.waitForFunction(() => window.__game?.dread, null, { timeout: 150000 });
await page.evaluate(() => {
  const g = __game;
  dispatchEvent(new PointerEvent('pointerdown'));            // the click that starts the sound
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  g.fear.applySway = () => {};                               // fear's own sway off: anything moving the view would be dread's
  g.cryptids.update = () => {};                              // keep Bigfoot out of it
  if (!g.flashlight.on) g.flashlight.toggle();
});

/** Everything the player can perceive about dread right now, read from the live game. */
const snapshot = () => page.evaluate(async () => {
  const g = __game, d = g.dread, lab = document.querySelector('#shaken-label');
  const tremors = [];
  for (let i = 0; i < 6; i++) { await new Promise((r) => requestAnimationFrame(r)); tremors.push(g.viewmodel.tremorOffset ? Math.abs(g.viewmodel.tremorOffset.x) + Math.abs(g.viewmodel.tremorOffset.y) : 0); }
  const cond = g.status.conditions().find((c) => c.id === 'dread');
  const cam = g.camera.rotation, p = g.player;
  return {
    value: +d.value.toFixed(1),
    label: lab && getComputedStyle(lab).opacity === '1' ? lab.textContent : null,
    tremor: +Math.max(...tremors).toFixed(5),
    breath: +(d.audio()?.feedback.breath ?? -1).toFixed(3), heart: +(d.audio()?.feedback.heart ?? -1).toFixed(3),
    condition: cond ? { name: cond.name, cause: cond.cause, effect: cond.effect, fix: cond.fix } : null,
    meterInDom: !!document.querySelector('#dread-bar, #dread-vignette'),
    meterInStatus: g.status.attributes().some((a) => a.id === 'dread'),
    viewSteady: Math.abs(cam.y - p.yaw) < 1e-6 && Math.abs(cam.x - p.pitch) < 1e-6,
    hudWarnings: g.status.hudWarnings().map((w) => w.text).filter((t) => /dread|shaken/i.test(t)),
  };
});
const agrees = (s) => !!s.label === (s.tremor > 0) && !!s.label === (s.breath > 0) && !!s.label === !!s.condition;

// 1. Calm.
const calm = await snapshot();
check('calm: no label, no tremor, no breathing, nothing on the status screen', !calm.label && calm.tremor === 0 && calm.breath === 0 && !calm.condition, calm);
check('no dread meter anywhere (no bar, no overlay, no status-screen bar)', !calm.meterInDom && !calm.meterInStatus, calm);
await page.screenshot({ path: `${out}/01-calm-no-label.png` });

// 2. Walk deep into the woods until dread affects you.
await page.evaluate(() => {
  const g = __game, p = g.player, d = g.dread;
  const route = [[0, 100], [30, 70], [40, 45], [35, 20], [30, -10], [22, -40], [19, -62], [14, -85], [-5, -112]];
  let wp = 0;
  for (let s = 0; s < 8 * 3600 && d.value < 34; s++) {
    const [x, z] = route[Math.min(wp, route.length - 1)];
    if (Math.hypot(p.position.x - x, p.position.z - z) < 2 && wp < route.length - 1) wp++;
    p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); p.pitch = 0;
    g.input.keys.clear(); g.input.keys.add('KeyW'); g.flashlight.battery = 1;
    g.sim.step();
  }
  g.input.keys.clear();
});
await page.waitForTimeout(2500);
const shaken = await snapshot();
check('shaken: the label appears as dread rises', /^Shaken: hands unsteady, breathing loud$/.test(shaken.label ?? ''), shaken);
check('shaken: your hands tremble on the tools, and you hear your breathing and heart', shaken.tremor > 0 && shaken.breath > 0 && shaken.heart > 0, shaken);
check('shaken: the status screen lists dread with its cause and what to do (no number)', !!shaken.condition && /dread/i.test(shaken.condition.name) && !!shaken.condition.cause && /lit and safe/.test(shaken.condition.fix) && !/\d/.test(shaken.condition.name), shaken.condition);
check('shaken: the view itself never shakes from dread (only the tools in your hands)', shaken.viewSteady, shaken);
check('shaken: the label is not repeated as a HUD warning line', shaken.hudWarnings.length === 0, shaken.hudWarnings);
check('shaken: label, hands, sound and status screen all agree', agrees(shaken), shaken);
await page.screenshot({ path: `${out}/02-shaken-label-and-trembling-hands.png` });
await page.evaluate(() => __game.statusScreen.toggle(true));
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/03-status-screen-shaken-dread.png` });
await page.evaluate(() => __game.statusScreen.toggle(false));

// 3. Back to the van: it eases, and everything clears together.
await page.evaluate(() => {
  const g = __game, p = g.player, d = g.dread;
  p.position.set(g.HUNT.exit.x + 2, 0, g.HUNT.exit.z + 2); p.yaw = 0;
  for (let s = 0; s < 4 * 3600 && d.value >= 25; s++) { g.flashlight.battery = 1; g.sim.step(); }
});
await page.waitForTimeout(2500);
const cleared = await snapshot();
check('safe at the van: dread falls and the label clears', cleared.value < 25 && !cleared.label, cleared);
check('cleared: no tremor, no loud breathing, gone from the status screen', cleared.tremor === 0 && cleared.breath === 0 && !cleared.condition, cleared);
check('cleared: label, hands, sound and status screen still agree', agrees(cleared), cleared);
await page.screenshot({ path: `${out}/04-cleared-at-the-van.png` });

// 4. Audio clips: breathing and heartbeat at calm, shaken and badly shaken.
const clips = await page.evaluate(async () => {
  const render = async (level) => {
    const sr = 22050, ctx = new OfflineAudioContext(1, sr * 8, sr);
    const a = __game.buildDreadAudio(ctx); a.set(level, 0); a.scheduleUntil(8);
    const buf = await ctx.startRendering(), d = buf.getChannelData(0);
    const bytes = new Uint8Array(44 + d.length * 2), v = new DataView(bytes.buffer);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, d.length * 2, true);
    for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  return { calm: await render(0.1), shaken: await render(0.45), bad: await render(0.9) };
});
writeFileSync(`${out}/05-sound-calm.wav`, Buffer.from(clips.calm, 'base64'));
writeFileSync(`${out}/06-sound-shaken-breathing-and-heartbeat.wav`, Buffer.from(clips.shaken, 'base64'));
writeFileSync(`${out}/07-sound-badly-shaken.wav`, Buffer.from(clips.bad, 'base64'));
writeFileSync(`${out}/snapshots.json`, JSON.stringify({ calm, shaken, cleared }, null, 2));

check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
