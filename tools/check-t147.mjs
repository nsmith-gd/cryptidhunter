// Level 9 Pine Barrens + Jersey Devil (#147). Run: npm run check:t147 [outDir]
// Greybox barrens: clearings (open sky), canopy gaps, the nest stand, rock (furnace ruins, outcrop),
// the road camp. The aerial proxy is sight-only: hidden under canopy or behind rock; light is seen
// furthest, movement next, stillness least. A swoop is always signalled (shriek, hover, eyes flare)
// and only lands if you're still exposed; get under the pines and it aborts. It perches after a
// swoop: the tag window, where the loaned tag launcher (Q) can tag it.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t147';
mkdirSync(out, { recursive: true });
const PORT = 4447;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 540 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`); console.log(results.at(-1).slice(0, 420)); };
const steps = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const shot = async (n) => { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${n}.png` }); };
const tp = (x, z) => page.evaluate(([x, z]) => { const p = __game.player; p.position.set(x, 0, z); p.velocity.set(0, 0, 0); }, [x, z]);
const torch = (on) => page.evaluate((on) => { const f = __game.flashlight; f.battery = 1; if (f.on !== on) f.toggle(); }, on);
const devil = () => page.evaluate(() => { const d = __game.jerseyDevil; return { state: d.state, aware: +d.awareness.toFixed(2), visible: +d.visible.toFixed(2), swoops: d.swoops.map((s) => s.result), hist: d.history.slice(-6).map((h) => `${h.to}:${h.why}`), tagWindow: d.tagWindow, tagged: !!d.tagged, y: +d.pos.y.toFixed(1) }; });
// Put the devil right overhead (as if its patrol just reached you), fresh.
const overhead = (x, z, alt = 24) => page.evaluate(([x, z, alt]) => { const d = __game.jerseyDevil; d.pos.set(x + 6, alt, z + 6); d.awareness = 0; d.cue = null; d.cooldown = 0; d.setState('patrol', 'test'); }, [x, z, alt]);

