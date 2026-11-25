// Pixel render pipeline check (#35): integer upscale, target resolution, and stability in motion.
// Run: npm run check:t35 [outDir]   (needs ffmpeg for the GIFs)
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t35';
mkdirSync(out, { recursive: true });
const PORT = 4335;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const errors = [];

async function open(w, h, query = '') {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai${query}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden');
    for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  });
  return page;
}
const layout = (page) => page.evaluate(() => {
  const p = __game.pixels, c = __game.renderer.domElement, r = c.getBoundingClientRect(), dpr = devicePixelRatio;
  return { scale: p.scale, w: c.width, h: c.height, cssW: r.width * dpr, cssH: r.height * dpr, left: r.left * dpr, top: r.top * dpr, vw: innerWidth * dpr, vh: innerHeight * dpr };
});

// 1) Exact integer upscale on an awkward window size, letterboxed and centred.
{
  const page = await open(1003, 571);
  const L = await layout(page);
  const exact = Number.isInteger(L.scale) && Math.abs(L.cssW - L.w * L.scale) < 0.01 && Math.abs(L.cssH - L.h * L.scale) < 0.01;
  check('every render pixel is the same whole number of screen pixels (odd window 1003x571)', exact, L);
  check('leftover space is under one pixel per side, centred', L.left >= 0 && L.left < L.scale && L.top >= 0 && L.top < L.scale, { left: L.left, top: L.top, scale: L.scale });
  await page.close();
}
// 2) Target resolution: about 360 rows at 1080p (640x360 per the style guide).
{
  const page = await open(1920, 1080);
  const L = await layout(page);
  check('1080p renders 640x360 upscaled exactly x3', L.w === 640 && L.h === 360 && L.scale === 3, L);
  await page.close();
}

// 3) Stability: freeze time-driven motion (wind, water, fireflies) and the game loop's camera
//    writes, then render specific view angles straight through the pipeline and compare pixels.
const page = await open(960, 540);
await page.evaluate(() => {
  const g = __game;
  const t0 = performance.now(); performance.now = () => t0;   // frozen clock for wind/water/fireflies
  g.cryptids.update = () => {}; for (const c of g.cryptids.cryptids) c.mesh.visible = false;
  if (g.huntFailure) g.huntFailure.enabled = false;
  g.player.update = () => {}; if (g.fear) { g.fear.update = () => {}; g.fear.applySway = () => {}; }
  const p = g.player; p.position.set(30, 0, 66); p.velocity.set(0, 0, 0);
  if (!g.flashlight.on) g.flashlight.toggle();
  g.flashlight.battery = 1; g.flashlight.update = () => {};
  g.camera.position.set(30, 1.68, 66);
  // Render a given yaw/pitch through the pipeline and return the low-res frame's pixels.
  window.__shot = (yaw, pitch, snap = true) => {
    const { renderer, scene, camera, pixels } = g;
    pixels.snap = snap;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    pixels.frame(() => renderer.render(scene, camera));
    const gl = renderer.getContext(), w = renderer.domElement.width, h = renderer.domElement.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { w, h, buf: Array.from(buf) };
  };
  window.__diff = (a, b) => { let n = 0; for (let i = 0; i < a.buf.length; i += 4) if (a.buf[i] !== b.buf[i] || a.buf[i + 1] !== b.buf[i + 1] || a.buf[i + 2] !== b.buf[i + 2]) n++; return n; };
});
// Pause the game's own render loop so only our frames touch the canvas.
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.waitForTimeout(300);

