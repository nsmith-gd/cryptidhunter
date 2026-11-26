// Pack, mass/volume and load penalty check (#69). Run: npm run build && node tools/check-t69.mjs [outDir]
// A heavy pack slows walking and sprinting and drains stamina faster; unloading (U) helps; a packed
// item can be dug out into a quick slot; a dropped stack can be picked back up; the loadout screen
// shows the load ratio.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t69';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4369', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
await page.goto('http://localhost:4369/?map=forest&nodebugai&loadout=bait,trailCamera,audioLure,spareBatteries&pack=nightVision,knockStick&water=8');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.waitForTimeout(1500);

// The loadout screen (briefing overlay) shows pack volume and load ratio.
const picker = await page.evaluate(() => document.getElementById('loadout-picker')?.innerText ?? '');
check('the loadout screen shows pack volume and the load ratio', /PACK/.test(picker) && /LOAD/.test(picker) && /%/.test(picker), picker.split('\n').slice(-3));
await page.screenshot({ path: `${out}/01-loadout-screen-heavy.png` });
// Real clicks: take a litre out, then cycle the knock stick pack -> camp.
const clickErr = await (async () => {
  try {
    // DOM clicks (headless frames are too slow for Playwright's pointer clicks on this page).
    await page.evaluate(() => document.querySelector('#loadout-picker button[data-water="-1"]').click());
    await page.evaluate(() => document.querySelector('#loadout-picker button[data-id="knockStick"]').click());
    return null;
  } catch (e) { return e.message.split('\n')[0]; }
})();
const clicked = await page.evaluate(() => ({ water: __game.camp.state.water, pack: __game.camp.state.pack, text: document.getElementById('loadout-picker').innerText.split('\n').slice(-2) }));
check('clicking the loadout screen changes water and pack, and the load updates', !clickErr && clicked.water === 7 && !clicked.pack.includes('knockStick'), { clickErr, clicked });

// Measure: walk and sprint speed over 3 s (fixed steps), and stamina used by 2 s of sprinting.
const measure = () => page.evaluate(() => {
  const g = __game, p = g.player, inp = g.input;
  g.cryptids.update = () => {}; g.huntFailure.enabled = false;
  g.loadout.update(0);
  const run = (keys, secs) => {
    p.position.set(0, 0, 60); p.velocity.set(0, 0, 0); p.yaw = 0; p.stamina = 1; p.exhausted = false; p.sinceSprint = 9;
    inp.keys.clear(); for (const k of keys) inp.keys.add(k);
    const z0 = p.position.z;
    for (let t = 0; t < secs; t += 1 / 30) p.update(1 / 30);
    inp.keys.clear();
    return { metres: +(z0 - p.position.z).toFixed(2), stamina: +p.stamina.toFixed(3) };
  };
  const walk = run(['KeyW'], 3), sprint = run(['KeyW', 'ShiftLeft'], 2);
  const l = g.loadout.load;
  return { walk: walk.metres, sprint: sprint.metres, staminaUsed: +(1 - sprint.stamina).toFixed(3), kg: +l.total.toFixed(1), ratio: +l.ratio.toFixed(2), volume: +l.volume.toFixed(1) };
});
const heavy = await measure();
const dropped = await page.evaluate(() => { const r = []; while (__game.loadout.water > 0) r.push(__game.loadout.lighten()); return r; });
const light = await measure();
check('a heavy pack is slower to walk with', heavy.walk < light.walk * 0.85, { heavy, light });
check('a heavy pack is slower to sprint with', heavy.sprint < light.sprint * 0.85, { heavy: heavy.sprint, light: light.sprint });
check('a heavy pack drains stamina faster when running', heavy.staminaUsed > light.staminaUsed * 1.3, { heavy: heavy.staminaUsed, light: light.staminaUsed });
check('unloading (U pours out water) lightens the load', dropped.every((d) => d === 'water') && light.kg < heavy.kg - 6, { dropped, heavyKg: heavy.kg, lightKg: light.kg });
check('speed never drops below the 45% floor', heavy.walk >= light.walk * 0.45, heavy);

// Dig a packed item out: it swaps into the active slot after a short rummage, not instantly.
const dig = await page.evaluate(() => {
  const L = __game.loadout;
  L.select(0);
  L.startDig('nightVision');
  L.update(0.5);
  const mid = L.slots.includes('nightVision');
  for (let i = 0; i < 30; i++) L.update(1 / 30);
  return { mid, slots: [...L.slots], pack: [...L.pack] };
});
check('digging an item out of the pack takes a moment, then it is in a quick slot', !dig.mid && dig.slots[0] === 'nightVision' && dig.pack.includes('bait'), dig);

// With no water left, U leaves the heaviest packed stack on the ground; walking back picks it up.
const cache = await page.evaluate(() => {
  const g = __game, L = g.loadout, p = g.player;
  p.position.set(10, 0, 60);
  const before = L.load.total;
  const left = L.lighten();
  const after = L.load.total;
  const onGround = L.caches.length;
  p.position.set(14, 0, 60); L.update(0.1);           // walk away
  p.position.set(10.3, 0, 60); L.update(0.1);         // and back over it
  return { left, before: +before.toFixed(1), after: +after.toFixed(1), onGround, back: L.pack.includes(left), caches: L.caches.length, carried: g.bait.carried };
});
check('U leaves the heaviest packed item on the ground (lighter), and walking back picks it up', cache.left && cache.after < cache.before && cache.onGround === 1 && cache.back && cache.caches === 0, cache);

// In-game: the HUD line under the quick slots.
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden');
  g.loadout.water = 4; g.loadout.update(0);
  g.player.position.set(0, 0, 60); g.player.yaw = 0;
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/02-in-game-heavy-pack-hud.png` });
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
