// Igopogo (#136) captures: the proxy surfaced in the bay, seen from the Point (zoomed, as
// through binoculars), from the beach, and close up. Run: npm run build && node tools/capture-t136.mjs [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t136';
mkdirSync(out, { recursive: true });
const PORT = 4546;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };




await page.goto(`http://localhost:${PORT}/?map=simcoe&simpaused&nodebugai&seed=31&nozones`);
await page.waitForFunction(() => window.__game?.igopogo, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.huntFailure.enabled = false;
  window.steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  const ig = g.igopogo;
  for (let i = 0; i < 20000 && ig.riseLevel < 1; i++) steps(10);
  for (const el of document.body.children) if (el !== g.renderer.domElement) el.style.visibility = 'hidden';
  for (const ch of g.camera.children) if (!ch.isLight) ch.visible = false;
  g.player.update = () => {};
  window.__view = (x, y, z, fov) => { const h = new g.THREE.Vector3(); ig.head.getWorldPosition(h);
    g.camera.position.set(x, y, z); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(h.x, h.y - 0.9, h.z); g.sim.frame(1 / 60); };
});
const views = await page.evaluate(() => {
  const g = __game, o = g.map.observation[0], ig = g.igopogo, p = ig.mesh.position;
  return { o: { x: o.x, y: g.map.heightAt(o.x, o.z) + 1.6, z: o.z }, p: { x: p.x, z: p.z }, zone: ig.schedule.zone.id };
});
console.log(views);
const shots = [
  ['01-from-the-point-binocular-view', [views.o.x, views.o.y, views.o.z, 12]],
  ['02-from-the-point-naked-eye', [views.o.x, views.o.y, views.o.z, 60]],
  ['03-from-the-beach', [views.p.x + 6, 1.7, views.p.z + 26, 40]],
  ['04-close-up-greybox-proxy', [views.p.x + 5, 1.6, views.p.z + 7, 50]],
];
for (const [n, v] of shots) {
  await page.evaluate((v) => __view(...v), v);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${n}.png` });
}
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'ok');
await browser.close();
server.kill();
