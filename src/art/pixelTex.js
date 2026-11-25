import * as THREE from 'three';

// Hand-authored-style pixel-art textures, painted procedurally at low resolution (16-64 px)
// with small fixed palettes, dark outlines and deliberate wear. Sampled nearest-neighbour so
// every texel stays a crisp square: the "texture first, then pixel render" look.
//
// Every texture is cached by name, so many meshes share one GPU texture.

const cache = new Map();

export function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paint a w x h canvas with draw(g, px, r) and wrap it as a crisp, tiling texture. */
export function pixelTexture(name, w, h, draw, { seed = 1, alpha = false } = {}) {
  if (cache.has(name)) return cache.get(name);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const r = rng(seed);
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(((x % w) + w) % w, ((y % h) + h) % h, 1, 1); };
  draw(g, px, r, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.alpha = alpha;
  cache.set(name, t);
  return t;
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// --- Wood -----------------------------------------------------------------------------------

// One weathered plank, grain running along U (32 x 8). Light top edge, dark outline, knots,
// rusty nail heads at both ends, grey sun-bleached patches.
export function plankTexture(variant = 0) {
  return pixelTexture(`plank${variant}`, 32, 8, (g, px, r, w, h) => {
    const pal = [
      ['#2a211b', '#45372c', '#5b4a3b', '#6f5c49', '#86715a', '#9a8670'],   // brown
      ['#26221f', '#3f3a34', '#575049', '#6c645a', '#837a6d', '#9a9183'],   // grey bleached
      ['#2a1f19', '#4a3428', '#614535', '#785742', '#8e6a51', '#a47f63'],   // reddish cypress
    ][variant % 3];
    g.fillStyle = pal[3]; g.fillRect(0, 0, w, h);
    // Grain streaks.
    for (let y = 1; y < h - 1; y++) {
      let x = 0;
      while (x < w) {
        const len = 2 + Math.floor(r() * 9);
        const c = r() < 0.5 ? pal[2] : r() < 0.6 ? pal[4] : pal[3];
        g.fillStyle = c; g.fillRect(x, y, len, 1);
        x += len;
      }
    }
    // Sun-bleached patches and dark rot.
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * w), y = 1 + Math.floor(r() * (h - 3));
      g.fillStyle = r() < 0.6 ? pal[5] : pal[1];
      g.fillRect(x, y, 2 + Math.floor(r() * 4), 1);
    }
    // Knot.
    const kx = 6 + Math.floor(r() * 20), ky = 2 + Math.floor(r() * 3);
    px(kx, ky, pal[0]); px(kx + 1, ky, pal[1]); px(kx - 1, ky, pal[2]); px(kx, ky + 1, pal[1]);
    // Highlights along the top, outline on the bottom and ends.
    g.fillStyle = pal[4]; g.fillRect(0, 0, w, 1);
    g.fillStyle = pal[0]; g.fillRect(0, h - 1, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(w - 1, 0, 1, h);
    // Rusty nails.
    for (const nx of [2, w - 3]) { px(nx, 2, '#6b3a22'); px(nx, 5, '#6b3a22'); px(nx, 2 - 1 + 1, '#8a5030'); }
  }, { seed: 11 + variant * 7 });
}

// Vertical wall boards (shack), 32 x 32: four boards with gaps, wear and a water line at the foot.
export function boardWallTexture() {
  return pixelTexture('boardwall', 32, 32, (g, px, r, w, h) => {
    const pal = ['#1e1814', '#3a2e25', '#4d3e31', '#5f4d3d', '#72604c', '#86735c'];
    for (let b = 0; b < 4; b++) {
      const x0 = b * 8, base = 2 + Math.floor(r() * 2);
      g.fillStyle = pal[base]; g.fillRect(x0, 0, 8, h);
      for (let y = 0; y < h; y++) if (r() < 0.35) { g.fillStyle = pal[base + (r() < 0.5 ? -1 : 1)]; g.fillRect(x0 + 1 + Math.floor(r() * 6), y, 1, 1 + Math.floor(r() * 3)); }
      g.fillStyle = pal[0]; g.fillRect(x0, 0, 1, h);                      // gap between boards
      g.fillStyle = pal[base + 1]; g.fillRect(x0 + 1, 0, 1, h);           // lit edge
      px(x0 + 4, 3, '#6b3a22'); px(x0 + 4, 28, '#6b3a22');                 // nails
    }
    // Damp water line and moss creeping up from the bottom.
    for (let x = 0; x < w; x++) {
      const top = h - 4 - Math.floor(r() * 3);
      for (let y = top; y < h; y++) px(x, y, y === top ? '#3c4a2a' : r() < 0.5 ? '#2b3320' : '#222a1a');
    }
  }, { seed: 41 });
}

