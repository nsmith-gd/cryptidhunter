// Pine Hollow GDD content (#91): before (?nolandmarks) / after captures of each new map piece,
// frame cost in both modes, and in-game checks: the tree stand can be climbed by walking, the
// boundary fence stops you, no trees grow through the new props. Run: npm run check:t91 [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || '.ballast/media/t91';
mkdirSync(out, { recursive: true });
const PORT = 4391;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const errors = [];
const results = [];
const check = (name, ok, s) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(s)}`);

// [name, spot, camera offset from spot (dx, dz), look height, flashlight]
const VIEWS = [
  ['01-trailhead-kiosk-lantern', 'kiosk', [5, 4], 1.4, false],
  ['02-tipped-trash-bin', 'trashBin', [3.5, -2.5], 0.2, true],
  ['03-dropped-pack-flashlight-at-ford', 'droppedPack', [2.6, -2.2], 0.1, false],
  ['04-scratch-marks-above-head', 'scratchFront', [0, 0], 2.6, true],
  ['05-stick-teepee', 'teepee', [4.5, 3], 1.2, true],
  ['06-x-arch-past-the-ridge', 'xArch', [5, 4], 1.4, true],
  ['07-tree-stand', 'treeStand', [6, 7], 2.4, false],
  ['08-hollow-bedding-and-snapped-pine', 'hollowView', [0, 0], 0.4, true],
  ['09-boundary-fence', 'fence', [0, 0], 1.0, true],
  ['10-puddles-at-footbridge', 'puddle', [0, 0], 0, true],
];

const setup = async (page) => {
  await page.waitForFunction(() => window.__game?.map, null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = __game; g.overlay.classList.add('hidden');
    g.cryptids.update = () => {}; for (const c of g.cryptids.cryptids) c.mesh.visible = false;
    if (g.huntFailure) g.huntFailure.enabled = false;
    if (g.fear) { g.fear.update = () => {}; g.fear.applySway = () => {}; }
    const st = document.createElement('style');
    st.textContent = 'body > div, #hud, #crosshair { display: none !important; }';
    document.head.append(st);
  });
};
const SPOTS = { // spots for "before" too: same coordinates as the after plan
  fence: { x: 9, z: 141.5 }, fenceLook: { x: 4, z: 146 },
  puddle: { x: 39, z: 34 }, puddleLook: { x: 36, z: 22 },
};
const plan = {};
const perf = {};
let props = null;

for (const mode of ['after', 'before']) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push(`${mode}: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/?map=forest&nodebugai${mode === 'before' ? '&nolandmarks' : ''}`);
  await setup(page);
  if (mode === 'after') {
    props = await page.evaluate(() => { const { draws, tris, lights } = __game.map.props; return { draws, tris, lights }; });
    Object.assign(plan, await page.evaluate(() => __game.map.props.spots));
    // Scratch tree: stand on the trail side of it. Hollow: from the trail mouth, looking at the bed.
    const st = plan.scratchTree, n = { x: Math.cos(st.faceYaw + Math.PI / 2), z: Math.sin(st.faceYaw + Math.PI / 2) };
    SPOTS.scratchFront = { x: st.x + n.x * 2.6, z: st.z + n.z * 2.6 }; SPOTS.scratchFrontLook = st;
    SPOTS.hollowView = { x: plan.bedding.x - 7, z: plan.bedding.z + 9 }; SPOTS.hollowViewLook = { x: plan.bedding.x - 2, z: plan.bedding.z - 3 };
  }
  for (const [name, spotName, [dx, dz], lookY, light] of VIEWS) {
    const s = SPOTS[spotName] ?? plan[spotName];
    const look = SPOTS[`${spotName}Look`] ?? s;
    const cam = SPOTS[spotName] ? s : { x: s.x + dx, z: s.z + dz };
    await page.evaluate(([cx, cz, lx, ly, lz, light]) => {
      const g = __game, p = g.player;
      p.position.set(cx, 0, cz); p.velocity.set(0, 0, 0);
      p.yaw = Math.atan2(-(lx - cx), -(lz - cz));
      p.pitch = Math.atan2(ly - 1.6, Math.hypot(lx - cx, lz - cz));
      if (g.flashlight.on !== light) g.flashlight.toggle();
      g.flashlight.battery = 1;
    }, [cam.x, cam.z, look.x, lookY, look.z, light]);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/${name}-${mode}.png` });
  }
  // Frame cost: trailhead (kiosk + lantern) and the hollow approach (stand, traces).
  perf[mode] = {};
  for (const [where, x, z, yaw] of [['trailhead', 2, 128, 0.6], ['hollow', 14, -86, 0.4]]) {
    perf[mode][where] = await page.evaluate(([x, z, yaw]) => new Promise((res) => {
      const g = __game; g.player.position.set(x, 0, z); g.player.yaw = yaw; g.player.pitch = 0;
      const info = g.renderer.info; let n = 0; const t0 = performance.now();
      const tick = () => {
        if (++n < 40) return requestAnimationFrame(tick);
        res({ ms_per_frame: +((performance.now() - t0) / n).toFixed(1), draw_calls: info.render.calls, triangles: info.render.triangles });
      };
      setTimeout(() => requestAnimationFrame(tick), 600);
    }), [x, z, yaw]);
  }

  if (mode === 'after') {
    // Climb the tree stand by walking up its steps (hold W, facing north up the stair).
    const climb = await page.evaluate(async () => {
      const g = __game, p = g.player, s = g.map.props.spots.treeStand;
      g.input.locked = true;
      p.position.set(s.x, 0, s.z + 6); p.velocity.set(0, 0, 0); p.yaw = 0; p.pitch = 0;
      g.input.keys.add('KeyW');
      let top = 0;
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 100)); top = Math.max(top, p.position.y); }
      g.input.keys.delete('KeyW');
      return { maxY: +top.toFixed(2), endY: +p.position.y.toFixed(2), standHeight: g.map.props.standTop.y };
    });
    check('the tree stand can be climbed by walking up its steps', climb.endY >= climb.standHeight - 0.05, climb);
    await page.evaluate(() => { const g = __game, p = g.player, h = g.map.landmarks.hollow; p.yaw = Math.atan2(-(h.x - p.position.x), -(h.z - p.position.z)); p.pitch = -0.12; });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}/11-view-from-tree-stand-over-hollow-trail-after.png` });
    // Walk into the boundary fence: you can't leave the map past it.
    const fence = await page.evaluate(async () => {
      const g = __game, p = g.player, f = g.map.props.fence;
      p.position.set(40, 0, f - 4); p.velocity.set(0, 0, 0); p.yaw = Math.PI; // facing +z (south)
      g.input.keys.add('KeyW');
      for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 100));
      g.input.keys.delete('KeyW');
      return { fence: f, playerZ: +p.position.z.toFixed(2) };
    });
    check('the boundary fence stops you at the map edge', fence.playerZ < fence.fence, fence);
    // No tree trunk inside any prop's footprint.
    const overlap = await page.evaluate(() => {
      const g = __game, s = g.map.props.spots, hits = [];
      const trunks = []; g.scene.traverse((m) => { if (m.isInstancedMesh && /^kit-/.test(m.name) && !/fern|grass|tuft|bush|sedge|moss/i.test(m.name)) trunks.push(m); });
      const mtx = new g.THREE.Matrix4(), v = new g.THREE.Vector3();
      for (const m of trunks) for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mtx); v.setFromMatrixPosition(mtx);
        for (const [k, p] of Object.entries(s)) if (['kiosk', 'treeStand', 'teepee', 'xArch', 'cairn', 'teepee2'].includes(k) && Math.hypot(v.x - p.x, v.z - p.z) < 1.2) hits.push([k, +v.x.toFixed(1), +v.z.toFixed(1)]);
      }
      return { trunkMeshes: trunks.length, hits };
    });
    check('no trees grow through the kiosk, stand or stick structures', overlap.hits.length === 0, overlap);
  }
  await page.close();
}

check('all the new content is a handful of merged meshes (≤ 16 draw calls, ≤ 30k triangles, 2 lights)', props.draws <= 16 && props.tris <= 30000 && props.lights <= 2, props);
check('frame time stays within 15% of before (software renderer, relative)', perf.after.trailhead.ms_per_frame <= perf.before.trailhead.ms_per_frame * 1.15 + 2
  && perf.after.hollow.ms_per_frame <= perf.before.hollow.ms_per_frame * 1.15 + 2, perf);
check('no page errors', errors.length === 0, errors);
writeFileSync(`${out}/perf.json`, JSON.stringify(perf, null, 2));
console.log(results.join('\n'));
await browser.close();
server.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