const stability = await page.evaluate(() => {
  const step = __game.pixels.pixelAngle, y0 = -0.45 - ((-0.45 / step) % 1) * step, p0 = Math.round(-0.1 / step) * step;   // both on the pixel grid
  const snapA = __shot(y0, p0, true), snapB = __shot(y0 + 0.2 * step, p0 + 0.15 * step, true), snapC = __shot(y0 + 0.4 * step, p0 - 0.3 * step, true);
  const rawA = __shot(y0, p0, false), rawB = __shot(y0 + 0.2 * step, p0 + 0.15 * step, false), rawC = __shot(y0 + 0.4 * step, p0 - 0.3 * step, false);
  const oneStep = __shot(y0 + step, p0, true);
  const px = snapA.w * snapA.h;
  return {
    px, stepDeg: +(step * 180 / Math.PI).toFixed(3),
    snappedChanged: [__diff(snapA, snapB), __diff(snapA, snapC)],
    unsnappedChanged: [__diff(rawA, rawB), __diff(rawA, rawC)],
    oneWholeStepChanged: __diff(snapA, oneStep),
  };
});
check('sub-pixel turns give an identical frame (snapped)', stability.snappedChanged.every((n) => n === 0), stability);
check('without snapping the same sub-pixel turns re-sample edges (shimmer)', stability.unsnappedChanged.every((n) => n > 50), stability.unsnappedChanged);
check('a whole-pixel turn still moves the image', stability.oneWholeStepChanged > 50, stability.oneWholeStepChanged);

// 4) Slow pan: 48 frames turning 0.15 px per frame. Count changed pixels between consecutive
//    frames (flicker) and write GIFs (crop, x4 nearest) with snapping on and off.
const frames = `${out}/_frames`;
const pan = async (snap, tag) => {
  rmSync(`${frames}-${tag}`, { recursive: true, force: true }); mkdirSync(`${frames}-${tag}`, { recursive: true });
  const changes = [];
  for (let i = 0; i < 48; i++) {
    const r = await page.evaluate(([i, snap]) => {
      const step = __game.pixels.pixelAngle, y0 = -0.45 - ((-0.45 / step) % 1) * step;
      const s = __shot(y0 + i * 0.15 * step, -0.1, snap);
      const changed = window.__prev ? __diff(window.__prev, s) : 0;
      window.__prev = s;
      return { changed, url: __game.renderer.domElement.toDataURL('image/png') };
    }, [i, snap]);
    if (i > 0) changes.push(r.changed);
    writeFileSync(`${frames}-${tag}/${String(i).padStart(3, '0')}.png`, Buffer.from(r.url.split(',')[1], 'base64'));
  }
  await page.evaluate(() => { window.__prev = null; });
  const framesWithChange = changes.filter((n) => n > 0).length;
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  return { framesWithChange, of: changes.length, meanChangedPx: Math.round(mean) };
};
const snappedPan = await pan(true, 'snap');
const rawPan = await pan(false, 'raw');
check('slow pan, snapped: the image only changes on whole-pixel steps (about 1 frame in 7)', snappedPan.framesWithChange <= 9, snappedPan);
check('slow pan, unsnapped: edges crawl on (nearly) every frame', rawPan.framesWithChange >= 40, rawPan);

// A crisp still at the target resolution, upscaled by the pipeline (what the player sees).
await page.evaluate(() => { const step = __game.pixels.pixelAngle; __shot(-0.45 - ((-0.45 / step) % 1) * step, -0.1, true); });
await page.screenshot({ path: `${out}/01-forest-trail-pixel-pipeline.png` });
// Side by side GIF: left snapped, right unsnapped; a crop magnified x4 so shimmer is visible.
for (const tag of ['snap', 'raw']) {
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', `${frames}-${tag}/%03d.png`,
    '-vf', 'crop=120:90:130:60,scale=480:360:flags=neighbor', `${out}/_${tag}.mp4`]);
}
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${out}/_snap.mp4`, '-i', `${out}/_raw.mp4`, '-filter_complex',
  '[0:v]pad=488:360:0:0:black[a];[a][1:v]hstack,split[x][y];[x]palettegen=max_colors=128[p];[y][p]paletteuse', `${out}/02-slow-pan-snapped-left-vs-unsnapped-right-x4.gif`]);
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', `${frames}-snap/%03d.png`,
  '-vf', 'scale=960:540:flags=neighbor,split[x][y];[x]palettegen=max_colors=128[p];[y][p]paletteuse', `${out}/03-slow-pan-snapped-full.gif`]);
for (const tag of ['snap', 'raw']) { rmSync(`${frames}-${tag}`, { recursive: true, force: true }); rmSync(`${out}/_${tag}.mp4`, { force: true }); }

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
