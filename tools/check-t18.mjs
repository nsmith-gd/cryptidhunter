// Player noise emitter: noise value follows movement state. Run: npm run check:t18
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t18';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4322', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4322/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true;
  if (g.chupacabra) g.chupacabra.update = () => {};
  g.noiseRing.enabled = true;
  const p = g.player; p.position.set(-30, 0, 30); p.yaw = -Math.PI / 2; p.pitch = -0.55;
});
const keys = (codes, down) => page.evaluate(([c, d]) => c.forEach((k) => d ? __game.input.keys.add(k) : __game.input.keys.delete(k)), [codes, down]);
const noise = () => page.evaluate(() => {
  const p = __game.player;
  const probe = { x: p.position.x + 5, z: p.position.z };
  return { noise: +p.noise.toFixed(2), radius: +p.noiseRadius.toFixed(1), at5m: +p.noiseAt(probe).toFixed(2), hudText: document.body.innerText.match(/NOISE.*?\)/s)?.[0].replace(/\s+/g, ' ') };
});
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.waitForTimeout(400);
const still = await noise();
check('standing still is silent', still.noise === 0, still);
await page.screenshot({ path: `${out}/01-standing-silent.png` });

const gait = async (codes, name, lo, hi, shot) => {
  await keys(codes, true);
  await page.waitForTimeout(1200);
  const n = await noise();
  check(`${name} noise in [${lo}, ${hi}]`, n.noise >= lo && n.noise <= hi, n);
  await page.screenshot({ path: `${out}/${shot}.png` });
  await keys(codes, false);
  return n;
};
const crouch = await gait(['KeyW', 'ControlLeft'], 'crouch-walk', 0.1, 0.2, '02-crouch-quiet');
await page.waitForTimeout(1500);
const walk = await gait(['KeyW'], 'walk', 0.4, 0.5, '03-walk-medium');
await page.waitForTimeout(1500);
const sprint = await gait(['KeyW', 'ShiftLeft'], 'sprint', 0.9, 1.0, '04-sprint-loud');
check('crouch < walk < sprint', crouch.noise < walk.noise && walk.noise < sprint.noise, { crouch: crouch.noise, walk: walk.noise, sprint: sprint.noise });
check('louder gaits carry further', crouch.radius < walk.radius && walk.radius < sprint.radius, { crouch: crouch.radius, walk: walk.radius, sprint: sprint.radius });
check('crouching is out of earshot at 5 m, sprinting is not', crouch.at5m === 0 && sprint.at5m > 0.5, { crouch: crouch.at5m, sprint: sprint.at5m });
await page.waitForTimeout(2000);
const stopped = await noise();
check('noise fades to silent after stopping', stopped.noise === 0, stopped);
check('debug readout shows the value', /NOISE/.test(walk.hudText || '') && /0\.4\d medium/.test(walk.hudText), walk.hudText);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
