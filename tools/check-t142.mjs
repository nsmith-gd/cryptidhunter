// The Hodag proxy (#142) in the real game, on gym G04 with only the Hodag (?map=g04&proxy=territory):
// the warning is both visual (it rears, spines up, eyes glow) and audible (growls, captioned with a
// direction); then a roar and a charge, a short pursuit, a goring hit that bleeds heavily; and leaving
// the zone ends the pursuit every time (escapes in six directions, walking and sprinting). Captures:
// calm vs warning pose, the charge.
// Run: npm run check:t142 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t142';
mkdirSync(out, { recursive: true });
const PORT = 4444;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?map=g04&proxy=territory&simpaused&blind`);
await page.waitForFunction(() => window.__gym?.harness?.territory, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game, h = g.gymHarness;
  g.overlay.classList.add('hidden'); g.input.locked = true; if (g.hunt.stage === 'briefing') g.hunt.start();
  g.gymHarness.el.style.display = 'none';                       // the gym panel off for the pictures
  window.T = {
    hod: h.territory,
    hold(keys) { g.input.keys.clear(); for (const k of keys) g.input.keys.add(k); },
    steps(n) { for (let i = 0; i < n; i++) g.sim.step(); },
    place(x, z) { g.player.position.set(x, 0, z); g.player.velocity.set(0, 0, 0); },
    faceHodag() { const p = g.player.position, o = T.hod.pos; g.player.yaw = Math.atan2(-(o.x - p.x), -(o.z - p.z)); g.player.pitch = -0.05; },
    ev: (type) => h.events.filter((e) => e.system === 'territory' && e.type === type),
  };
});
const shot = async (name) => { await page.waitForTimeout(1000); await page.screenshot({ path: `${out}/${name}.png` }); };

// 1. Calm, then the warning: rearing, spines up, glowing eyes, a growl (captioned, with a direction).
await page.evaluate(() => { T.place(-3, 4); T.faceHodag(); T.steps(2); });
const calm = await page.evaluate(() => ({ state: T.hod.state, spine: +T.hod.rig.spines[3].rotation.x.toFixed(2), eyes: T.hod.rig.eyeMat.emissive.getHex() }));
await shot('01-calm-the-hodag-at-its-lair');
await page.evaluate(() => { T.place(-5, 2); T.faceHodag(); T.steps(60); T.faceHodag(); T.steps(1); });   // ~11 m out: inside the ring
const warn = await page.evaluate(() => ({ state: T.hod.state, spine: +T.hod.rig.spines[3].rotation.x.toFixed(2), rear: +T.hod.rig.rig.rotation.x.toFixed(2), eyes: T.hod.rig.eyeMat.emissive.getHex(),
  sounds: T.hod.sounds.map((s) => s.kind), captions: __game.captions.log.map((c) => c.text), captionHasDirection: __game.captions.log.some((c) => c.bearing !== null), audioCtx: !!T.hod.audio.ctx }));
check('the warning is visual: it rears up, its spines stand on end, its eyes glow', calm.state === 'idle' && warn.state === 'warn' && calm.spine > 1 && warn.spine < 0.3 && warn.rear < -0.2 && calm.eyes === 0 && warn.eyes !== 0, { calm, warn: { state: warn.state, spine: warn.spine, rear: warn.rear, eyes: warn.eyes } });
check('the warning is audible: a growl (synthesised, played) with a caption that gives its direction', warn.sounds.includes('growl') && warn.captions.some((c) => /growl/.test(c)) && warn.captionHasDirection && warn.audioCtx, { sounds: warn.sounds, captions: warn.captions, audioCtx: warn.audioCtx });
await shot('02-the-warning-rearing-spines-up-growling');

// 2. Stay: a roar and a charge; a hit gores you (heavy bleeding, through health); it disengages.
const charge = await page.evaluate(() => {
  const g = __game, s = g.survival;
  for (let i = 0; i < 60 * 5 && T.hod.state !== 'charge'; i++) g.sim.step();
  const lead = T.ev('charge').at(-1)?.data.lead;
  for (let i = 0; i < 12; i++) g.sim.step();
  T.faceHodag();
  return { state: T.hod.state, lead, roar: T.hod.sounds.some((x) => x.kind === 'roar'), roarCaption: g.captions.log.some((c) => /roar/.test(c.text)), healthBefore: s.health.value };
});
await page.evaluate(() => T.steps(1));
await shot('03-the-charge');
const hit = await page.evaluate((h0) => {
  const g = __game, s = g.survival;
  for (let i = 0; i < 60 * 4 && !T.ev('hit').length; i++) g.sim.step();
  T.steps(30);
  return { hits: T.ev('hit').length, lost: +(h0 - s.health.value).toFixed(1), heavyBleed: s.health.bleeding.some((c) => c.severity === 'heavy' && c.cause === 'Hodag'), state: T.hod.state, why: T.ev('disengage').at(-1)?.data.why, snort: T.hod.sounds.some((x) => x.kind === 'snort') };
}, charge.healthBefore);
check('staying: after the warning (≥2 s) a roar and a charge', charge.state === 'charge' && charge.lead >= 2 && charge.roar && charge.roarCaption, charge);
check('a hit gores you (heavy bleeding through health), then it has made its point and turns home with a snort', hit.hits === 1 && hit.lost >= 15 && hit.heavyBleed && hit.state === 'disengage' && hit.why === 'made its point' && hit.snort, hit);

// 3. Leaving the zone ends the pursuit every time: six directions, walking and sprinting.
const trials = await page.evaluate(() => {
  const g = __game, s = g.survival, home = __game.map.landmarks.home, P = g.player, H = T.hod;
  s.health.value = 100; s.health.bleeding.length = 0; s.health.conditions.length = 0;
  H.C.contact = 0;                                          // don't get caught: test the boundary rule alone
  const out = [];
  for (let k = 0; k < 6; k++) {
    for (const sprint of [false, true]) {
      H.pos.x = home.x; H.pos.z = home.z; H.state = 'idle'; H.calmUntil = 0;
      const a = -0.3 + k * 0.42;                              // fan of escape bearings from the lair toward the trail side
      T.place(home.x + Math.cos(a) * 9, home.z + Math.sin(a) * 9); T.hold([]);
      for (let i = 0; i < 60 * 6 && H.state !== 'charge'; i++) g.sim.step();
      const charged = H.state === 'charge';
      T.steps(50);                                            // let it close in (into the pursuit)
      let crossed = null, chasingAfter = 0, maxR = 0;
      for (let i = 0; i < 60 * 12; i++) {
        P.yaw = Math.atan2(-Math.cos(a), -Math.sin(a)); T.hold(sprint ? ['KeyW', 'ShiftLeft'] : ['KeyW']);
        g.sim.step();
        const r = Math.hypot(P.position.x - home.x, P.position.z - home.z);
        maxR = Math.max(maxR, Math.hypot(H.pos.x - home.x, H.pos.z - home.z));
        if (crossed === null && r > H.T.boundaryR) crossed = i;
        if (crossed !== null && i > crossed && (H.state === 'charge' || H.state === 'pursuit')) chasingAfter++;
      }
      T.hold([]);
      out.push({ bearing: +a.toFixed(2), sprint, charged, crossed: crossed !== null, chasingAfter, hodagMaxR: +maxR.toFixed(2), why: T.ev('disengage').at(-1)?.data.why });
    }
  }
  H.C.contact = 1.4;
  return { boundaryR: H.T.boundaryR, out };
});
const allEnded = trials.out.every((t) => t.charged && t.crossed && t.chasingAfter === 0 && t.hodagMaxR <= trials.boundaryR);
check('leaving the zone ends the pursuit every time (12 escapes: 6 directions, walking and sprinting); it never crosses its boundary', allEnded, trials);
check('no page errors', errors.length === 0, errors.slice(0, 3));

writeFileSync(`${out}/results.txt`, results.join('\n') + '\n');
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
