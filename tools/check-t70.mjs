// Navigation check (#70): paper map + compass (M), trail signs, no omniscient route hints.
// Run: npm run build && node tools/check-t70.mjs [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t70';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4370', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
await page.goto('http://localhost:4370/?map=forest&nodebugai');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = __game;
  g.overlay.classList.add('hidden');
  g.cryptids.update = () => {}; g.huntFailure.enabled = false;
  if (g.fear) { g.fear.update = () => {}; g.fear.value = 0; }
  for (const c of g.cryptids.cryptids) c.mesh.position.set(0, -50, 0);
});

// 1) No omniscient hints: no beacon over the trees, no distance to the van, no heading banner.
const hints = await page.evaluate(() => {
  const g = __game, van = g.scene.getObjectByName('extraction-van');
  let tallest = 0;
  van.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; tallest = Math.max(tallest, m.position.y + b.max.y); } });
  g.hunt.stage = 'extract'; g.hunt.photo = { score: 60, distance: 20 };
  const extract = g.hunt.objectiveText();
  g.hunt.dawned = true; const dawn = g.hunt.objectiveText(); g.hunt.dawned = false;
  g.hunt.stage = 'search';
  const banner = document.getElementById('trail-compass');
  return { tallest: +tallest.toFixed(1), extract, dawn, bannerShown: !!banner && getComputedStyle(banner).display !== 'none' };
});
check('no beacon: nothing on the van reaches above the treeline', hints.tallest < 4, { tallest: hints.tallest });
check('the objective gives no distance to the van, and points to the map, compass and signs', !/\d+\s*m\b/.test(hints.extract + hints.dawn) && /map/.test(hints.extract), hints);
check('no heading readout on screen while the map is down', !hints.bannerShown, hints);

// 2) The map comes up with M: it has the trails and places, the compass, and no player marker.
const mapUp = await page.evaluate(() => {
  const g = __game; g.input.locked = true;
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
  const shown = getComputedStyle(document.getElementById('field-map')).display !== 'none';
  const banner = getComputedStyle(document.getElementById('trail-compass')).display !== 'none';
  return { shown, banner, reading: g.player.readingMap, places: g.map.places.length, signs: g.map.signs.length, trails: g.map.trails.length };
});
check('M raises the map and compass (heading shows only now)', mapUp.shown && mapUp.banner && mapUp.reading, mapUp);
check('the map draws the trail network, named places and the signposts', mapUp.places >= 8 && mapUp.signs >= 5 && mapUp.trails >= 5, mapUp);
const slow = await page.evaluate(() => {
  const g = __game, p = g.player, run = () => { p.position.set(0, 0, 120); p.velocity.set(0, 0, 0); p.yaw = 0; g.input.keys.clear(); g.input.keys.add('KeyW'); g.input.keys.add('ShiftLeft');
    for (let t = 0; t < 2; t += 1 / 30) p.update(1 / 30); g.input.keys.clear(); return 120 - p.position.z; };
  const reading = run(); g.fieldMap.toggle(false); const free = run(); g.fieldMap.toggle(true);
  return { reading: +reading.toFixed(1), free: +free.toFixed(1) };
});
check('reading the map you walk slowly and cannot run', slow.reading < slow.free * 0.5, slow);

