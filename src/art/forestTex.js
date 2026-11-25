import { pixelTexture, rng } from './pixelTex.js';
import { RAMPS } from './palette.js';

// Pine Hollow forest texture set, painted to the style guide (docs/art-style-guide.md):
// 32 texels per metre, master-palette ramps only, posterised value bands with ordered
// dithering only where bands meet, 1-texel darkest-ramp outlines on material breaks
// (cracks, plate edges, leaf and pebble undersides), soft top light painted in (highlights
// on upper edges). Every tile wraps seamlessly: all noise and features are periodic.

// ---- Periodic helpers ----------------------------------------------------------------------

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Tileable value noise: `cells` lattice cells across the tile, smoothstep-interpolated. */
function periodicNoise(r, w, h, cellsX, cellsY = cellsX) {
  const g = [];
  for (let j = 0; j < cellsY; j++) { g.push([]); for (let i = 0; i < cellsX; i++) g[j].push(r()); }
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (((x / w) * cellsX) % cellsX + cellsX) % cellsX, fy = (((y / h) * cellsY) % cellsY + cellsY) % cellsY;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), i1 = (i0 + 1) % cellsX, j1 = (j0 + 1) % cellsY;
    const tx = s(fx - i0), ty = s(fy - j0);
    const a = g[j0][i0] + (g[j0][i1] - g[j0][i0]) * tx;
    const b = g[j1][i0] + (g[j1][i1] - g[j1][i0]) * tx;
    return a + (b - a) * ty;
  };
}

/** Fractal (2-3 octave) periodic noise in 0..1. */
function fbm(r, w, h, base, octaves = 3) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(periodicNoise(r, w, h, base << o, base << o));
  return (x, y) => {
    let v = 0, amp = 1, tot = 0;
    for (const n of layers) { v += n(x, y) * amp; tot += amp; amp *= 0.5; }
    return v / tot;
  };
}

/** Posterise a 0..1 value into a ramp index range with Bayer dithering at the band edges. */
function band(v, x, y, lo, hi) {
  const t = lo + v * (hi - lo + 1) - 0.5;
  const base = Math.floor(t), frac = t - base;
  const d = BAYER4[(y & 3) * 4 + (x & 3)];
  return Math.max(lo, Math.min(hi, base + (frac > d ? 1 : 0)));
}

/** Periodic Voronoi: returns { d1, d2, id } for the nearest and second-nearest seed. */
function voronoi(r, w, h, n, stretchY = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: r() * w, y: r() * h, id: i, v: r() });
  return (x, y) => {
    let d1 = Infinity, d2 = Infinity, best = null;
    for (const p of pts) {
      let dx = Math.abs(x - p.x), dy = Math.abs(y - p.y);
      dx = Math.min(dx, w - dx); dy = Math.min(dy, h - dy) / stretchY;
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    return { d1, d2, p: best };
  };
}

// ---- Textures -------------------------------------------------------------------------------

/** Pine bark, 32 x 64 (1 m around x 2 m tall): long vertical plates split by dark fissures. */
export function pineBarkTexture() {
  return pixelTexture('f-bark', 32, 64, (g, px, r, w, h) => {
    const R = RAMPS.bark, L = RAMPS.lichen;
    const vor = voronoi(r, w, h, 14, 3.2);          // tall plates
    const n = fbm(r, w, h, 2, 3);
    const grid = [];
    for (let y = 0; y < h; y++) {
      grid.push([]);
      for (let x = 0; x < w; x++) {
        const { d1, d2, p } = vor(x, y);
        const edge = d2 - d1;
        let i;
        if (edge < 0.9) i = 0;                                  // fissure: darkest (outline rule)
        else if (edge < 1.8) i = 1;
        else i = band(0.25 + p.v * 0.35 + n(x, y) * 0.4, x, y, 2, 5);
        grid[y].push(i);
      }
    }
    // Plates catch light on their upper-left rims (soft top light).
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let i = grid[y][x];
      if (i >= 2 && grid[(y + h - 1) % h][x] <= 1) i = Math.min(6, i + 2);
      else if (i >= 2 && grid[y][(x + w - 1) % w] <= 1) i = Math.min(6, i + 1);
      px(x, y, R[i]);
    }
    // Horizontal scale lines across plates (pine bark flakes).
    for (let k = 0; k < 26; k++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), len = 2 + Math.floor(r() * 3);
      for (let j = 0; j < len; j++) if (grid[y][(x + j) % w] >= 2) px(x + j, y, R[1]);
    }
    // Lichen crusts in a few patches.
    for (let k = 0; k < 5; k++) {
      const cx = Math.floor(r() * w), cy = Math.floor(r() * h);
      for (let j = 0; j < 7; j++) {
        const x = cx + Math.floor(r() * 4) - 1, y = cy + Math.floor(r() * 4) - 1;
        if (grid[(y + h) % h][(x + w) % w] >= 2) px(x, y, L[Math.floor(r() * 3)]);
      }
      px(cx, cy, L[3]);
    }
  }, { seed: 501 });
}

