// Clues & Tracking vs GDD (#84). Run: npm run check:t84 [outDir]
// Every starter clue type (footprint, hair, scratch marks, snapped branch, droppings) shows up
// on Bigfoot's real route; examining each (E, real key) gives a direction, and following it leads
// to fresher signs (toward Bigfoot). Deer tracks are an ordinary-animal false lead. Droppings can be
// sampled (X) and a snapped branch photographed as evidence. Pine Hollow, seed 84, fixed-step sim.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t84';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4383', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

await page.goto('http://localhost:4383/?map=forest&seed=84&nodebugai&simpaused');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game; g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start(); g.aiDebug?.setVisible(false);
  if (g.huntFailure) g.huntFailure.enabled = false;
  g.fear.update = () => {};
  // Let Bigfoot wander for 3 minutes (player parked far away) so its trail has every kind of sign.
  const far = () => g.player.position.set(140, 0, 140);
  for (let i = 0; i < 180 * 30; i++) { far(); g.cryptids.update(1 / 30); g.clueTrails.update(); g.clues.update(1 / 30); }
  for (const c of g.cryptids.cryptids) c.update = () => {};   // then hold it still
});

const counts = await page.evaluate(() => {
  const n = {}; for (const c of __game.clues.clues) n[`${c.cryptidId}:${c.type}`] = (n[`${c.cryptidId}:${c.type}`] ?? 0) + 1; return n;
});
const TYPES = ['footprint', 'hair', 'scratch', 'branch', 'scat'];
check('every starter clue type is on Bigfoot\'s trail (footprint, hair, scratch marks, snapped branch, droppings)', TYPES.every((t) => counts[`bigfoot:${t}`] > 0), counts);
check('deer tracks (ordinary-animal false leads) are in the woods too', (counts['deer:deerTrack'] ?? 0) > 20, { deer: counts['deer:deerTrack'] });

// Stand by a clue of `type` (cryptid filter), look at it; returns the clue's id.
const goTo = (type, cryptid = 'bigfoot', mid = true) => page.evaluate(([type, cryptid, mid]) => {
  const g = __game, p = g.player;
  const list = g.clues.clues.filter((q) => q.type === type && q.cryptidId === cryptid && !q.found && q.object.visible);
  if (!list.length) return null;
  list.sort((a, b) => b.age - a.age);
  const c = mid ? list[Math.floor(list.length / 2)] : list[0];
  // Marks on a trunk: stand where Bigfoot stood (outside the tree); ground signs: just beside them.
  if (c.y > 1) p.position.set(c.origin.x, 0, c.origin.z); else p.position.set(c.x + 1.2, 0, c.z + 1.2);
  p.velocity.set(0, 0, 0);
  g.sim.step();
  const e = g.camera.position;
  p.yaw = -Math.atan2(c.x - e.x, -(c.z - e.z));
  p.pitch = Math.atan2((c.y + 0.03) - e.y, Math.hypot(c.x - e.x, c.z - e.z));
  g.sim.step();
  return { id: c.id, x: c.x, z: c.z, age: c.age, y: c.y };
}, [type, cryptid, mid]);
const step = (n = 1) => page.evaluate((n) => { for (let i = 0; i < n; i++) __game.sim.step(); }, n);
const lastHint = () => page.evaluate(() => __game.journal.entries[__game.journal.entries.length - 1]?.hint ?? null);
// From a clue, are there fresher Bigfoot signs within 25 m in the hinted direction?
const followable = (clue, dir) => page.evaluate(([clue, dir]) => {
  const h = dir * Math.PI / 4, fx = Math.sin(h), fz = -Math.cos(h);
  return __game.clues.clues.filter((c) => c.cryptidId === 'bigfoot' && c.id !== clue.id && c.age < clue.age - 2).some((c) => {
    const dx = c.x - clue.x, dz = c.z - clue.z, d = Math.hypot(dx, dz);
    return d > 2 && d < 25 && (dx * fx + dz * fz) / d > Math.cos(Math.PI / 4 + 0.2);
  });
}, [clue, dir]);

const followed = {};
for (const t of TYPES) {
  const c = await goTo(t);
  if (!c) { followed[t] = 'none on trail'; continue; }
  await page.keyboard.press('KeyE');
  await step(2);
  const n0 = followed.__n ?? 0, n1 = await page.evaluate(() => __game.journal.entries.length);
  followed.__n = n1;
  const hint = n1 > n0 ? await lastHint() : null;   // only this clue's own journal entry counts
  const m = hint?.match(/heading ([a-z-]+)/);
  followed[t] = { hint, follow: m ? await followable(c, COMPASS.indexOf(m[1])) : /close/.test(hint ?? '') };
  if (t === 'branch') { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/01-snapped-branch-examined.png` }); }
  if (t === 'scat') { await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/02-droppings-examined.png` }); }
}
delete followed.__n;
check('examining each clue type says which way Bigfoot went, and that way leads to fresher signs', TYPES.every((t) => followed[t]?.follow === true), followed);

// Deer tracks: a false lead.
const deer = await goTo('deerTrack', 'deer');
await page.keyboard.press('KeyE');
await step(2);
const deerHint = await lastHint();
const deerDesc = await page.evaluate(() => __game.journal.entries[__game.journal.entries.length - 1]?.description);
await page.keyboard.press('KeyX');
await step(2);
const deerEvidence = await page.evaluate(() => __game.evidence.items.length);
await page.evaluate(() => __game.sim.frame(0)); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/03-deer-tracks-false-lead.png` });
const verdict = await page.evaluate(() => { const v = __game.journal.verdict(); return v.likely?.name ?? v.ranking[0]?.name; });
check('deer tracks read as an ordinary animal: no direction to a cryptid, nothing to collect, and the journal still names Bigfoot', deer && /ordinary animal/.test(deerHint) && /deer/.test(deerDesc) && deerEvidence === 0 && verdict === 'Bigfoot', { deerHint, deerDesc, deerEvidence, verdict });

// Droppings -> sample (X); snapped branch -> photo evidence.
await goTo('scat', 'bigfoot', false);
await page.keyboard.press('KeyX');
await step(2);
await page.mouse.move(480, 270); await step(2);   // park the pointer first (moving it turns the view)
const br = await goTo('branch', 'bigfoot', false);
await page.mouse.down({ button: 'right' }); await step(30);
await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
await page.mouse.up({ button: 'right' }); await step(5);
const ev = await page.evaluate(() => __game.evidence.items.map((i) => i.name));
check('droppings can be sampled (X) and a snapped branch photographed as evidence', ev.includes('Droppings sample') && ev.includes('Disturbance photo'), { ev, branchAt: br });

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
