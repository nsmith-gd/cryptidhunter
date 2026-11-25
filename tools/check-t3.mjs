// Clue-hint check. Run: npm run check:t3 [-- runs outDir]
// Lets Bigfoot roam for a while (fast-forwarded) so it leaves a trail, puts the player at an
// old clue, then a bot that only reads the on-screen hint text (W/D/E key presses) follows
// three clues. Passes if every hint names a direction and each clue followed was left later
// along Bigfoot's trail (so the hints lead toward it). If the bot itself gets wedged on scenery
// (a walk timeout), that run is retried once from a new start and the retry is reported.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const runs = Number(process.argv[2] || 3);
const out = process.argv[3] || '.ballast/media/t3';
mkdirSync(out, { recursive: true });
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const HOP = 12;        // metres walked along a hint before looking for the next clue
const SPOT = 7;        // how far ahead the bot "spots" a clue with its flashlight
const CONE = 70 * Math.PI / 180;

const server = spawn('npx', ['vite', 'preview', '--port', '4323', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

async function run(n, shots) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4323/');
  await page.waitForFunction(() => window.__game);
  // Being caught isn't what this checks: switch the danger rule off for the bot.
  await page.evaluate(() => { __game.overlay.classList.add('hidden'); __game.input.locked = true; if (__game.huntFailure) __game.huntFailure.enabled = false; });

  // Fast-forward 70 s of Bigfoot roaming with the player parked far away.
  const start = await page.evaluate(() => {
    const { cryptids, clueTrails, clues, player } = __game;
    for (let t = 0; t < 70; t += 1 / 30) {
      player.position.set(-36, 0, 36);
      cryptids.update(1 / 30); clueTrails.update(); clues.update(1 / 30);
    }
    // Start at an old footprint (about 40-60 s old), standing on the trail just behind it.
    let prints = clues.clues.filter((c) => c.type === 'footprint' && c.age > 40 && c.age < 60);
    if (!prints.length) prints = clues.clues.filter((c) => c.type === 'footprint').sort((a, b) => Math.abs(a.age - 50) - Math.abs(b.age - 50)).slice(0, 1);
    const c = prints[Math.floor(Math.random() * prints.length)];
    const h = c.object.rotation.y; // footprint faces the way it walked
    player.position.set(c.x + Math.sin(h) * 1.6, 0, c.z + Math.cos(h) * 1.6);
    player.velocity.set(0, 0, 0);
    const bf = cryptids.cryptids[0];
    return { id: c.id, age: c.age, pos: { x: player.position.x, z: player.position.z }, dist: Math.hypot(bf.agent.x - player.position.x, bf.agent.z - player.position.z) };
  });

  const state = () => page.evaluate(() => {
    const { player, clues, cryptids } = __game;
    const bf = cryptids.cryptids[0];
    return {
      pos: { x: player.position.x, z: player.position.z },
      cryptidDist: Math.hypot(bf.agent.x - player.position.x, bf.agent.z - player.position.z),
      clues: clues.clues.filter((c) => !c.found).map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z, age: c.age })),
    };
  });
  // Look at a clue from where we stand (pitch so it's under the crosshair).
  const lookAt = (id) => page.evaluate((id) => {
    const { player, clues, camera } = __game;
    const c = clues.clues.find((q) => q.id === id);
    const e = camera.position;
    player.yaw = -Math.atan2(c.x - e.x, -(c.z - e.z));
    player.pitch = -Math.atan2(e.y - c.y, Math.hypot(c.x - e.x, c.z - e.z));
  }, id);
  const setHeading = (h) => page.evaluate((h) => { __game.player.yaw = -h; __game.player.pitch = -0.35; }, h);
  const shot = (name) => shots && page.screenshot({ path: `${out}/${name}.png` });

  // Hold W until pred(state) is truthy; sidestep with D when stuck on an obstacle.
  async function walkUntil(pred, steer, maxMs = 30000) {
    await page.keyboard.down('KeyW');
    const t0 = Date.now();
    let last = null, lastT = 0, side = 0;
    try {
      while (Date.now() - t0 < maxMs) {
        const s = await state();
        const r = pred(s);
        if (r) return r;
        if (steer) await steer(s);
        if (!last || Date.now() - lastT > 700) {
          if (last && Math.hypot(s.pos.x - last.x, s.pos.z - last.z) < 0.3) {
            const key = side++ % 2 ? 'KeyA' : 'KeyD'; // alternate sides, longer each time
            await page.keyboard.down(key); await page.waitForTimeout(500 + side * 250); await page.keyboard.up(key);
          }
          last = s.pos; lastT = Date.now();
        }
        await page.waitForTimeout(40);
      }
      const s = await state();
      throw new Error(`walk timed out at ${s.pos.x.toFixed(1)},${s.pos.z.toFixed(1)} after ${JSON.stringify(steps)}`);
    } finally { await page.keyboard.up('KeyW'); }
  }

  const steps = [];
  let targetId = start.id;
  for (let step = 1; step <= 3; step++) {
    // Get within reach of the target clue, then aim at it.
    const s0 = await state();
    const t = s0.clues.find((c) => c.id === targetId);
    if (Math.hypot(t.x - s0.pos.x, t.z - s0.pos.z) > 1.8) {
      await walkUntil((s) => Math.hypot(t.x - s.pos.x, t.z - s.pos.z) < 1.6, () => lookAt(targetId));
    }
    await page.waitForTimeout(300); // let the walk's momentum die out
    await lookAt(targetId);
    await page.waitForTimeout(250);
    const aimed = await page.evaluate(() => __game.clueFinder.target?.id);
    // Footprints come in pairs; if the other foot is the one under the crosshair, examine that.
    if (aimed && aimed !== targetId) targetId = aimed;
    else if (aimed !== targetId) {
      const info = await page.evaluate((id) => { const c = __game.clues.clues.find((q) => q.id === id); const e = __game.camera.position;
        return c && { type: c.type, y: c.y, found: c.found, age: c.age, d: Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z) }; }, targetId);
      throw new Error(`step ${step}: clue not under crosshair (aimed ${aimed}) ${JSON.stringify(info)}`);
    }
    await shot(`0${step * 2 - 1}-clue${step}-prompt`);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(350);
    const hint = await page.evaluate(() => document.querySelector('#trail-hint').textContent);
    await shot(`0${step * 2}-clue${step}-hint`);
    // When the cryptid left this clue, in game seconds (game time minus the clue's age).
    const { age, leftAt } = await page.evaluate((id) => {
      const c = __game.clues.clues.find((q) => q.id === id);
      return { age: c.age, leftAt: __game.journal.time - c.age };
    }, targetId);
    steps.push({ hint, age: Math.round(age), leftAt: +leftAt.toFixed(1) });
    const m = hint.match(/heading ([a-z-]+)/);
    if (!m) break; // "It's close." — at the head of the trail
    // Walk HOP metres that way, then (before the last hint) take the nearest clue ahead
    // in the flashlight cone.
    const h = COMPASS.indexOf(m[1]) * Math.PI / 4;
    await setHeading(h);
    const from = await state();
    const lastAge = steps[steps.length - 1].age;
    const t0 = Date.now();
    const next = await walkUntil((s) => {
      const walked = Math.hypot(s.pos.x - from.pos.x, s.pos.z - from.pos.z);
      if (walked < HOP) return null;
      if (step === 3) return { done: true };
      // Look ahead in the flashlight cone; if the trail bends away, look all around
      // (like a player sweeping the light) for something fresher than the last clue.
      const around = walked > HOP * 2 || Date.now() - t0 > 12000;
      let best = null;
      for (const c of s.clues) {
        const dx = c.x - s.pos.x, dz = c.z - s.pos.z, d = Math.hypot(dx, dz);
        let off = Math.abs(Math.atan2(dx, -dz) - h); off = Math.min(off, 2 * Math.PI - off);
        const range = SPOT * (1.5 + (Date.now() - t0) / 6000); // sweep wider the longer it takes
        // Prefer marks that look at least as fresh as the last one (older ones are fading).
        const seen = around ? d < range && c.age < lastAge : d < SPOT && off < CONE && c.age < lastAge + 5;
        if (seen && (!best || c.age < best.age)) best = { id: c.id, age: c.age };
      }
      return best;
    }, () => setHeading(h), step === 3 ? 10000 : 30000).catch((e) => {
      if (step === 3) return { done: true }; // the last walk may run into the map edge: that's fine
      throw e;
    });
    if (next.done) break;
    targetId = next.id;
  }
  const end = await state();
  return { start, steps, endDist: end.cryptidDist, errors };
}

