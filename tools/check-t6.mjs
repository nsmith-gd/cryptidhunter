// Automated check for Bigfoot (placeholder). Run: npm run check:t6 [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t6';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4320/?nosenses');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => __game.overlay.classList.add('hidden'));

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const bf = () => page.evaluate(() => {
  const c = __game.cryptids.cryptids.find((k) => k.profile.id === 'bigfoot');
  if (!c) return null;
  const box = new __game.THREE.Box3().setFromObject(c.mesh);
  return { x: +c.agent.x.toFixed(2), z: +c.agent.z.toFixed(2), state: c.state, dist: +c.playerDistance.toFixed(2),
    speed: +c.agent.currentSpeed.toFixed(2), height: +(box.max.y - box.min.y).toFixed(2),
    walkable: c.agent.grid.isWalkable(c.agent.x, c.agent.z), footprint: c.profile.clues?.footprint?.length };
});
const placePlayer = (x, z) => page.evaluate(([x, z]) => { const p = __game.player; p.position.set(x, 0, z); p.velocity.set(0, 0, 0); }, [x, z]);
const lookAtBigfoot = () => page.evaluate(() => {
  const p = __game.player, c = __game.cryptids.cryptids.find((k) => k.profile.id === 'bigfoot').agent;
  p.yaw = Math.atan2(-(c.x - p.position.x), -(c.z - p.position.z)); p.pitch = 0.05;
});

await page.waitForTimeout(300);
const s0 = await bf();
check('Bigfoot spawns in the level', !!s0, s0);
// (#24 replaced the capsule with a model; its bounds include the crest and arms.)
check('body is about 2.4 m tall', s0 && Math.abs(s0.height - 2.4) < 0.3, s0);
check('stands on walkable ground', s0?.walkable, s0);
check('has big-footprint clue data', s0?.footprint >= 0.4, s0);

// Player parked far away; let it wander.
await placePlayer(-36, 36);
await page.waitForTimeout(3000);
const r = await bf();
check('roams while player is far', r.state === 'roam' && Math.hypot(r.x - s0.x, r.z - s0.z) > 0.5, r);

// Shy: 13 m away already spooks it (generic cryptids wait until 10 m).
await placePlayer(r.x + 13, r.z);
await lookAtBigfoot();
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/01-bigfoot-spotted-13m.png` });
const f0 = await bf();
check('shy: flees at 13 m', f0.state === 'flee', f0);
let maxSpeed = 0;
for (let i = 0; i < 8; i++) { await page.waitForTimeout(250); maxSpeed = Math.max(maxSpeed, (await bf()).speed); }
await lookAtBigfoot();
await page.waitForTimeout(100);
await page.screenshot({ path: `${out}/02-bigfoot-running-off.png` });
const f1 = await bf();
check('fast flee: outruns a sprinting player (> 6 m/s)', maxSpeed > 6.5, { maxSpeed });
check('runs away from you', f1.dist - f0.dist > 8, { from: f0.dist, to: f1.dist });

// Close-up for scale next to the player's eye line (1.68 m).
await placePlayer(-36, 36);
await page.waitForTimeout(1500);
const c2 = await bf();
await page.evaluate(([x, z]) => {
  // Freeze it for the portrait shot by parking the player far but rendering from close by.
  const cr = __game.cryptids.cryptids.find((k) => k.profile.id === 'bigfoot');
  cr.update = () => {};
}, [c2.x, c2.z]);
await page.evaluate(([x, z]) => { const p = __game.player; p.position.set(x + 4, 0, z + 1.5); p.velocity.set(0, 0, 0); }, [c2.x, c2.z]);
await lookAtBigfoot();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/03-bigfoot-scale-4m.png` });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
