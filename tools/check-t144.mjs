// Ozark greybox check (#144, GDD 12.2 L07). Run: npm run check:t144 [outDir]
// The ridge-and-valley map loads; four camps; two routes home from the valley junction to the
// trailhead - the Bald Route (short, steep, open crest) and the Gap Route (long, gentle, wooded) -
// both walkable end to end with nothing blocking; a carcass gives off scent; the Howler proxy dens
// on Bald Knob; the trailhead ends the trip. Captures from each place.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t144';
mkdirSync(out, { recursive: true });
const PORT = 4544;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };



await page.goto(`http://localhost:${PORT}/?map=ozark&simpaused&nodebugai&seed=7`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=ozark&simpaused&nodebugai&seed=7`);
await page.waitForFunction(() => window.__game?.map, null, { timeout: 120000 });
const info = await page.evaluate(() => {
  const g = __game, m = g.map;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  steps(120);
  const blocked = (x, z) => { const y = m.heightAt(x, z) + 1; return m.colliders.some((b) => x > b.min.x - 0.3 && x < b.max.x + 0.3 && z > b.min.z - 0.3 && z < b.max.z + 0.3 && y > b.min.y && y < b.max.y); };
  const walk = (pts) => { let len = 0, climb = 0, top = -99, hits = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
    for (let k = 0; k < n; k++) { const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n, y = m.heightAt(x, z);
      if (blocked(x, z)) hits.push([+x.toFixed(1), +z.toFixed(1)]); top = Math.max(top, y); } len += Math.hypot(b.x - a.x, b.z - a.z); }
    return { metres: Math.round(len), top: +top.toFixed(1), blocked: hits.slice(0, 3), minutesAtWalk: +(len / 1.4 / 60).toFixed(1) }; };
  return { mapId: g.mapId, target: g.hunt.target, camps: m.camps.map((c) => c.id), bald: walk(m.routes.bald.pts), gap: walk(m.routes.gap.pts),
    carcassScent: g.scent.traces.filter((t) => t.kind === 'carcass').length, howler: g.howler && { x: Math.round(g.howler.position.x), z: Math.round(g.howler.position.z) }, bigfoot: g.cryptids.cryptids.length };
});
check('the Ozark ridge-and-valley map loads (target Ozark Howler, no Bigfoot)', info.mapId === 'ozark' && info.target === 'Ozark Howler' && info.bigfoot === 0, { mapId: info.mapId, target: info.target });
check('several camp positions', info.camps.length >= 3, info.camps);
check('two routes home: the Bald Route is shorter, the Gap Route longer; both walkable end to end', info.bald.metres < info.gap.metres * 0.7 && !info.bald.blocked.length && !info.gap.blocked.length, { bald: info.bald, gap: info.gap });
check('a carcass gives off scent, and the Howler proxy dens on Bald Knob', info.carcassScent >= 1 && info.howler && info.howler.z < -40, { carcassScent: info.carcassScent, howler: info.howler });

// Captures.
await page.evaluate(() => { const g = __game; for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  for (const ch of g.camera.children) if (!ch.isLight) ch.visible = false; g.player.update = () => {};
  if (!g.flashlight.on) g.flashlight.toggle(); g.flashlight.battery = 1;
  window.__look = (x, y, z, tx, ty, tz) => { g.camera.position.set(x, y, z); g.camera.lookAt(tx, ty, tz); g.sim.frame(1 / 60); }; });
await page.evaluate(() => __look(0, 70, 150, 0, 0, -10)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/01-overview-ridges-and-valley-from-the-south.png` });
await page.evaluate(() => { const m = __game.map, y = m.heightAt(-3, 14) + 1.7; __look(-3, y, 14, 4, y + 2, 40); }); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/02-from-the-junction-up-the-bald-route.png` });
await page.evaluate(() => { const m = __game.map, y = m.heightAt(-12, 45) + 1.7; __look(-12, y, 45, -10, y - 6, 0); }); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/03-on-the-bald-exposed-crest-looking-back-over-the-valley.png` });
await page.evaluate(() => { const m = __game.map, y = m.heightAt(70, 50) + 1.7; __look(70, y, 50, 70, y, 30); }); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/04-gap-route-sheltered-in-the-trees.png` });
await page.evaluate(() => { const m = __game.map, y = m.heightAt(-10, -46) + 1.7; __look(-10, y, -46, 0, y - 10, 20); }); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/05-bluff-top-camp-view-south.png` });
await page.evaluate(() => { const m = __game.map, y = m.heightAt(-36, 14) + 1.7; __look(-36, y, 14, -40, y - 1, 6); }); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/06-creek-bend-camp.png` });
await page.evaluate(() => { const m = __game.map, y = m.heightAt(22, 0) + 1.7; __look(22, y, 0, 18, y - 1.6, -4); }); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/07-deer-carcass-scent-source.png` });

// Exit at the trailhead.
await page.evaluate(() => { const g = __game; delete g.player.update; for (const el of document.body.children) el.style.visibility = ''; });
const out2 = await page.evaluate(() => { const g = __game, v = g.HUNT.exit; g.hunt.elapsed += 300; const p = g.player; p.position.set(v.x + 1, g.map.heightAt(v.x + 1, v.z - 1), v.z - 1); steps(5); return { inZone: g.hunt.inZone }; });
await page.keyboard.press('KeyH'); await page.waitForTimeout(300); await page.keyboard.press('KeyH'); await page.waitForTimeout(500);
const end = await page.evaluate(() => { for (let i = 0; i < 30 && __game.hunt.stage !== 'ended'; i++) steps(2); return { stage: __game.hunt.stage }; });
check('the trailhead ends the trip', out2.inZone && end.stage === 'ended', { ...out2, ...end });

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
