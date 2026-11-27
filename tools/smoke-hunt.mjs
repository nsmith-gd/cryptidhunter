// Smoke test of the core hunt loop (#82). Run from a clean checkout:
//   npm ci && npm run smoke            (builds, serves the build, drives one night in Chromium)
//   node tools/smoke-hunt.mjs [outDir] (against an existing build in dist/)
// One night in Pine Hollow, played through the real controls (clicks and keys, not API calls):
//   1. start the night (click into the game)       -> the hunt is on and the night clock runs
//   2. move (hold W)                                -> the player walks
//   3. find a clue (walk up to it, aim, press E)     -> it is logged in the field journal
//   4. photograph Bigfoot (hold right mouse, click)  -> a HIT is logged and the hunt moves to extract
//   5. drive home (at the van, press H)              -> the hunt ends "complete" with the results screen
// The only shortcuts are teleports between scenes (walking the whole map would take minutes) and
// a fixed seed. Exits non-zero on any failed step or page error. Screenshots go to outDir.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t82';
mkdirSync(out, { recursive: true });
if (!existsSync('dist/index.html')) { console.error('No build: run `npx vite build` first (npm run smoke does).'); process.exit(2); }
const PORT = 4382;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const launchArgs = ['--use-gl=angle', '--use-angle=swiftshader'];
const browser = await chromium.launch({ args: launchArgs });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(120000);   // software rendering in CI containers can take seconds per frame
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
let failed = false;
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ok = r.ok !== false;
    if (!ok) failed = true;
    results.push(`${ok ? 'PASS' : 'FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s) ${JSON.stringify(r.detail ?? r)}`);
  } catch (e) {
    failed = true;
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
  console.log(results[results.length - 1]);
};
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

// Headless Chromium has no real pointer lock: grant it when the game asks, exactly as a browser would.
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
  Element.prototype.requestPointerLock = function () { locked = this; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
  Document.prototype.exitPointerLock = function () { if (!locked) return; locked = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
});

await page.goto(`http://localhost:${PORT}/?map=forest&seed=8204&nodebugai`);
await until(() => window.__game, null, 90000);
await page.evaluate(() => {
  const g = __game;
  g.huntFailure.enabled = false;          // a smoke test must not depend on where Bigfoot wanders
  window.__dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // Stand somewhere, facing a point (eye-level aim): the "walk there" shortcut between scenes.
  window.__standAt = (x, z, lookAt, eyeDrop = 0) => {
    const p = g.player, y = g.map.heightAt?.(x, z) ?? 0;
    p.position.set(x, y, z); p.velocity.set(0, 0, 0);
    const ex = lookAt.x - x, ez = lookAt.z - z, eyeY = y + p.eyeHeight;
    p.yaw = Math.atan2(-ex, -ez);
    p.pitch = Math.atan2((lookAt.y ?? eyeY) - eyeY - eyeDrop, Math.hypot(ex, ez));
  };
});
await shot('00-start-screen');

await step('1. start the night: COMMIT on the prep screen pays the trip, and clicking into the game starts the hunt and the night clock', async () => {
  await page.click('#prep-panel button[data-act="commit"]');   // #98: the expedition is committed (and pointer lock requested) here
  await until(() => __game.hunt.stage === 'search' && __game.input.locked);
  const e0 = await page.evaluate(() => __game.hunt.elapsed);
  await page.waitForTimeout(1500);
  const e1 = await page.evaluate(() => __game.hunt.elapsed);
  await shot('01-night-started');
  return { ok: e1 > e0, detail: { stage: 'search', clockAdvanced: +(e1 - e0).toFixed(2) } };
});

await step('2. move: holding W walks the player forward', async () => {
  const p0 = await page.evaluate(() => ({ ...__game.player.position }));
  await page.keyboard.down('KeyW');
  await until((p0) => __dist(__game.player.position, p0) > 2.5, p0, 20000).catch(() => {});
  await page.keyboard.up('KeyW');
  const d = await page.evaluate((p0) => __dist(__game.player.position, p0), p0);
  await shot('02-walked');
  return { ok: d > 2.5, detail: { walkedM: +d.toFixed(2) } };
});

