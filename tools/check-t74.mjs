// WebXR entry point + safe pause (#74). Headless Chromium has no headset, so a mock WebXR runtime is
// injected before the page loads (navigator.xr with isSessionSupported / requestSession and a fake
// XRSession). The renderer's real setSession is stubbed in the mock case (it needs a GPU XR layer).
// Run: npm run check:t74
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t74';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4336', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const errors = [];

const MOCK = ({ supported, floor = true, refuse = false }) => {
  class FakeSession extends EventTarget {
    constructor() { super(); this.visibilityState = 'visible'; this.ended = false; }
    async requestReferenceSpace(type) { if (type === 'local-floor' && !window.__mockFloor) throw new Error('NotSupportedError'); return { type }; }
    async end() { this.ended = true; this.dispatchEvent(new Event('end')); }
    setVisibility(v) { this.visibilityState = v; this.dispatchEvent(new Event('visibilitychange')); }
  }
  window.__mockFloor = floor;
  window.__xrLog = [];
  Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    async isSessionSupported(mode) { window.__xrLog.push(['isSessionSupported', mode]); return supported && mode === 'immersive-vr'; },
    async requestSession(mode, opts) {
      window.__xrLog.push(['requestSession', mode, opts]);
      if (refuse) throw new DOMException('User declined', 'NotAllowedError');
      return (window.__session = new FakeSession());
    },
  } });
};

async function open(mock, q = '') {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push(e.message));
  if (mock) await page.addInitScript(MOCK, mock);
  await page.goto(`http://localhost:4336/?nodebugai${q}`);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(600);
  if (mock?.supported) await page.evaluate(() => {
    // Real setSession needs a GPU XR layer; in the mock, presenting is simulated.
    const xr = __game.renderer.xr;
    xr.setSession = async () => { xr.isPresenting = true; };
    xr.getReferenceSpace = () => ({});
  });
  return page;
}
const btn = (page) => page.evaluate(() => { const b = document.querySelector('.enter-vr'); return b ? getComputedStyle(b).display !== 'none' : false; });

// 1. No WebXR at all (plain desktop browser): no button, game runs.
{
  const page = await open(null);
  check('no WebXR: no Enter VR button, desktop game runs', !(await btn(page)) && !(await page.evaluate(() => __game.vr.supported)), {});
  await page.close();
}
// 2. WebXR present but immersive-vr unsupported: no button.
{
  const page = await open({ supported: false });
  const log = await page.evaluate(() => window.__xrLog);
  check('WebXR present but no VR: button stays hidden (checked isSessionSupported("immersive-vr"))', !(await btn(page)) && log.some((l) => l[1] === 'immersive-vr'), log);
  await page.close();
}
// 3. VR supported: button appears; entering, pausing and resuming.
{
  const page = await open({ supported: true });
  check('VR supported: the Enter VR button appears', await btn(page), {});
  await page.screenshot({ path: `${out}/01-start-screen-enter-vr-button.png` });
  await page.click('.enter-vr');               // a real user gesture
  await page.waitForFunction(() => __game.vr.session, null, { timeout: 5000 });
  const entered = await page.evaluate(() => ({ ref: __game.vr.refSpaceType, opts: window.__xrLog.find((l) => l[0] === 'requestSession'), loop: !!__game.renderer.xr.enabled }));
  check('entering requests an immersive-vr session on the click, floor-relative space', entered.ref === 'local-floor' && entered.opts[1] === 'immersive-vr' && entered.opts[2].optionalFeatures.includes('local-floor'), entered);

  const tick = () => page.evaluate(() => ({ tick: __game.sim.tick, paused: __game.pauseState.paused, text: __game.pauseState.text, elapsed: +__game.hunt.elapsed.toFixed(2) }));
  await page.evaluate(() => { __game.overlay.classList.add('hidden'); __game.input.locked = true; __game.hunt.start(); });
  const a = await tick(); await page.waitForTimeout(800); const b = await tick();
  check('while in VR and tracked, the simulation runs', b.tick > a.tick && !b.paused, { a, b });

  // Headset removed / system menu: session visibility goes hidden.
  await page.evaluate(() => window.__session.setVisibility('hidden'));
  const p1 = await tick(); await page.waitForTimeout(800); const p2 = await tick();
  await page.screenshot({ path: `${out}/02-paused-headset-off.png` });
  check('headset off (visibility hidden): paused, no simulation time passes', p1.paused && p2.tick === p1.tick && p2.elapsed === p1.elapsed && /headset/.test(p1.text), { p1, p2 });
  await page.evaluate(() => window.__session.setVisibility('visible'));
  const r1 = await tick();
  check('headset back on: resumes', !r1.paused, r1);

  // Tracking loss: the frame has no viewer pose.
  await page.evaluate(() => __game.vr.onFrame({ getViewerPose: () => null }, 0.016));
  const t1 = await tick(); await page.waitForTimeout(500); const t2 = await tick();
  check('tracking lost: paused, the world holds still', t1.paused && /tracking/.test(t1.text) && t2.tick === t1.tick, { t1, t2 });
  await page.evaluate(() => { for (let i = 0; i < 80; i++) __game.vr.onFrame({ getViewerPose: () => ({}) }, 0.016); });
  const t3 = await tick();
  check('tracking back for a moment: resumes by itself', !t3.paused, t3);

  // Leaving VR: paused on the desktop until the player clicks.
  await page.evaluate(() => window.__session.end());
  await page.waitForTimeout(200);
  const e1 = await tick();
  await page.screenshot({ path: `${out}/03-paused-left-vr.png` });
  check('leaving VR: safely paused, back on desktop', e1.paused && /left VR/.test(e1.text) && !(await page.evaluate(() => __game.vr.presenting)), e1);
  await page.click('#pause-screen');
  const e2 = await tick(); await page.waitForTimeout(500); const e3 = await tick();
  check('a click carries on at the desk (desktop fully playable again)', !e2.paused && e3.tick > e2.tick, { e2, e3 });
  await page.close();
}
// 4. No floor space: falls back to local.
{
  const page = await open({ supported: true, floor: false });
  await page.click('.enter-vr');
  await page.waitForFunction(() => __game.vr.session, null, { timeout: 5000 });
  check('no floor-relative space on the device: falls back to local', (await page.evaluate(() => __game.vr.refSpaceType)) === 'local', {});
  await page.close();
}
// 5. User refuses the VR prompt: handled, desktop continues.
{
  const page = await open({ supported: true, refuse: true });
  await page.click('.enter-vr');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ session: !!__game.vr.session, paused: __game.pauseState.paused }));
  check('VR request refused: no crash, stays on desktop, not paused', !r.session && !r.paused, r);
  await page.close();
}
// 6. Desktop tab hidden: safe pause.
{
  const page = await open(null);
  await page.evaluate(() => { __game.overlay.classList.add('hidden'); __game.input.locked = true; });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const h = await page.evaluate(() => ({ paused: __game.pauseState.paused, text: __game.pauseState.text }));
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  const v = await page.evaluate(() => __game.pauseState.paused);
  check('desktop: hiding the tab pauses, showing it resumes', h.paused && !v, { h, v });
  await page.close();
}
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
