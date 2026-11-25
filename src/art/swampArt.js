import * as THREE from 'three';
import { pixelTexture as paint } from './pixelTex.js';
import { snapTextureToPalette, RAMPS } from './palette.js';

// Swamp art pass (art #40): extra swamp textures painted to the style guide and snapped to the
// master palette, plus drifting low ground-fog banks over the water.

const pixelTexture = (...args) => snapTextureToPalette(paint(...args));

// 4x4 Bayer matrix (ordered dither), values 0..15.
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// Bald-cypress foliage spray, 32 x 32, alpha: feathery flat sprays hanging from a twig, short
// soft needles in two rows, lit on the upper edge. Hung in clusters under each crown clump.
export function cypressSprayCard(variant = 0) {
  return pixelTexture(`cypressSpray${variant}`, 32, 32, (g, px, r, w, h) => {
    const N = RAMPS.needles, M = RAMPS.moss;
    const pal = variant === 1 ? [N[1], M[2], M[3], M[4], M[5]] : [N[1], N[2], N[3], N[4], N[5]];
    // Main twig hangs from the top, curving; feather sprays branch off both sides.
    let x = 15;
    for (let y = 0; y < h - 2; y++) {
      if (r() < 0.25) x += r() < 0.5 ? -1 : 1;
      px(x, y, RAMPS.bark[2]);
      if (y % 3 === 1 && y > 1) {
        for (const s of [-1, 1]) {
          const len = Math.round((5 + r() * 6) * (1 - y / h * 0.5));
          let sx = x, sy = y;
          for (let k = 1; k <= len; k++) {
            sx += s; if (k % 3 === 0) sy += 1;           // sprays droop
            px(sx, sy, pal[1]);
            px(sx, sy - 1, pal[k < len - 1 ? 3 : 2]);     // needle row above, lit
            if (r() < 0.7) px(sx, sy + 1, pal[0]);        // needle row below, shaded
            if (k === len && r() < 0.6) px(sx + s, sy, pal[4]);
          }
        }
      }
    }
  }, { seed: 401 + variant, alpha: true });
}

// Long Spanish moss strands, 16 x 64, alpha: thin grey-green tangles with gaps and knots.
export function longMossCard() {
  return pixelTexture('longMoss', 16, 64, (g, px, r, w, h) => {
    const pal = [RAMPS.lichen[0], RAMPS.lichen[1], RAMPS.lichen[2], RAMPS.lichen[3]];
    for (let s = 0; s < 11; s++) {
      let x = 1 + Math.floor(r() * (w - 2));
      const len = 18 + Math.floor(r() * (h - 18));
      for (let y = 0; y < len; y++) {
        if (r() < 0.35) x += r() < 0.5 ? -1 : 1;
        x = Math.max(0, Math.min(w - 1, x));
        const c = y < 6 ? 2 : y > len - 5 ? 0 : 1 + Math.floor(r() * 2.2);
        px(x, y, pal[Math.min(3, c)]);
        if (r() < 0.12) { px(x + 1, y, pal[0]); px(x - 1, y + 1, pal[0]); }   // knots
      }
    }
  }, { seed: 411, alpha: true });
}

// Lily pad with a water-lily flower, 16 x 16, alpha.
export function lilyFlowerCard() {
  return pixelTexture('lilyFlower', 16, 16, (g, px, r, w, h) => {
    const leaf = RAMPS.moss;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
      if (d > 7.2 || (dx > 0 && Math.abs(dy) < dx * 0.35)) continue;
      px(x, y, d > 6.2 ? leaf[1] : (x + y) % 5 === 0 ? leaf[3] : leaf[2]);
    }
    // Flower: pale petals around a warm centre.
    const petals = [[6, 5], [8, 5], [5, 7], [9, 7], [6, 9], [8, 9], [7, 4], [7, 10], [4, 7], [10, 7]];
    for (const [x, y] of petals) px(x, y, r() < 0.5 ? RAMPS.night[6] : RAMPS.night[5]);
    for (const [x, y] of [[6, 6], [8, 6], [6, 8], [8, 8]]) px(x, y, RAMPS.night[6]);
    px(7, 7, RAMPS.warm[4]); px(7, 6, RAMPS.warm[3]); px(7, 8, RAMPS.warm[3]);
  }, { seed: 421, alpha: true });
}

// Ground fog, 64 x 64, alpha: soft periodic blobs, posterised to three density levels with an
// ordered dither between them (crisp pixel fog, no blur). Tiles seamlessly.
export function fogTexture() {
  return paint('swampFog', 64, 64, (g, px, r, w, h) => {
    const blobs = [];
    for (let i = 0; i < 14; i++) blobs.push([r() * w, r() * h, 8 + r() * 16]);
    const img = g.createImageData(w, h);
    const col = [0x4a, 0x6a, 0x66];   // palette water[5]: pale green-grey mist
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (const [bx, by, br] of blobs) {
        // Periodic distance so the tile wraps.
        let dx = Math.abs(x - bx); dx = Math.min(dx, w - dx);
        let dy = Math.abs(y - by); dy = Math.min(dy, h - dy);
        v += Math.max(0, 1 - Math.hypot(dx, dy * 1.6) / br);
      }
      v = Math.min(1, v * 0.8);
      // 0 .. 3 levels, Bayer-dithered between them.
      const lvl = v * 3, base = Math.floor(lvl), frac = lvl - base;
      const q = Math.min(3, base + (frac * 16 > BAYER[y % 4][x % 4] ? 1 : 0));
      const i = (y * w + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2];
      img.data[i + 3] = [0, 70, 130, 190][q];
    }
    g.putImageData(img, 0, 0);
  }, { seed: 431 });
}

/**
 * Low fog banks hugging the water: a few big layered sheets at different heights, each drifting
 * its own way, so the mist parallaxes as you walk. Returns the group (animated on render).
 */
export function buildFogBanks({ half, water, rand }) {
  const group = new THREE.Group();
  group.name = 'swamp-fog';
  const tex = fogTexture();
  // Tiles of ~5-7 m (about 10 fog texels per metre); offsets differ so the layers never line up.
  const layers = [
    { y: water + 0.12, size: half * 2.2, opacity: 0.42, speed: [0.004, 0.0015], rep: 20 },
    { y: water + 0.6, size: half * 2.2, opacity: 0.28, speed: [-0.003, 0.002], rep: 17 },
  ];
  const mats = [];
  for (const L of layers) {
    const t = tex.clone();
    t.repeat.set(L.rep, L.rep);
    t.offset.set(rand(), rand());
    t.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: t, transparent: true, opacity: L.opacity, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    // Mist thins out around you (you're walking through it, not under a sheet) and gathers
    // with distance: alpha fades in from 3 m to 14 m from the camera.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= smoothstep(3.0, 14.0, distance(vFogWorld, cameraPosition));\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => 'swampFogNear';
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L.size, L.size), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = L.y;
    m.renderOrder = 2;
    m.name = 'swamp-fog-layer';
    group.add(m);
    mats.push([mat, L]);
  }
  const snap = (v) => Math.floor(v * 64) / 64;   // move a whole texel at a time (no smear)
  group.children[0].onBeforeRender = () => {
    const now = performance.now() / 1000;
    for (const [mat, L] of mats) mat.map.offset.set(snap(now * L.speed[0]) + mat.map.userData.ox, snap(now * L.speed[1]) + mat.map.userData.oz);
  };
  for (const [mat] of mats) { mat.map.userData.ox = mat.map.offset.x; mat.map.userData.oz = mat.map.offset.y; }
  return group;
}
