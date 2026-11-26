// Bigfoot gait analysis (#109): measure how natural his steps are, per move, and draw a trace.
// Run: node tools/analyze-t109.mjs [outDir] [label]   (dev server; uses the animation viewer)
// For each move it drives the full body (clips + procedural layer) at 60 fps for 6 s and records
// the hips' and head's world height, the chest's pitch and every foot landing. Reports:
//   hipDrop  cm the hips drop per step (body bob), peak-to-trough, steady state
//   accelG   peak vertical acceleration of the hips, in g (a stomp shows as a spike)
//   jerk     how sudden the worst change of vertical acceleration is (g per second)
//   dips     hip low points per step (1 = one smooth dip per step; 2+ = double-stomp)
//   chestDeg chest pitch swing (degrees) · headShake head vertical acceleration (g)
//   landPhase where in the step the lowest hip point falls, 0 = foot lands (natural: ~0.1-0.3)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || '.ballast/media/t109';
const label = process.argv[3] || 'now';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', '--port', '4509', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
await page.goto('http://localhost:4509/lookdev/bigfoot-anim.html?manual&clip=idle');
await page.waitForFunction(() => window.__viewer, null, { timeout: 120000 });

const res = await page.evaluate(() => {
  const v = __viewer, bf = v.bf, b = bf.userData.bones, body = bf.userData.body3, V3 = bf.position.constructor;
  const runMove = (state, speed) => {
    bf.position.set(0, 0, 0); bf.rotation.y = 0; bf.userData.look = null;
    for (let i = 0; i < 240; i++) bf.userData.animate(1 / 60, speed, state);     // settle into the gait
    const dt = 1 / 60, rec = [];
    let lastPlants = body.stats.plants;
    for (let i = 0; i < 360; i++) {
      bf.userData.animate(dt, speed, state);
      bf.updateMatrixWorld(true);
      const hips = b.hips.getWorldPosition(new V3()).y, head = b.head.getWorldPosition(new V3()).y;
      const q = b.chest.getWorldQuaternion(new bf.quaternion.constructor());
      const f = new V3(0, 0, -1).applyQuaternion(q);
      rec.push({ reach: body.stats.reach, hips, head, chest: Math.atan2(-f.y, Math.hypot(f.x, f.z)) * 180 / Math.PI, land: body.stats.plants > lastPlants });
      lastPlants = body.stats.plants;
    }
    // Metrics.
    const g = 9.81, H = rec.map((r) => r.hips), HD = rec.map((r) => r.head);
    const acc = (a) => a.map((y, i) => (i > 0 && i < a.length - 1 ? (a[i + 1] - 2 * y + a[i - 1]) / (dt * dt) : 0));
    const aH = acc(H), aHD = acc(HD);
    const jerk = aH.map((a, i) => (i > 1 && i < aH.length - 2 ? Math.abs(aH[i + 1] - a) / dt : 0));
    const lands = rec.map((r, i) => (r.land ? i : -1)).filter((i) => i >= 0);
    let dips = 0, steps = 0, phases = [];
    // Dips: local lows across the whole trace that the hips clearly rise out of on both sides
    // (prominence >= 20% of the overall bob, and >= 2 mm), counted per step.
    const span = Math.max(...H) - Math.min(...H), prom = Math.max(0.002, span * 0.2);
    for (let i = 1; i < H.length - 1; i++) {
      if (!(H[i] <= H[i - 1] && H[i] < H[i + 1])) continue;
      let l = H[i], r = H[i];
      for (let k = i - 1; k >= 0 && H[k] >= H[i]; k--) l = Math.max(l, H[k]);
      for (let k = i + 1; k < H.length && H[k] >= H[i]; k++) r = Math.max(r, H[k]);
      if (Math.min(l, r) - H[i] >= prom) dips++;
    }
    for (let k = 0; k + 1 < lands.length; k++) {
      const a = lands[k], z = lands[k + 1];
      steps++;
      let lowI = a, low = Infinity;
      for (let i = a; i < z; i++) if (H[i] < low) { low = H[i]; lowI = i; }
      phases.push((lowI - a) / Math.max(1, z - a));
    }
    const dur = H.length, stepsInTrace = lands.length > 1 ? (dur / ((lands[lands.length - 1] - lands[0]) / (lands.length - 1))) : 0;
    dips = stepsInTrace ? dips / stepsInTrace : 0;
    const range = (a) => Math.max(...a) - Math.min(...a);
    return {
      hipDropCm: +(range(H) * 100).toFixed(1), accelG: +(Math.max(...aH.map(Math.abs)) / g).toFixed(2),
      jerk: +(Math.max(...jerk) / g).toFixed(1), dipsPerStep: +dips.toFixed(2), steps,
      landPhase: phases.length ? +(phases.reduce((s, x) => s + x, 0) / phases.length).toFixed(2) : null,
      reachMaxCm: +(Math.max(...rec.map((r) => r.reach)) * 155).toFixed(1),
      chestDeg: +range(rec.map((r) => r.chest)).toFixed(1), headShakeG: +(Math.max(...aHD.map(Math.abs)) / g).toFixed(2),
      trace: rec.map((r) => [+(r.hips).toFixed(4), +(r.head).toFixed(4), +r.chest.toFixed(2), r.land ? 1 : 0]),
    };
  };
  const out = {};
  for (const [m, state, speed] of [['lumber', 'roam', 1.8], ['search', 'investigate', 1.2], ['stalk', 'shadow', 0.9], ['charge', 'aggress', 5.5], ['bolt', 'flee', 8.5]]) out[m] = runMove(state, speed);
  return out;
});
// Plot: hips height (orange), head height (blue), chest pitch (green), landings (ticks), 3 s per move.
const plot = await page.evaluate(([res, label]) => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 120 * Object.keys(res).length + 20;
  const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
  g.font = '11px monospace';
  Object.entries(res).forEach(([m, r], row) => {
    const y0 = 20 + row * 120, tr = r.trace.slice(0, 180);
    g.fillStyle = '#ccc'; g.fillText(`${label} · ${m}: drop ${r.hipDropCm} cm · accel ${r.accelG} g · jerk ${r.jerk} g/s · dips/step ${r.dipsPerStep} · low at ${r.landPhase} · chest ${r.chestDeg}° · head ${r.headShakeG} g`, 8, y0 - 4);
    const series = (k, col, scale) => {
      const vals = tr.map((t) => t[k]), mn = Math.min(...vals), mx = Math.max(...vals), span = Math.max(scale, mx - mn);
      g.strokeStyle = col; g.beginPath();
      vals.forEach((v, i) => { const x = 8 + i * 4.9, y = y0 + 100 - ((v - mn) / span) * 90; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    };
    series(0, '#ffa040', 0.12); series(1, '#60a0ff', 0.12); series(2, '#70d070', 8);
    g.fillStyle = '#fff'; tr.forEach((t, i) => { if (t[3]) g.fillRect(8 + i * 4.9, y0 + 100, 1, 8); });
  });
  return c.toDataURL('image/png');
}, [res, label]);
writeFileSync(`${out}/gait-trace-${label}.png`, Buffer.from(plot.split(',')[1], 'base64'));
const summary = Object.fromEntries(Object.entries(res).map(([m, r]) => [m, { ...r, trace: undefined }]));
writeFileSync(`${out}/gait-metrics-${label}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
// Natural-gait criteria (#109). Walking gaits: one smooth dip per step, gentle (< 0.8 g), lowest just
// after the heel lands. Running gaits: one dip per step, < 2.5 g, no sudden yank (jerk).
const T = { walk: ['lumber', 'search', 'stalk'], run: ['charge', 'bolt'] };
const results = [];
const check = (name, ok, s2) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s2)}`);
for (const m of T.walk) {
  const r = summary[m];
  check(`${m}: one smooth settle per step, gentle (under 0.8 g), 2-8 cm, lowest just after the heel lands`,
    Math.abs(r.dipsPerStep - 1) <= 0.15 && r.accelG < 0.8 && r.hipDropCm >= 2 && r.hipDropCm <= 8 && r.landPhase >= 0.08 && r.landPhase <= 0.35 && r.jerk < 20, r);
}
for (const m of T.run) {
  const r = summary[m];
  check(`${m}: one settle per step, under 2.5 g, 5-14 cm, no sudden yank (jerk under 80 g/s)`,
    Math.abs(r.dipsPerStep - 1) <= 0.15 && r.accelG < 2.5 && r.hipDropCm >= 5 && r.hipDropCm <= 14 && r.jerk < 80, r);
}
console.log(results.join('\n'));
await browser.close();
server.kill();
