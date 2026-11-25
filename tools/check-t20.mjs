// Automated check for the field journal. Run: npm run check:t20 [outDir]
// Lets Bigfoot lay a trail, then walks the player up to clues, aims at them and presses E.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { assess } from '../src/journal/clueEvidence.js';

const out = process.argv[2] || '.ballast/media/t20';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4322', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4322/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { __game.overlay.classList.add('hidden'); __game.input.locked = true; });

const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// Let Bigfoot roam (fast-forward) so there is a trail, then freeze it far away from the clues we use.
await page.evaluate(() => {
  const { cryptids, clueTrails, clues, journal, player } = __game;
  const dt = 1 / 30;
  for (let t = 0; t < 70; t += dt) {
    player.position.set(-36, 0, 36);
    cryptids.update(dt); clueTrails.update(); clues.update(dt); journal.update(dt);
  }
  // Freeze it so it can't notice the player near the clues and lay fresh ones mid-check.
  cryptids.update = () => {};
});

// Journal before any evidence.
await page.keyboard.press('KeyJ');
await page.waitForTimeout(150);
const empty = await page.evaluate(() => document.getElementById('journal').innerText);
check('journal opens with J and shows no evidence yet', /No evidence yet/.test(empty), empty.slice(0, 60));
await page.screenshot({ path: `${out}/01-journal-empty.png` });
await page.keyboard.press('KeyJ');

// Stand near a clue of the given type and aim the crosshair at it. Returns the clue id.
const aimAt = (type) => page.evaluate((type) => {
  const { clues, player, clueFinder } = __game;
  const pool = clues.clues.filter((c) => c.type === type && !c.found);
  // Start from the middle of the trail, and skip any clue the crosshair can't actually pick
  // (e.g. tucked against a box), so the check doesn't depend on where the trail happened to go.
  const order = pool.map((_, i) => (Math.floor(pool.length / 2) + i) % pool.length);
  for (const i of order) {
    const c = pool[i];
    // Approach from the side the cryptid stood on (in front of scratches), 1.8 m out.
    let ax = c.origin.x - c.x, az = c.origin.z - c.z;
    if (Math.hypot(ax, az) < 0.05) { ax = 1; az = 0.3; }
    const l = Math.hypot(ax, az);
    const px = c.x + (ax / l) * 1.8, pz = c.z + (az / l) * 1.8;
    player.position.set(px, 0, pz); player.velocity.set(0, 0, 0);
    const eyeY = player.eyeHeight;
    const dx = c.x - px, dz = c.z - pz;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = Math.atan2(c.y + 0.03 - eyeY, Math.hypot(dx, dz));
    player.update(0.0001);
    if (clueFinder.update() === c) return c.id;
  }
  return null;
}, type);
const promptText = () => page.evaluate(() => {
  const p = document.getElementById('examine-prompt');
  return p.style.display === 'block' ? p.textContent : '';
});
const logged = () => page.evaluate(() => __game.journal.entries.map((e) => ({ type: e.type, age: Math.round(__game.journal.ageOf(e)) })));
const verdict = () => page.evaluate(() => { const v = __game.journal.verdict(); return { ready: v.ready, needed: v.needed, likely: v.likely?.name, conf: v.likely && +v.likely.confidence.toFixed(2) }; });

// Clue 1: footprint.
const id1 = await aimAt('footprint');
await page.waitForTimeout(250);
const p1 = await promptText();
check('aiming at a footprint shows an examine prompt', /Examine footprint/.test(p1), { id1, p1 });
await page.screenshot({ path: `${out}/02-examine-prompt-footprint.png` });
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/03-logged-toast.png` });
const v1 = await verdict();
check('one clue: no identification yet', !v1.ready && v1.needed === 2, v1);
// Same clue again must not double-log. (Pressing E again here can legitimately pick up the
// *next* footprint along the trail, so test the clue itself rather than the key.)
const again = await page.evaluate((id) => {
  const c = __game.clues.clues.find((k) => k.id === id);
  return { recordAgain: __game.journal.record(c), stillTargeted: __game.clueFinder.update() === c };
}, id1);
check('a clue can only be logged once', again.recordAgain === null && !again.stillTargeted && (await logged()).length === 1, { again, logged: await logged() });

// Clue 2: hair.
await aimAt('hair');
await page.waitForTimeout(250);
const p2 = await promptText();
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
const v2 = await verdict();
check('two clues: still asks for one more', /Examine hair/.test(p2) && !v2.ready && v2.needed === 1, { p2, v2 });

// Clue 3: scratch marks (or another footprint if none were made).
const hasScratch = await page.evaluate(() => __game.clues.clues.some((c) => c.type === 'scratch'));
await aimAt(hasScratch ? 'scratch' : 'footprint');
await page.waitForTimeout(250);
const p3 = await promptText();
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
const v3 = await verdict();
check('after three clues the journal names the likely cryptid: Bigfoot', v3.ready && v3.likely === 'Bigfoot' && v3.conf >= 0.85, { p3, v3 });
const toast = await page.evaluate(() => document.getElementById('journal-toast').textContent);
check('third clue toast names the suspect', /Bigfoot/.test(toast), toast);
await page.screenshot({ path: `${out}/04-third-clue-toast.png` });

// Ages keep ticking.
const e1 = await logged();
await page.waitForTimeout(2200);
const e2 = await logged();
check('journal lists each clue with its type and a growing age', e1.length === 3 && e2.every((e, i) => e.type === e1[i].type && e.age >= e1[i].age + 1), { before: e1, after: e2 });

await page.keyboard.press('KeyJ');
await page.waitForTimeout(1200);
const text = await page.evaluate(() => document.getElementById('journal').innerText);
check('journal panel shows verdict, types and ages', /Likely cryptid: Bigfoot/.test(text) && /Footprint/.test(text) && /Hair tuft/.test(text) && /old/.test(text), text.replace(/\s+/g, ' ').slice(0, 200));
await page.screenshot({ path: `${out}/05-journal-verdict-bigfoot.png` });

// The evidence model tells cryptids apart: small prints + low scratches point to the Chupacabra.
const alt = assess([{ type: 'footprint', data: { length: 0.2 } }, { type: 'footprint', data: { length: 0.2 } }, { type: 'scratch', y: 0.5 }])[0].name;
check('small prints + low scratches point elsewhere (Chupacabra)', alt === 'Chupacabra', alt);

check('no page errors', errors.length === 0, errors);
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
