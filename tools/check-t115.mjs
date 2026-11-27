// Stalking (#115): once Bigfoot has spotted you in Pine Hollow it stalks instead of fleeing.
//   A  you stand still, torch off, looking away  -> it CLOSES in (distance falls), no flee
//   B  you turn and walk at it                   -> it RETREATS (distance grows), no flee
//   C  you stand and watch it                    -> it CIRCLES you (bearing sweeps round), no flee
//   D  you sprint straight at it                 -> only now does it break and FLEE
// Captures: a top-down trace of its path around you (colour per mode) and an in-game view of it
// watching you from the treeline. The sim is stepped directly (?simpaused).
// Run: npm run check:t115 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t115';
mkdirSync(out, { recursive: true });
const PORT = 4415;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

await page.goto(`http://localhost:${PORT}/?map=forest&simpaused&nodebugai&seed=11&mute`);
await page.waitForFunction(() => window.__game?.cryptids?.cryptids?.length, null, { timeout: 150000 });
const run = await page.evaluate(() => {
  const g = __game, P = g.player, bf = g.cryptids.cryptids[0];
  g.overlay.classList.add('hidden'); g.input.locked = true; g.hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;
  if (g.dread) g.dread.update = () => {};                 // keep its level fixed (level 1) for this test
  // You at the edge of the trailhead clearing; it in the open 24 m north of you.
  const home = { x: 0, z: 118 };
  P.position.set(home.x, 0, home.z); P.velocity.set(0, 0, 0); P.yaw = Math.PI;   // facing south, away from it
  bf.agent.x = 2; bf.agent.z = home.z - 24; bf.agent.path = null; bf.enterRoam('test start');
  bf.perception.awareness = 1; bf.perception.detected = true; bf.perception.lastSeen = { x: home.x, z: home.z, t: 0 };
  if (g.flashlight.on) g.flashlight.toggle();
  const track = [];
  const bearing = () => Math.atan2(bf.agent.z - P.position.z, bf.agent.x - P.position.x);
  const dist = () => Math.hypot(bf.agent.x - P.position.x, bf.agent.z - P.position.z);
  const keep = () => { bf.perception.awareness = Math.max(bf.perception.awareness, 1); bf.perception.detected = true; };   // it keeps you in view
  const phase = (name, seconds, each) => {
    const states = new Set(), d0 = dist(), b0 = bearing();
    let sweep = 0, prevB = b0, minD = Infinity, maxD = 0;
    for (let i = 0; i < seconds * 60; i++) {
      each?.(i);
      if (name !== 'D') keep();
      g.sim.step();
      states.add(bf.state);
      const b = bearing(); let db = b - prevB; db = Math.atan2(Math.sin(db), Math.cos(db)); sweep += Math.abs(db); prevB = b;
      const d = dist(); minD = Math.min(minD, d); maxD = Math.max(maxD, d);
      if (i % 15 === 0) track.push({ phase: name, x: +bf.agent.x.toFixed(2), z: +bf.agent.z.toFixed(2), px: +P.position.x.toFixed(2), pz: +P.position.z.toFixed(2), state: bf.state, mode: bf.stalk?.mode ?? null });
    }
    g.input.keys.clear();
    return { name, states: [...states], d0: +d0.toFixed(1), d1: +dist().toFixed(1), minD: +minD.toFixed(1), maxD: +maxD.toFixed(1), sweepDeg: Math.round(sweep * 180 / Math.PI), flees: bf.flees };
  };
  const faceIt = () => { P.yaw = Math.atan2(-(bf.agent.x - P.position.x), -(bf.agent.z - P.position.z)); };
  // A: still, dark, looking away.
  const A = phase('A', 30);
  // B: turn and walk at it for 4 s.
  const B = phase('B', 6, (i) => { faceIt(); g.input.keys.clear(); if (i < 240) g.input.keys.add('KeyW'); });
  // C: stand and watch it.
  const C = phase('C', 25, () => faceIt());
  // D: sprint straight at it.
  const D = phase('D', 12, () => { faceIt(); g.input.keys.clear(); g.input.keys.add('KeyW'); g.input.keys.add('ShiftLeft'); P.stamina = 1; });
  return { A, B, C, D, log: bf.stalkLog, history: bf.history.map((h) => `${h.from}->${h.to} (${h.why})`), track, tiers: { fleeInside: 8, stalkMin: 15 } };
});
const { A, B, C, D } = run;
check('A: still, quiet and looking away, it closes in on you (stalking, not fleeing)', A.states.includes('stalk') && !A.states.includes('flee') && A.d1 < A.d0 - 3, A);
check('A: it keeps its distance (never closer than its stalking range, never on top of you)', A.minD >= 8, { minDistance: A.minD });
check('B: turn and walk at it, and it backs off (retreats, still not fleeing)', B.states.includes('stalk') && !B.states.includes('flee') && run.log.some((e) => e.mode === 'retreat'), B);
check('C: stand and watch, and it circles you (sweeps round you)', C.states.includes('stalk') && !C.states.includes('flee') && C.sweepDeg >= 25, C);
check('D: sprint right at it and only then does it break and flee', D.states.includes('flee') && D.flees > C.flees, D);
check('stalking is a distinct behaviour from fleeing (both appear, at different times)', run.history.some((h) => h.includes('->stalk')) && run.history.some((h) => h.includes('->flee')), run.history);
writeFileSync(`${out}/stalk-run.json`, JSON.stringify(run, null, 2));