// Rusty corrugated tin roof, 16 x 16 (ridges run along V).
export function tinRoofTexture() {
  return pixelTexture('tinroof', 16, 16, (g, px, r, w, h) => {
    const ridge = ['#3b3634', '#5a5450', '#77706a', '#4a4441'];
    for (let x = 0; x < w; x++) { g.fillStyle = ridge[x % 4]; g.fillRect(x, 0, 1, h); }
    const rust = ['#5e2f1a', '#7a3f20', '#94552b', '#4a2616'];
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      px(x, y, pick(r, rust));
      if (r() < 0.5) px(x, y + 1, pick(r, rust));   // drips run down
    }
  }, { seed: 5 });
}

// --- Trees ----------------------------------------------------------------------------------

// Cypress bark, 16 x 32: deep vertical fissures, reddish-grey ridges, lichen flecks.
export function barkTexture(variant = 0) {
  return pixelTexture(`bark${variant}`, 16, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#191614', '#2d2824', '#433b35', '#5a5047', '#71665a']      // dead, grey
      : ['#1a1311', '#33241e', '#4a342a', '#604536', '#775847'];     // living cypress, reddish
    g.fillStyle = pal[2]; g.fillRect(0, 0, w, h);
    // Ridges: wandering vertical strips.
    for (let s = 0; s < 5; s++) {
      let x = Math.floor(r() * w);
      for (let y = 0; y < h; y++) {
        if (r() < 0.25) x += r() < 0.5 ? -1 : 1;
        px(x, y, pal[3]); px(x + 1, y, r() < 0.3 ? pal[4] : pal[3]);
      }
    }
    // Fissures.
    for (let s = 0; s < 4; s++) {
      let x = Math.floor(r() * w);
      for (let y = 0; y < h; y++) { if (r() < 0.3) x += r() < 0.5 ? -1 : 1; px(x, y, pal[0]); if (r() < 0.4) px(x, y, pal[1]); }
    }
    // Lichen.
    for (let i = 0; i < 10; i++) px(Math.floor(r() * w), Math.floor(r() * h), r() < 0.5 ? '#5d6b4a' : '#7c8762');
  }, { seed: 23 + variant });
}

// Hanging Spanish moss card, 16 x 32, transparent background.
export function mossTexture() {
  return pixelTexture('moss', 16, 32, (g, px, r, w, h) => {
    const pal = ['#4a5446', '#5f6a58', '#76806b', '#8e967f'];
    for (let s = 0; s < 9; s++) {
      let x = 1 + Math.floor(r() * (w - 2));
      const len = 10 + Math.floor(r() * (h - 10));
      for (let y = 0; y < len; y++) {
        if (r() < 0.3) x += r() < 0.5 ? -1 : 1;
        x = Math.max(0, Math.min(w - 1, x));
        px(x, y, pal[Math.min(3, Math.floor(r() * 4) + (y < 4 ? 1 : 0))]);
        if (r() < 0.2) px(x + 1, y, pal[0]);
      }
    }
  }, { seed: 77, alpha: true });
}

// Clumped needle foliage for cypress crowns, 32 x 32.
export function foliageTexture() {
  return pixelTexture('foliage', 32, 32, (g, px, r, w, h) => {
    const pal = ['#14211a', '#1e3222', '#2a452c', '#3a5c36', '#4f7442', '#6a8d50'];
    g.fillStyle = pal[1]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), c = 2 + Math.floor(r() * 4);
      // Little needle tufts: a lit pixel with a darker pixel under it.
      px(x, y, pal[c]); px(x + 1, y, pal[c - 1]); px(x, y + 1, pal[c - 2]);
    }
  }, { seed: 31 });
}

// --- Ground & water -------------------------------------------------------------------------