await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/?map=pinebarrens&seed=147&nodebugai&simpaused`);
await page.waitForFunction(() => window.__game && document.getElementById('prep-panel'), null, { timeout: 240000 });
const prep = await page.evaluate(() => document.getElementById('prep-panel').innerText.split('\n').slice(0, 3).join(' | '));
await page.evaluate(() => {
  const g = __game; g.expedition.commit(); g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = true;
});
await steps(3);
const m = await page.evaluate(() => {
  const g = __game, M = g.map, L = M.landmarks;
  return { clearings: M.clearings.length, gaps: M.gaps.length, perches: M.perches.length, coverBarren: M.coverAt(L.bigBarren.x, L.bigBarren.z), coverWoods: M.coverAt(-100, 100) + M.coverAt(60, 100) + M.coverAt(-90, -10),
    scene: ['devil-nest', 'furnace-stack', 'sandstone-outcrop', 'camp-leanto', 'jersey-devil', 'extraction-van'].filter((n) => g.scene.getObjectByName(n)), slots: g.loadout.slots, tags: g.tags.carried, target: g.hunt.target, bigfoot: g.cryptids.cryptids.length };
});
check('Level 9 Pine Barrens: $15,000 trip; clearings, canopy gaps, the nest stand, rock and the road camp; the Jersey Devil in the sky; a loaned tag launcher in slot 4',
  /Pine Barrens/.test(prep) && /\$15,000/.test(prep) && m.clearings >= 3 && m.gaps >= 5 && m.perches >= 4 && m.coverBarren === 0 && m.coverWoods >= 2 && m.scene.length === 6
  && m.slots[3] === 'tagLauncher' && m.tags === 2 && m.target === 'Jersey Devil' && m.bigfoot === 0, { prep, ...m });
await shot('01-road-camp');

// 1) Under the canopy, torch on, devil right overhead: it can't see you.
const woods = await page.evaluate(() => { const g = __game; for (const [x, z] of [[-100, 100], [60, 100], [-90, -10], [100, -100]]) if (g.map.coverAt(x, z) === 1) return { x, z }; return null; });
await tp(woods.x, woods.z); await torch(true); await overhead(woods.x, woods.z);
await steps(5 * 60);
const hid = await devil();
// 2) Behind the furnace ruins in the open: the rock hides you.
const L = await page.evaluate(() => __game.map.landmarks);
await tp(L.furnace.x, L.furnace.z - 4.5); await page.evaluate((L) => { const d = __game.jerseyDevil; d.pos.set(L.furnace.x, 8, L.furnace.z + 25); d.awareness = 0; d.cue = null; d.setState('patrol', 'test'); d.patrolPts = [{ x: L.furnace.x, z: L.furnace.z + 25 }]; }, L);
await steps(3 * 60);
const rock = await page.evaluate(() => ({ visible: __game.jerseyDevil.visible, cover: __game.map.coverAt(__game.player.position.x, __game.player.position.z), aware: __game.jerseyDevil.awareness }));
await page.evaluate(() => { __game.jerseyDevil.patrolPts = [...__game.map.clearings, __game.map.nest]; });
check("it can't see through the pine canopy (torch on, right overhead) or through rock", hid.visible === 0 && hid.aware === 0 && hid.state === 'patrol' && rock.visible === 0 && rock.cover === 0, { hid, rock });

// 3) Light, motion, stillness in the open: how far it sees you.
const ranges = await page.evaluate((L) => {
  const g = __game, d = g.jerseyDevil, p = g.player; p.position.set(L.bigBarren.x, 0, L.bigBarren.z); p.velocity.set(0, 0, 0);
  d.pos.set(L.bigBarren.x, 24, L.bigBarren.z);
  const f = g.flashlight; const out = {};
  if (f.on) f.toggle(); out.still = d.sightRange();
  p.velocity.set(3, 0, 0); out.moving = d.sightRange(); p.velocity.set(0, 0, 0);
  f.toggle(); out.light = d.sightRange();
  return out;
}, L);
check('in the open it sees light furthest, then movement, then stillness', ranges.light > ranges.moving && ranges.moving > ranges.still && ranges.still > 0, ranges);

// 4) Torch on in the big barren: it finds you, SIGNALS (hover, shriek, eyes flare), then dives. You stay: hit.
await tp(L.bigBarren.x, L.bigBarren.z); await torch(true); await overhead(L.bigBarren.x, L.bigBarren.z, 24);
let sig = null;
for (let i = 0; i < 40 && !sig; i++) { await steps(15); const d = await devil(); if (d.state === 'signal') sig = d; }
await page.evaluate(() => { const g = __game, d = g.jerseyDevil, p = g.player, e = g.camera.position; p.yaw = Math.atan2(-(d.pos.x - p.position.x), -(d.pos.z - p.position.z)); p.pitch = Math.atan2(d.pos.y - e.y, Math.hypot(d.pos.x - e.x, d.pos.z - e.z)); });
await steps(60);
const tele = await page.evaluate(() => ({ state: __game.jerseyDevil.state, eyes: __game.jerseyDevil.mesh.userData.eyeGlow.intensity, toast: document.body.innerText.includes('shriek right overhead'), fear: Math.round(__game.fear?.value ?? 0) }));
await shot('02-the-signal-hover-and-shriek');
const h0 = await page.evaluate(() => __game.survival.health.value);
for (let i = 0; i < 30; i++) { await steps(10); if ((await devil()).swoops.length) break; }
const hit = await devil();
const h1 = await page.evaluate(() => Math.round(__game.survival.health.value));
check('exposed with a light, it finds you and SIGNALS first (hovers, shrieks, eyes flare) for a moment, then dives: staying in the open, you get raked',
  !!sig && tele.state === 'signal' && tele.eyes > 3 && tele.toast && hit.swoops[0] === 'hit' && h1 < h0, { sig: sig?.hist, tele, swoops: hit.swoops, health: [Math.round(h0), h1] });

// 5) Next time: when it signals, run under the pines. It aborts.
await page.evaluate(() => { const d = __game.jerseyDevil; d.cooldown = 0; d.setState('patrol', 'test'); d.awareness = 0; });
await tp(L.bigBarren.x + 21, L.bigBarren.z); await torch(true); await overhead(L.bigBarren.x + 21, L.bigBarren.z);
let sig2 = false;
for (let i = 0; i < 40 && !sig2; i++) { await steps(15); sig2 = (await devil()).state === 'signal'; }
await torch(false);
const cover = await page.evaluate((L) => { const g = __game; for (let r = 24; r < 40; r++) { const x = L.bigBarren.x + r, z = L.bigBarren.z; if (g.map.coverAt(x, z) === 1 && !g.map.colliders.some((b) => x > b.min.x - 0.6 && x < b.max.x + 0.6 && z > b.min.z - 0.6 && z < b.max.z + 0.6)) return { x, z }; } return null; }, L);
await tp(cover.x, cover.z);   // a few steps into the trees
for (let i = 0; i < 20; i++) { await steps(10); const d = await devil(); if (d.swoops.length > 1 || d.state === 'climb') break; }
const ab = await devil();
await shot('03-under-the-pines-it-aborts');
check('when it signals, getting under the canopy makes it abort the swoop (it lost you)', sig2 && ab.swoops.at(-1) === 'aborted', { swoops: ab.swoops, hist: ab.hist });

// 6) An exposed fire draws it in (warmth vs concealment).
await page.evaluate((L) => { const g = __game, d = g.jerseyDevil; d.setState('patrol', 'test'); d.cue = null; d.awareness = 0; d.pos.set(L.eastBarren.x + 40, 24, L.eastBarren.z);
  g.fieldKit.fires.push({ x: L.eastBarren.x, z: L.eastBarren.z, left: 120, mesh: new g.THREE.Group(), flame: new g.THREE.Object3D(), light: { intensity: 0 } }); }, L);
await tp(woods.x, woods.z);
await steps(60);
const fire = await devil();
await page.evaluate(() => { __game.fieldKit.fires.length = 0; __game.jerseyDevil.cue = null; });
check('a fire out in the open draws it to circle over it', fire.state === 'investigate' && fire.hist.some((h) => /fire/.test(h)), fire);

// 7) After a swoop it perches on a dead pine: the tag window. Tag it with the launcher (slot 4, Q).
await page.evaluate(() => { const d = __game.jerseyDevil; d.setState('climb', 'test'); d.stateTime = 5; });
for (let i = 0; i < 40; i++) { await steps(15); if ((await devil()).tagWindow) break; }
const per = await page.evaluate(() => ({ ...__game.jerseyDevil.perch, window: __game.jerseyDevil.tagWindow }));
// Stand 18 m off at the nest's edge and aim.
await page.evaluate((per) => { const g = __game, p = g.player; p.position.set(per.x + 14, 0, per.z + 11); p.velocity.set(0, 0, 0); g.sim.step();
  const e = g.camera.position; p.yaw = Math.atan2(-(per.x - e.x), -(per.z - e.z)); p.pitch = Math.atan2(per.y - e.y, Math.hypot(per.x - e.x, per.z - e.z)); }, per);
await steps(2);
await shot('04-perched-tag-window');
await page.keyboard.press('Digit4'); await page.keyboard.press('KeyQ'); await steps(3);
const tagged = await page.evaluate(() => ({ tagged: !!__game.jerseyDevil.tagged, tags: __game.tags.carried, log: __game.tags.log.at(-1), state: __game.jerseyDevil.state }));
check('it perches on a dead pine after a swoop (the opportunity window); the tag launcher (slot 4, Q) tags it in range',
  per.window && tagged.tagged && tagged.tags === 1 && tagged.log?.ok, { per, tagged });

check('no page errors', errors.length === 0, errors);
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
