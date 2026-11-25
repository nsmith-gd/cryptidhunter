// Swamp pixel water: shader compiles, is applied to the swamp water, and captures/clips of it
// still and in motion (stability measured on the water region). Run: npm run check:t41 [outDir]
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t41';
const quick = process.argv.includes('--quick');
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4334', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto('http://localhost:4334/?map=swamp&nodebugai');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.huntFailure.enabled = false;
  g.mothman.update = () => {}; g.mothman.mesh.visible = false; g.chupacabra.update = () => {}; g.chupacabra.mesh.visible = false;
  g.cryptids.update = () => {};
  const st = document.createElement('style');
  st.textContent = 'body > div, #hud, #crosshair, #trail-compass, #trail-hint, #journal { display: none !important; }';
  document.head.append(st);
});
const info = await page.evaluate(() => ({ meshes: __game.water?.meshes.length ?? 0, patched: __game.water?.meshes.every((m) => m.material.userData.pixelWater) }));
check('pixel water is applied to the swamp water surfaces', info.meshes >= 2 && info.patched, info);

const view = async (name, x, z, lookX, lookZ, pitch, y = 0.34, light = false) => {
  await page.evaluate(([x, z, lookX, lookZ, pitch, y, light]) => {
    const g = __game, p = g.player; p.position.set(x, y, z); p.velocity.set(0, 0, 0);
    p.yaw = Math.atan2(-(lookX - x), -(lookZ - z)); p.pitch = pitch;
    if (g.flashlight.on !== light) g.flashlight.toggle();
  }, [x, z, lookX, lookZ, pitch, y, light]);
  await page.waitForTimeout(900);
  if (name) await page.screenshot({ path: `${out}/${name}.png` });
};
// Mean absolute change of the water region between consecutive frames (0..255).
const flicker = async (frames, gap) => page.evaluate(async ([frames, gap]) => {
  const src = __game.renderer.domElement, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); let prev = null, sum = 0, n = 0;
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => setTimeout(r, gap));
    g.drawImage(src, 0, 0);
    const d = g.getImageData(0, Math.floor(c.height * 0.62), c.width, Math.floor(c.height * 0.3)).data;
    if (prev) { let s = 0; for (let k = 0; k < d.length; k += 4) s += Math.abs(d[k] - prev[k]) + Math.abs(d[k + 1] - prev[k + 1]) + Math.abs(d[k + 2] - prev[k + 2]); sum += s / (d.length / 4) / 3; n++; }
    prev = d;
  }
  return +(sum / n).toFixed(2);
}, [frames, gap]);

await view('01-boardwalk-over-water-moonlit', 0, 40, 2, 10, -0.12);
await view('02-lamp-reflection-shack', -18, 17, -28, 13, -0.18);
await view('03-flashlight-on-water', 1.5, 30, 6, 24, -0.55, 0.34, true);
await view('04-low-across-the-channel', 6, 15, 30, 0, -0.05);
if (!quick) {
  // Still camera: only the stepped ripples should change, gently.
  await view(null, 0, 40, 2, 10, -0.12);
  const still = await flicker(12, 150);
  check('still camera: the water animates gently (no flicker)', still > 0.05 && still < 6, { meanChange: still });
  // Motion clip: walk slowly along the boardwalk, frames for a GIF.
  await view(null, 0, 41, 0, 20, -0.15);
  await page.evaluate(() => __game.input.keys.add('ControlLeft'));
  await page.evaluate(() => __game.input.keys.add('KeyW'));
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(220); await page.screenshot({ path: `${out}/_frame${String(i).padStart(2, '0')}.png` }); }
  await page.evaluate(() => { __game.input.keys.delete('KeyW'); __game.input.keys.delete('ControlLeft'); });
  try {
    execFileSync('python3', ['-c', `
import glob,os
from PIL import Image
fs=sorted(glob.glob('${out}/_frame*.png'))
ims=[Image.open(f).convert('RGB').resize((480,270), Image.NEAREST) for f in fs]
ims[0].save('${out}/05-walking-the-boardwalk.gif', save_all=True, append_images=ims[1:], duration=160, loop=0)
for f in fs: os.remove(f)
`]);
    check('motion clip written', true, {});
  } catch (e) { check('motion clip written', false, String(e).slice(0, 200)); }
}
check('no page or shader errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