// Swamp mud, 32 x 32: dark peat, wet sheen spots, moss and leaf litter.
export function mudTexture() {
  return pixelTexture('mud', 32, 32, (g, px, r, w, h) => {
    const pal = ['#17130f', '#221c16', '#2c241c', '#372d22', '#43382a'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = r() + r();
      px(x, y, pal[Math.min(4, Math.floor(n * 1.6))]);
    }
    for (let i = 0; i < 6; i++) {         // moss patches
      const cx = Math.floor(r() * w), cy = Math.floor(r() * h), rad = 1 + Math.floor(r() * 3);
      for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++)
        if (x * x + y * y <= rad * rad && r() < 0.8) px(cx + x, cy + y, r() < 0.5 ? '#2f3a22' : '#3d4a2a');
    }
    for (let i = 0; i < 10; i++) px(Math.floor(r() * w), Math.floor(r() * h), r() < 0.5 ? '#5c4428' : '#6e5230'); // leaves
    for (let i = 0; i < 5; i++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, '#4e5a56'); px(x + 1, y, '#3a4442'); } // wet glints
  }, { seed: 13 });
}

// Swamp water, 64 x 64: murky green-black with pixel ripple dashes and floating algae.
// Scrolled slowly in the game so the ripples drift.
export function waterTexture(deep = false) {
  return pixelTexture(deep ? 'waterDeep' : 'water', 64, 64, (g, px, r, w, h) => {
    const pal = deep
      ? ['#0a1213', '#0f1a1c', '#152326', '#1d3033', '#2c4548']
      : ['#16221b', '#1e2d23', '#27392c', '#344a38', '#4a6450'];
    g.fillStyle = pal[1]; g.fillRect(0, 0, w, h);
    // Large soft blotches.
    for (let i = 0; i < 40; i++) {
      const cx = Math.floor(r() * w), cy = Math.floor(r() * h), rad = 2 + Math.floor(r() * 5), c = r() < 0.5 ? pal[0] : pal[2];
      for (let y = -rad; y <= rad; y++) for (let x = -rad * 2; x <= rad * 2; x++)
        if ((x * x) / 4 + y * y <= rad * rad && r() < 0.85) px(cx + x, cy + y, c);
    }
    // Ripple dashes: short horizontal highlight lines with a dark lip under them.
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), len = 2 + Math.floor(r() * 6);
      for (let k = 0; k < len; k++) { px(x + k, y, k === 0 || k === len - 1 ? pal[3] : pal[4]); px(x + k, y + 1, pal[0]); }
    }
    if (!deep) for (let i = 0; i < 30; i++) {     // duckweed / algae flecks
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      px(x, y, '#4b6a2c'); if (r() < 0.5) px(x + 1, y, '#3a5524');
    }
  }, { seed: deep ? 91 : 89 });
}

// --- Plants ---------------------------------------------------------------------------------

// Reeds and cattails card, 32 x 32, transparent: a clump of blades fanning out of one base.
export function reedTexture(variant = 0) {
  return pixelTexture(`reed${variant}`, 32, 32, (g, px, r, w, h) => {
    const blades = variant === 1
      ? ['#5d5a2e', '#77703a', '#8f864a', '#a59a5a']   // dry, golden
      : ['#2f3d1f', '#3e5228', '#526a32', '#68823f'];  // green
    const n = 9 + Math.floor(r() * 5);
    for (let s = 0; s < n; s++) {
      const base = 12 + Math.floor(r() * 8);
      const top = 2 + Math.floor(r() * 14);
      const lean = (r() - 0.5) * 0.9;
      const c = 1 + Math.floor(r() * 3);
      for (let y = h - 1; y >= top; y--) {
        const t = (h - 1 - y) / (h - 1 - top);
        const x = Math.round(base + lean * t * t * 14);
        px(x, y, blades[t > 0.8 ? Math.min(3, c + 1) : c]);
        if (y > h - 6) px(x + 1, y, blades[0]);
      }
      // Some carry a cattail head.
      if (variant === 0 && r() < 0.35) {
        const x = Math.round(base + lean * 14 * 0.7), y = top + 3;
        for (let k = 0; k < 4; k++) { px(x, y + k, k === 0 ? '#6a3e22' : '#4a2a17'); px(x + 1, y + k, '#3a2112'); }
      }
    }
  }, { seed: 61 + variant * 3, alpha: true });
}

