// Fear only from threatening cryptids. Run: npm run check:t52 [outDir]
// A harmless cryptid walking right up to you leaves fear calm; Bigfoot at the same distance
// (it can charge) scares you and keeps fear rising.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t52';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4365', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto('http://localhost:4365/?nodebugai');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
  for (const c of g.cryptids.cryptids) { c.update = () => {}; c.agent.x = 300; c.agent.z = 300; c.syncMesh?.(); }
  // A harmless cryptid (the plain roam/flee placeholder profile) joins the map.
  const shy = g.cryptids.spawn(g.cryptidProfiles.default, 300, 300);
  shy.update = () => {};
  window.__shy = shy;
});

// Fast-forward fear with a cryptid placed `d` metres in front of the player (torch on).
const near = (which, d, seconds) => page.evaluate(([which, d, seconds]) => {
  const g = __game, f = g.fear, p = g.player;
  if (!g.flashlight.on) g.flashlight.toggle();
  for (const c of g.cryptids.cryptids) { c.agent.x = 300; c.agent.z = 300; }
  const c = which === 'shy' ? window.__shy : g.cryptids.cryptids.find((q) => q.profile.id === 'bigfoot');
  p.position.set(25, 0, 25); p.yaw = 0; p.pitch = 0; // well away from the van's safe zone
  c.agent.x = 300; c.agent.z = 300; f.update(1 / 30);           // far away first...
  f.value = 0; f.lastScare.clear(); f.wasNear.clear();
  c.agent.x = 25; c.agent.z = 25 - d; c.syncMesh?.();          // ...then it steps out d m in front of you
  const trace = [];
  for (let t = 0; t < seconds; t += 1 / 30) { f.update(1 / 30); if (Math.abs(t % 1) < 1 / 30) trace.push(Math.round(f.value)); }
  return { name: c.profile.name, threatening: !!c.profile.threatening, fear: +f.value.toFixed(1), reasons: f.reasons, trace };
}, [which, d, seconds]);

const shy = await near('shy', 4, 6);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/01-harmless-cryptid-close-calm.png` });
check('a harmless cryptid 4 m away: no scare, fear stays calm', !shy.threatening && shy.fear < 1 && !shy.reasons.includes('cryptid near'), shy);
const big = await near('bigfoot', 4, 6);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/02-bigfoot-close-scared.png` });
check('Bigfoot 4 m away (it can charge): jump scare and rising fear', big.threatening && big.fear > 40 && big.reasons.includes('cryptid near'), big);
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