/** Forest dirt / trail, 64 x 64 (2 m): packed earth, pebbles with outlines, root threads. */
export function dirtTexture() {
  return pixelTexture('f-dirt', 64, 64, (g, px, r, w, h) => {
    const R = RAMPS.dirt, K = RAMPS.rock;
    const n = fbm(r, w, h, 3, 3), m = fbm(r, w, h, 8, 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, R[band(0.45 + (n(x, y) - 0.5) * 0.45 + (m(x, y) - 0.5) * 0.5, x, y, 1, 4)]);
    // Pebbles: 2-3 texel stones, lit top-left, outlined bottom-right.
    for (let k = 0; k < 34; k++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), big = r() < 0.4;
      const tone = 3 + Math.floor(r() * 2);
      px(x, y, K[tone]); if (big) { px(x + 1, y, K[tone - 1]); px(x, y + 1, K[tone - 1]); px(x + 1, y + 1, K[tone - 2]); }
      px(x - 1, y - 1, K[tone + 1]);                               // highlight
      px(x + (big ? 2 : 1), y + (big ? 1 : 0), R[0]);             // outline / contact shadow
      px(x + (big ? 1 : 0), y + (big ? 2 : 1), R[0]);
    }
    // Root threads: thin wandering darker lines with a lit pixel every so often.
    for (let k = 0; k < 4; k++) {
      let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
      for (let s = 0; s < 22; s++) {
        a += (r() - 0.5) * 0.7; x += Math.cos(a); y += Math.sin(a);
        px(Math.round(x), Math.round(y), s % 5 === 0 ? RAMPS.bark[4] : RAMPS.bark[2]);
        px(Math.round(x), Math.round(y) + 1, R[0]);
      }
    }
  }, { seed: 502 });
}

/** Leaf litter, 64 x 64 (2 m): dirt base covered in rust/amber leaves and pine needles. */
export function leafLitterTexture() {
  return pixelTexture('f-litter', 64, 64, (g, px, r, w, h) => {
    const D = RAMPS.dirt, Lt = RAMPS.litter, N = RAMPS.needles;
    const n = fbm(r, w, h, 4, 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, D[band(0.3 + (n(x, y) - 0.5) * 0.6, x, y, 0, 3)]);   // low macro contrast: no visible repeat
    // Fallen pine needles: short diagonal strokes, two tones.
    for (let k = 0; k < 160; k++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), dx = r() < 0.5 ? 1 : -1, len = 2 + Math.floor(r() * 3);
      const c = r() < 0.5 ? Lt[1 + Math.floor(r() * 2)] : r() < 0.6 ? RAMPS.dirt[4] : N[3];
      for (let j = 0; j < len; j++) px(x + j * dx, y + (j >> 1), c);
    }
    // Leaves: small lozenges (5x3), outlined below, lit along the top edge, with a midrib.
    const leaf = (x, y, flip, tone) => {
      const shape = flip ? [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [4, 2]]
        : [[2, 0], [3, 0], [1, 1], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
      for (const [sx, sy] of shape) px(x + sx, y + sy, Lt[sy === 0 ? tone + 1 : tone]);
      for (const [sx, sy] of shape) if (sy === 2) px(x + sx, y + 3, Lt[0]);   // outline under
      px(x + 2, y + 1, Lt[tone - 1]);                                          // midrib
    };
    for (let k = 0; k < 42; k++) leaf(Math.floor(r() * w), Math.floor(r() * h), r() < 0.5, 1 + Math.floor(r() * 3));
    // A few bright fresh leaves as focal accents.
    for (let k = 0; k < 4; k++) leaf(Math.floor(r() * w), Math.floor(r() * h), r() < 0.5, 4);
  }, { seed: 503 });
}

/** Moss, 32 x 32 (1 m): cushiony clumps, dark gaps between, sparkly highlight tips. */
export function mossTexture() {
  return pixelTexture('f-moss', 32, 32, (g, px, r, w, h) => {
    const M = RAMPS.moss;
    const vor = voronoi(r, w, h, 16);
    const n = fbm(r, w, h, 2, 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const { d1, d2, p } = vor(x, y);
      const dome = Math.max(0, 1 - d1 / 5);               // clumps bulge at their centres
      let i = d2 - d1 < 0.8 ? 0 : band(dome * 0.6 + p.v * 0.2 + n(x, y) * 0.2, x, y, 1, 5);
      px(x, y, M[i]);
    }
    for (let k = 0; k < 40; k++) px(Math.floor(r() * w), Math.floor(r() * h), M[6]);   // spore-tip glints
  }, { seed: 504 });
}