// Lily pad, 16 x 16, transparent: round leaf with a notch and a vein.
export function lilyTexture() {
  return pixelTexture('lily', 16, 16, (g, px, r, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
      if (d > 7.2) continue;
      if (dx > 0 && Math.abs(dy) < dx * 0.35) continue;      // notch
      const edge = d > 6.2;
      px(x, y, edge ? '#24391c' : (x + y) % 5 === 0 ? '#3f5f2c' : r() < 0.15 ? '#567a3a' : '#33502a');
    }
    for (let k = 0; k < 6; k++) px(7 - k, 7, '#4f7036');
  }, { seed: 3, alpha: true });
}

/** MeshStandardMaterial set up for a pixel texture (alpha-cut for cards). */
export function pixelMaterial(tex, { repeat = [1, 1], color = 0xffffff, side = THREE.FrontSide, roughness = 0.95, ...rest } = {}) {
  const t = repeat[0] === 1 && repeat[1] === 1 ? tex : tex.clone();
  if (t !== tex) { t.repeat.set(repeat[0], repeat[1]); t.needsUpdate = true; }
  return new THREE.MeshStandardMaterial({
    map: t, color, roughness, side,
    ...(tex.userData.alpha ? { alphaTest: 0.5, transparent: false } : {}),
    ...rest,
  });
}

// --- Creatures ------------------------------------------------------------------------------

// Shaggy fur, 16 x 32: dark roots, long brown strands running down, ginger tips catching light.
export function furTexture(variant = 0) {
  return pixelTexture(`fur${variant}`, 16, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#140e0a', '#21170f', '#2e2016', '#3c2a1c', '#4c3624', '#5e452e']   // darker (back, shoulders)
      : ['#1a120c', '#2a1d13', '#3a281a', '#4b3422', '#5f432c', '#7a5838'];
    g.fillStyle = pal[1]; g.fillRect(0, 0, w, h);
    for (let s = 0; s < 34; s++) {
      let x = Math.floor(r() * w);
      const y0 = Math.floor(r() * h), len = 4 + Math.floor(r() * 10), c = 2 + Math.floor(r() * 3);
      for (let k = 0; k < len; k++) {
        if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
        px(x, y0 + k, k === 0 ? pal[Math.min(5, c + 1)] : k > len - 3 ? pal[c - 1] : pal[c]);
      }
    }
    for (let i = 0; i < 12; i++) px(Math.floor(r() * w), Math.floor(r() * h), pal[0]);   // deep clumps
  }, { seed: 101 + variant });
}

// Leathery skin for face, palms and soles, 16 x 16: grey-brown with creases.
export function skinTexture() {
  return pixelTexture('skin', 16, 16, (g, px, r, w, h) => {
    const pal = ['#1f1814', '#2e2520', '#3c312a', '#4a3e35'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[1 + Math.floor(r() * 2.4)]);
    for (let i = 0; i < 6; i++) { const y = Math.floor(r() * h), x0 = Math.floor(r() * w); for (let k = 0; k < 4; k++) px(x0 + k, y, pal[0]); }
  }, { seed: 131 });
}

// Bigfoot's face, 16 x 16 (front of the head): heavy brow, deep-set eyes, flat nose, wide mouth.
export function bigfootFaceTexture() {
  return pixelTexture('bigfootFace', 16, 16, (g, px, r, w, h) => {
    const fur = ['#1a120c', '#2a1d13', '#3a281a', '#4b3422'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, fur[1 + Math.floor(r() * 3)]);
    // Bare face patch.
    for (let y = 4; y < 15; y++) for (let x = 3; x < 13; x++) {
      const edge = (y === 4 || y === 14 || x === 3 || x === 12);
      if (edge && r() < 0.5) continue;
      px(x, y, r() < 0.3 ? '#3c312a' : '#2e2520');
    }
    for (let x = 3; x < 13; x++) { px(x, 4, '#1c1410'); px(x, 5, '#120d0a'); }   // brow ridge shadow
    for (const ex of [5, 9]) { px(ex, 6, '#070505'); px(ex + 1, 6, '#070505'); px(ex + 1, 6, '#c9a14a'); } // eyes with glint
    px(7, 8, '#1a1410'); px(8, 8, '#1a1410'); px(7, 9, '#120d0a'); px(8, 9, '#120d0a');                // nostrils
    for (let x = 5; x < 11; x++) px(x, 11, '#100b08');                                                    // mouth
    px(5, 12, '#2a201a'); px(10, 12, '#2a201a');
  }, { seed: 141 });
}