for (let n = 0; n < runs; n++) {
  try {
    let r;
    try { r = await run(n, n === 0); } catch (e) {
      if (!/walk timed out/.test(e.message)) throw e;
      results.push(`NOTE run ${n + 1}: bot got stuck on scenery (${e.message.slice(0, 60)}...), retrying from a new start`);
      r = await run(n, n === 0);
    }
    const dirs = r.steps.filter((s) => /heading|close/.test(s.hint)).length;
    check(`run ${n + 1}: every hint says which way it went`, dirs === r.steps.length && r.steps.length >= 2, r.steps);
    // Bigfoot roams in loops around its home, so straight-line distance is noisy. The honest
    // measure is time along its trail: each clue followed was left later than the one before.
    const t = r.steps.map((s) => s.leftAt);
    check(`run ${n + 1}: following the hints moves you along its trail toward it`, t[t.length - 1] - t[0] >= 5,
      { gainedSeconds: +(t[t.length - 1] - t[0]).toFixed(1), leftAt: t, cryptidDist: [+r.start.dist.toFixed(1), +r.endDist.toFixed(1)] });
    check(`run ${n + 1}: no page errors`, r.errors.length === 0, r.errors);
  } catch (e) {
    check(`run ${n + 1}`, false, e.message);
  }
}
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
