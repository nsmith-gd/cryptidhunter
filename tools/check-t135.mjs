// Lake Simcoe shore greybox check (#135, GDD 12.2 L03). Run: npm run check:t135 [outDir]
// The map loads; two sheltered camp spots and one exposed; the Point's long view; every surfacing
// zone seen from a dry observation point (line of sight against terrain, trees and rocks, checked
// in the page with the same layout); a tent pitches, a fire lights and you can sleep at a camp
// spot; and the road exit ends the trip.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t135';
mkdirSync(out, { recursive: true });
const PORT = 4535;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };


await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=7`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=7`);
await page.waitForFunction(() => window.__game?.fieldCamp, null, { timeout: 120000 });
const info = await page.evaluate(() => {
  const g = __game, m = g.map;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  window.__stand = (x, z, yaw = 0, pitch = -0.05) => { const p = g.player; p.position.set(x, g.map.heightAt(x, z), z); p.velocity.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; steps(2); };
  window.__faceTo = (x, z, tx, tz, ty = null) => { const p = g.player; const y = g.map.heightAt(x, z) + 1.6;
    __stand(x, z, Math.atan2(-(tx - x), -(tz - z)), ty == null ? -0.05 : Math.atan2(ty - y, Math.hypot(tx - x, tz - z))); };
  return { mapId: g.mapId, target: g.hunt.target, camps: m.camps.map((c) => ({ id: c.id, sheltered: c.sheltered, dry: m.surfaceAt(c.x, c.z) })),
    obs: m.observation.map((o) => ({ id: o.id, h: +m.heightAt(o.x, o.z).toFixed(1) })), zones: m.surfacing.map((s) => ({ id: s.id, surface: m.surfaceAt(s.x, s.z) })),
    exit: g.HUNT.exit && { x: g.HUNT.exit.x, z: g.HUNT.exit.z }, bigfoot: g.cryptids.cryptids.length };
});
check('Lake Simcoe shore loads as its own map (target Igopogo, no Bigfoot)', info.mapId === 'simcoe' && info.target === 'Igopogo' && info.bigfoot === 0, info);
check('two sheltered camp spots and one exposed, on dry land', info.camps.filter((c) => c.sheltered).length === 2 && info.camps.filter((c) => !c.sheltered).length === 1 && info.camps.every((c) => c.dry === 'dry'), info.camps);
check('surfacing zones are out in deep water', info.zones.every((z) => z.surface === 'deep'), info.zones);
// Line of sight in the page, from each observation point (eye 1.6 m) to each zone (0.6 m above water).
const vis = await page.evaluate(() => __game.map.visibility);
const visOk = vis.every((z) => z.seenFrom.length >= 1);
check('every surfacing zone is visible from at least one dry observation point', visOk, vis);

await page.evaluate(() => { const g = __game; for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden'; });
// Captures: the Point's long view, each camp spot, the exposed beach, the road.
await page.evaluate(() => { const g = __game; if (g.flashlight.on) g.flashlight.toggle(); });
const P = await page.evaluate(() => ({ point: __game.map.observation[0], zones: __game.map.surfacing, camps: __game.map.camps }));
await page.evaluate(({ o, z }) => __faceTo(o.x, o.z, z.x, z.z, 0.5), { o: P.point, z: P.zones[1] });
await shot('01-the-point-long-view-over-the-bay');
for (const [i, z] of P.zones.entries()) {
  await page.evaluate(({ o, z }) => __faceTo(o.x, o.z, z.x, z.z, 0.5), { o: P.point, z });
  await shot(`02-from-the-point-to-${z.id}`, 800);
}
// Pitch the tent at Cedar Cove, light a fire, sleep.
const camp = await page.evaluate(({ c }) => {
  const g = __game, fc = g.fieldCamp;
  g.fieldKit.carried.tent = 1; g.fieldKit.carried.fireKit = 2;
  g.survival.fatigue.value = 70;
  __stand(c.x, c.z + 1.5, 0);
  const started = fc.use(); steps(60 * 7);
  const pitched = !!fc.tent;
  if (pitched) { const p = g.player; p.position.set(fc.tent.x, g.map.heightAt(fc.tent.x, fc.tent.z), fc.tent.z); p.yaw = fc.tent.yaw + Math.PI; steps(5); }
  const fire = g.fieldKit.lightFire(); steps(30);
  const ok = fc.use(); steps(10);
  return { started, pitched, fire, inside: fc.insideTent, sleeping: fc.sleeping, campFire: !!fc.campFire };
}, { c: P.camps[0] });
check('at a sheltered camp spot the tent pitches, a fire lights, and you can sleep', camp.pitched && camp.fire && camp.sleeping, camp);
await page.evaluate(() => { const fc = __game.fieldCamp; fc.wake?.('check'); });
await page.evaluate(({ c }) => { const g = __game; __faceTo(c.x + 5, c.z + 8, c.x, c.z - 2, 0.6); }, { c: P.camps[0] });
await shot('03-cedar-cove-tent-and-fire');
await page.evaluate(({ c }) => __faceTo(c.x + 4, c.z + 6, c.x, c.z - 3, 0.5), { c: P.camps[1] });
await shot('04-rock-shelf-in-the-lee-of-the-ridge');
await page.evaluate(({ c }) => __faceTo(c.x - 3, c.z + 6, c.x, c.z - 20, 0.5), { c: P.camps[2] });
await shot('05-open-beach-exposed');
// Overview: a camera high over the shore looking north over the lake.
await page.evaluate(() => {
  const g = __game; g.player.update = () => {};
  g.camera.position.set(0, 70, 95); g.camera.lookAt(0, 0, -10);
});
await shot('06-overview-from-above');
// The road exit.
await page.evaluate(() => { const g = __game; for (const el of document.body.children) el.style.visibility = ''; });
await page.evaluate(() => { const g = __game; delete g.player.update; });
const out2 = await page.evaluate(() => {
  const g = __game, v = g.HUNT.exit; g.hunt.elapsed += 300; __stand(v.x + 1, v.z - 1); steps(5);
  return { inZone: g.hunt.inZone };
});
await page.keyboard.press('KeyH'); await page.waitForTimeout(300); await page.keyboard.press('KeyH');
await page.waitForTimeout(500);
const end = await page.evaluate(() => { for (let i = 0; i < 30 && __game.hunt.stage !== 'ended'; i++) steps(2); return { stage: __game.hunt.stage, outcome: __game.hunt.outcome }; });
check('the road exit ends the trip', out2.inZone && end.stage === 'ended', { ...out2, ...end });

check('no page errors', errors.length === 0, errors);
console.log(results.map((r) => r.slice(0, 300)).join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