// Capture 1: top-down trace of its path around you, coloured by mode.
await page.evaluate((track) => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 520; c.id = 'trace';
  Object.assign(c.style, { position: 'fixed', inset: '10px', zIndex: 99, background: '#10141a' });
  document.body.append(c);
  const g = c.getContext('2d');
  const near = track.filter((t) => t.phase !== 'D');           // scale to A–C; the sprint in D runs off the edge
  const xs = near.flatMap((t) => [t.x, t.px]), zs = near.flatMap((t) => [t.z, t.pz]);
  g.save(); g.beginPath(); g.rect(0, 52, c.width, c.height - 52); g.clip();
  const x0 = Math.min(...xs) - 5, x1 = Math.max(...xs) + 5, z0 = Math.min(...zs) - 5, z1 = Math.max(...zs) + 5;
  const s = Math.min(860 / (x1 - x0), 440 / (z1 - z0));
  const X = (x) => 20 + (x - x0) * s, Z = (z) => 60 + (z - z0) * s;
  const col = { close: '#7fd07a', circle: '#ffd84a', retreat: '#5aa0ff', null: '#aaa' };
  g.font = '15px monospace';
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    g.strokeStyle = b.state === 'flee' ? '#ff4a3a' : col[b.mode] ?? '#aaa'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X(a.x), Z(a.z)); g.lineTo(X(b.x), Z(b.z)); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(a.px), Z(a.pz)); g.lineTo(X(b.px), Z(b.pz)); g.stroke();
  }
  for (const p of ['A', 'B', 'C', 'D']) { const t = track.find((q) => q.phase === p); g.fillStyle = '#fff'; g.fillText(p, X(t.x) + 6, Z(t.z) - 6); }
  g.restore();
  g.fillStyle = '#e8e4d8';
  g.fillText('Bigfoot stalking you (top-down, north up). Green: closing in · Yellow: circling · Blue: backing off · Red: fleeing', 20, 24);
  g.fillText('White: you (A still → B walk at it → C watch → D sprint at it, off the top edge)', 20, 44);
}, run.track);
await page.screenshot({ path: `${out}/01-stalking-path-top-down.png` });
await page.evaluate(() => document.querySelector('#trace').remove());

// Capture 2: in game, it watching you from the trees during a stalk.
await page.evaluate(() => {
  const g = __game, P = g.player, bf = g.cryptids.cryptids[0];
  P.position.set(0, 0, 118); bf.agent.x = 6; bf.agent.z = 100; bf.agent.path = null;
  bf.perception.detected = true; bf.perception.awareness = 1; bf.perception.lastSeen = { x: 0, z: 118, t: 0 };
  bf.enterStalk('test view', { stalkMin: 15, stalkMax: 32 });
  for (let i = 0; i < 120; i++) { bf.perception.detected = true; g.sim.step(); }
  P.yaw = Math.atan2(-(bf.agent.x - P.position.x), -(bf.agent.z - P.position.z)); P.pitch = 0.02;
  if (!g.flashlight.on) g.flashlight.toggle();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/02-it-watches-you-from-the-trees.png` });

check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