// Capture: map up in the hollow (far north). The map doesn't say where you are.
await page.evaluate(() => { const g = __game, L = g.map.landmarks; g.player.position.set(L.hollow.x + 3, 0, L.hollow.z + 8); g.player.yaw = Math.PI * 0.85; g.player.pitch = -0.1; g.fieldMap.lastDeg = null; });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/01-map-and-compass-in-the-hollow.png` });
await page.evaluate(() => __game.fieldMap.toggle(false));

// 3) Signs: from every sign, the arrows marked for the parking lead there along the trails.
const follow = await page.evaluate(() => {
  const g = __game, signs = g.map.signs, park = g.map.landmarks.trailhead;
  const signAt = (n) => signs.find((s) => Math.abs(s.x - n.x) < 0.01 && Math.abs(s.z - n.z) < 0.01);
  const res = [];
  for (const start of signs) {
    let s = start, hops = 0, ok = false, route = [];
    while (s && hops++ < 20) {
      const b = s.boards.find((x) => x.home);
      if (!b) break;
      let prev = s, cur = b.toward;
      route.push(b.lines.map((l) => l.name).join('/'));
      while (!signAt(cur) && !(Math.abs(cur.x - park.x) < 0.01 && Math.abs(cur.z - park.z) < 0.01)) {
        const next = cur.edges.map((e) => e.to).find((n) => n.x !== prev.x || n.z !== prev.z);
        if (!next) break;
        prev = cur; cur = next;
      }
      if (Math.abs(cur.x - park.x) < 0.01 && Math.abs(cur.z - park.z) < 0.01) { ok = true; break; }
      s = signAt(cur);
    }
    res.push({ at: start.here ?? `${start.x},${start.z}`, ok, route });
  }
  return res;
});
check('following the PARKING arrows from every trail sign leads to the van', follow.every((f) => f.ok), follow.filter((f) => !f.ok).concat(follow.slice(0, 2)));

// 4) Walk it for real: from the hollow, a walker that only reads signs (and walks the trail the
// map shows between them) reaches the van ring, with the game's own collisions.
const walk = await page.evaluate(() => {
  const g = __game, p = g.player, inp = g.input, signs = g.map.signs, L = g.map.landmarks;
  g.fieldMap.toggle(false);
  const signAt = (n) => signs.find((s) => Math.abs(s.x - n.x) < 0.01 && Math.abs(s.z - n.z) < 0.01);
  // Start in the hollow; the nearest trail node there is a sign (The hollow).
  let s = signs.find((x) => x.here === 'The hollow');
  const pts = [{ x: s.x, z: s.z }];
  let guard = 0;
  while (s && guard++ < 20) {
    const b = s.boards.find((x) => x.home);
    let prev = s, cur = b.toward;
    pts.push({ x: cur.x, z: cur.z });
    while (!signAt(cur) && cur.edges.length === 2) {
      const next = cur.edges.map((e) => e.to).find((n) => n.x !== prev.x || n.z !== prev.z);
      prev = cur; cur = next; pts.push({ x: cur.x, z: cur.z });
    }
    s = signAt(cur);
  }
  pts.push({ x: g.HUNT.exit.x, z: g.HUNT.exit.z });
  p.position.set(L.hollow.x, 0, L.hollow.z); p.velocity.set(0, 0, 0);
  inp.keys.clear(); inp.keys.add('KeyW');
  let i = 0, t = 0, stuck = 0, last = { x: p.position.x, z: p.position.z };
  for (; t < 400 && i < pts.length; t += 1 / 30) {
    const wp = pts[i];
    if (Math.hypot(wp.x - p.position.x, wp.z - p.position.z) < 1.5) { i++; continue; }
    p.yaw = -Math.atan2(wp.x - p.position.x, -(wp.z - p.position.z));
    p.update(1 / 30);
    const step = Math.hypot(p.position.x - last.x, p.position.z - last.z); last = { x: p.position.x, z: p.position.z };
    stuck = step < 0.01 ? stuck + 1 : 0; if (stuck > 90) break;
  }
  inp.keys.clear();
  g.hunt.update(0);
  return { reached: g.hunt.inZone, seconds: Math.round(t), waypoints: `${i}/${pts.length}`, end: { x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1) } };
});
check('from the hollow, following the trail signs on foot reaches the van', walk.reached, walk);

// Captures: a junction sign under the torch, and the van from 40 m (no beacon; hazard lights).
await page.evaluate(() => {
  const g = __game, s = g.map.signs.find((x) => x.boards.length >= 3) ?? g.map.signs[0];
  const b = s.boards.find((x) => x.home) ?? s.boards[0];
  // Stand square to the PARKING board, 2.6 m off it, looking at its middle (that's how you read it).
  const a = b.dir + Math.PI / 2, mx = s.post.x + Math.sin(b.dir) * 1.0, mz = s.post.z + Math.cos(b.dir) * 1.0;
  const px = mx + Math.sin(a) * 2.6, pz = mz + Math.cos(a) * 2.6;
  g.player.position.set(px, 0, pz);
  g.player.yaw = Math.atan2(px - mx, pz - mz); g.player.pitch = 0.18;
  if (!g.flashlight.on) g.flashlight.toggle(); g.flashlight.battery = 1;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/02-trail-sign-at-a-junction.png` });
await page.evaluate(() => {
  const g = __game, e = g.HUNT.exit;
  g.player.position.set(e.x - 4, 0, e.z - 24); g.player.yaw = Math.atan2(-4, -24); g.player.pitch = 0.02;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/03-van-from-24m-no-beacon.png` });
check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