await step('3. find a clue: walk up to one, aim at it, press E: it goes in the field journal', async () => {
  // Let Bigfoot roam until he has left a trail (footprints, hair, broken branches...).
  await until(() => __game.clues.clues.some((c) => !c.found), null, 60000);
  const target = await page.evaluate(() => {
    const g = __game, c = g.clues.clues.filter((c) => !c.found).sort((a, b) => a.y - b.y)[0];
    // Step back 1.4 m from it along a clear line and look at it.
    window.__standAt(c.x + 1.4, c.z, { x: c.x, y: c.y + 0.03, z: c.z });
    g.player.update = ((u) => function (dt) { /* hold still while examining */ this.input.consumeMouse(); g.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z); g.camera.rotation.set(this.pitch, this.yaw, 0); })(g.player.update);
    window.__clueTarget = c;
    return { type: c.type, id: c.id };
  });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => __game.journal.entries.length);
  await page.keyboard.press('KeyE');
  await until((n) => __game.journal.entries.length > n, before, 20000).catch(() => {});
  const after = await page.evaluate(() => ({ n: __game.journal.entries.length, last: __game.journal.entries.at(-1)?.clueId, found: __clueTarget.found }));
  await shot('03-clue-examined');
  return { ok: after.n === before + 1 && after.last === target.id, detail: { clue: target.type, journalEntries: after.n } };
});

await step('4. photograph Bigfoot: raise the camera (right mouse), click: a HIT, and the hunt moves to "get out"', async () => {
  await page.evaluate(() => {
    const g = __game, bf = g.cryptids.cryptids[0];
    g.player.update = Object.getPrototypeOf(g.player).update;   // normal controls again
    g.cryptids.update = () => {};                                // he holds still for the portrait
    bf.mesh.visible = true;
    const a = bf.agent, h = 2.0;
    // 11 m away on open ground, looking at his chest.
    let best = null;
    for (let k = 0; k < 16 && !best; k++) {
      const ang = k * Math.PI / 8, x = a.x + Math.sin(ang) * 11, z = a.z + Math.cos(ang) * 11;
      if (!g.map.colliders.some((b) => x > b.min.x - 0.6 && x < b.max.x + 0.6 && z > b.min.z - 0.6 && z < b.max.z + 0.6 && b.min.y < 1.8)) best = { x, z };
      if (best) { window.__standAt(best.x, best.z, { x: a.x, y: (g.map.heightAt?.(a.x, a.z) ?? 0) + h, z: a.z }); if (!g.photo.evaluate().subject) best = null; }
    }
    if (!g.flashlight.on) g.flashlight.toggle();
  });
  const shots0 = await page.evaluate(() => __game.photo.log.length);
  await page.mouse.down({ button: 'right' });
  await until(() => __game.photo.raised, null, 30000);
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
  await until((n) => __game.photo.log.length > n, shots0, 20000).catch(() => {});
  await page.waitForTimeout(250);
  await shot('04-photo-of-bigfoot');
  await page.mouse.up({ button: 'right' });
  const r = await page.evaluate(() => { const e = __game.photo.log.at(-1); return { result: e?.result, subject: e?.subject, score: e?.score, distance: +e?.distance?.toFixed(1), stage: __game.hunt.stage }; });
  return { ok: r.result === 'HIT' && r.subject && r.stage === 'extract', detail: r };
});

await step('5. drive home: walk to the van, press H to review the manifest and H to drive out: the hunt ends complete and shows the results', async () => {
  await page.evaluate(() => {
    const g = __game, v = g.HUNT.exit;
    window.__standAt(v.x + 1, v.z + 1, { x: v.x, z: v.z - 5 });
    // Stop the results screen's restart (a page reload) so the test can read it.
    g.hunt.onRestart = () => {};
  });
  await until(() => __game.hunt.inZone, null, 20000);
  await page.keyboard.press('KeyH');   // #98: opens the extraction manifest...
  await page.keyboard.press('KeyH');   // ...and H again drives out
  await until(() => __game.hunt.stage === 'ended', null, 20000).catch(() => {});
  await page.waitForTimeout(600);
  await shot('05-hunt-complete');
  const r = await page.evaluate(() => {
    const g = __game, screen = [...document.querySelectorAll('body *')].find((el) => el.offsetParent !== null && /complete|sold|photo/i.test(el.innerText ?? '') && el.childElementCount > 1);
    return { stage: g.hunt.stage, outcome: g.hunt.outcome, photos: g.hunt.photos.length, resultsShown: !!screen };
  });
  return { ok: r.stage === 'ended' && r.outcome === 'complete' && r.resultsShown, detail: r };
});

results.push(`${errors.length ? 'FAIL' : 'PASS'} no page errors ${JSON.stringify(errors)}`);
if (errors.length) failed = true;
console.log(results.at(-1));
console.log(failed ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED: start, move, find a clue, photograph, drive home');
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