/** Granite rock, 64 x 64 (2 m): faceted blocks, dark cracks, lit top edges, lichen. */
export function rockTexture() {
  return pixelTexture('f-rock', 64, 64, (g, px, r, w, h) => {
    const K = RAMPS.rock, L = RAMPS.lichen, M = RAMPS.moss;
    const vor = voronoi(r, w, h, 7, 0.8);
    const n = fbm(r, w, h, 4, 3), mask = fbm(r, w, h, 3, 2);
    const grid = [];
    for (let y = 0; y < h; y++) {
      grid.push([]);
      for (let x = 0; x < w; x++) {
        const { d1, d2, p } = vor(x, y);
        const crack = d2 - d1 < 1.0 && mask(x, y) > 0.45;          // cracks break up: rock, not paving
        const facet = (p.x / w + p.y / h) % 1;                     // each facet faces the light differently
        grid[y].push(crack ? 0 : band(0.15 + facet * 0.3 + n(x, y) * 0.55, x, y, 2, 5));
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let i = grid[y][x];
      if (i > 0 && grid[(y + h - 1) % h][x] === 0) i = 6;          // lit lip above a crack
      else if (i > 0 && grid[(y + 1) % h][x] === 0) i = 1;         // shadow under a ledge
      px(x, y, K[i]);
    }
    // Speckle (feldspar) and lichen/moss in the crevices.
    for (let k = 0; k < 120; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); if (grid[y][x] > 1) px(x, y, K[grid[y][x] + (r() < 0.5 ? 1 : -1)]); }
    for (let k = 0; k < 7; k++) {
      const cx = Math.floor(r() * w), cy = Math.floor(r() * h);
      for (let j = 0; j < 10; j++) px(cx + Math.floor(r() * 5) - 2, cy + Math.floor(r() * 3) - 1, L[Math.floor(r() * 4)]);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y][x] === 0 && r() < 0.18) px(x, y - 1, M[2 + Math.floor(r() * 2)]);
  }, { seed: 505 });
}

/** Grass ground, 64 x 64 (2 m): blades over dark soil, dry tips catching light. */
export function grassTexture() {
  return pixelTexture('f-grass', 64, 64, (g, px, r, w, h) => {
    const G = RAMPS.grass, M = RAMPS.moss;
    const n = fbm(r, w, h, 3, 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, M[band(n(x, y) * 0.8, x, y, 0, 2)]);
    for (let k = 0; k < 520; k++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), len = 2 + Math.floor(r() * 3);
      const lean = r() < 0.5 ? 0 : r() < 0.5 ? 1 : -1;
      const top = 3 + Math.floor(r() * 3);
      for (let j = 0; j < len; j++) px(x + (j === len - 1 ? lean : 0), y - j, G[j === len - 1 ? top + (r() < 0.3 ? 1 : 0) : top - 1 - (j === 0 ? 1 : 0)]);
      px(x, y + 1, M[0]);                                  // blade base shadow (outline)
    }
  }, { seed: 506 });
}

/** Grass tuft card, 32 x 32 with alpha (stands up in the world as crossed quads). */
export function grassTuftTexture() {
  return pixelTexture('f-tuft', 32, 32, (g, px, r, w, h) => {
    const G = RAMPS.grass;
    for (let s = 0; s < 16; s++) {
      const base = 8 + Math.floor(r() * 16), top = 4 + Math.floor(r() * 16), lean = (r() - 0.5) * 1.2;
      for (let y = h - 1; y >= top; y--) {
        const t = (h - 1 - y) / (h - 1 - top);
        const x = Math.round(base + lean * t * t * 10);
        px(x, y, G[t > 0.85 ? 6 : t > 0.6 ? 5 : t > 0.3 ? 4 : 2]);
        if (t < 0.3) px(x + 1, y, G[1]);
      }
    }
  }, { seed: 507, alpha: true });
}

/** Pine needle foliage, 32 x 32 (1 m): layered needle sprays, dark gaps, lit tips. */
export function needleTexture() {
  return pixelTexture('f-needles', 32, 32, (g, px, r, w, h) => {
    const N = RAMPS.needles;
    g.fillStyle = N[1]; g.fillRect(0, 0, w, h);
    // Sprays: a twig line with needles fanning down-outward, lit on top.
    for (let k = 0; k < 30; k++) {
      const x0 = Math.floor(r() * w), y0 = Math.floor(r() * h), len = 4 + Math.floor(r() * 5), dir = r() < 0.5 ? 1 : -1;
      const tone = 2 + Math.floor(r() * 3);
      for (let j = 0; j < len; j++) {
        const x = x0 + j * dir, y = y0 + (j >> 2);
        px(x, y - 1, N[Math.min(6, tone + 1)]); px(x, y, N[tone]); px(x, y + 1, N[tone - 1]);
        if (j % 2 === 0) px(x, y + 2, N[tone - 2]);
      }
      px(x0 + len * dir, y0 + (len >> 2), N[6]);
    }
  }, { seed: 508 });
}

export const FOREST_TEXTURES = { needleTexture, pineBarkTexture, dirtTexture, leafLitterTexture, mossTexture, rockTexture, grassTexture, grassTuftTexture };
