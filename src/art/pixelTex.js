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

// Hanging fur fringe card, 16 x 32 with alpha: matted strands of uneven length (shaggy silhouettes).
export function furFringeTexture(variant = 0) {
  return pixelTexture(`furFringe${variant}`, 16, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#110c0c', '#1c1310', '#2b1d15', '#3d2a1c', '#523823']
      : ['#1c1310', '#2b1d15', '#3d2a1c', '#523823', '#6c4a2d', '#8b613b'];
    for (let x = 0; x < w; x++) {
      if (r() < 0.15) continue;
      const len = 8 + Math.floor(r() * (h - 8));
      let cx = x;
      for (let y = 0; y < len; y++) {
        if (r() < 0.12) cx += r() < 0.5 ? -1 : 1;
        cx = Math.max(0, Math.min(w - 1, cx));
        const t = y / len;
        px(cx, y, pal[Math.max(0, Math.min(pal.length - 1, Math.floor((1 - t) * (pal.length - 1) + (r() - 0.5) * 1.5)))]);
      }
    }
  }, { seed: 151 + variant, alpha: true });
}

// Bigfoot's snarling face, 32 x 32 (hero density): heavy brow in deep shadow, sunken glinting
// eyes, flat wide nose, curled lip baring yellowed teeth and long canines, scar across the cheek.
export function bigfootSnarlTexture() {
  return pixelTexture('bigfootSnarl', 32, 32, (g, px, r, w, h) => {
    const fur = ['#110c0c', '#1c1310', '#2b1d15', '#3d2a1c'];
    const skin = ['#120e0f', '#1f1819', '#2e2523', '#3d322d', '#4e4038'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, fur[1 + Math.floor(r() * 3)]);
    // Bare face: an inverted shield shape.
    for (let y = 7; y < 31; y++) {
      const half = y < 20 ? 11 : 11 - (y - 20) * 0.6;
      for (let x = Math.round(16 - half); x < Math.round(16 + half); x++) px(x, y, skin[2 + (r() < 0.35 ? 1 : 0) - (r() < 0.2 ? 1 : 0)]);
    }
    // Brow ridge: a thick dark shelf with lit top edge.
    for (let x = 4; x < 28; x++) { px(x, 8, skin[4]); px(x, 9, skin[1]); px(x, 10, skin[0]); px(x, 11, skin[0]); }
    // Sunken eyes: black pits with a bright amber eyeshine pixel.
    for (const ex of [9, 20]) {
      for (let dx = 0; dx < 4; dx++) { px(ex + dx, 12, skin[0]); px(ex + dx, 13, skin[0]); }
      px(ex + 1, 12, '#ffb347'); px(ex + 2, 12, '#ffd27a'); px(ex + 1, 13, '#c96b1e');
    }
    // Wrinkled nose bridge and wide flat nostrils.
    for (let y = 14; y < 19; y++) { px(15, y, skin[3]); px(16, y, skin[2]); }
    for (const nx of [12, 18]) { px(nx, 19, skin[0]); px(nx + 1, 19, skin[0]); px(nx, 18, skin[1]); }
    for (let x = 11; x < 21; x++) px(x, 20, skin[1]);
    // Snarl: dark open mouth, upper teeth, long canines.
    for (let y = 23; y < 28; y++) for (let x = 9; x < 23; x++) px(x, y, '#0b0708');
    for (let x = 9; x < 23; x++) { px(x, 22, skin[0]); px(x, 28, skin[1]); }
    const tooth = ['#c9b98a', '#a89466', '#7d6c48'];
    for (let x = 10; x < 22; x++) px(x, 23, tooth[x % 2]);
    for (const cx of [10, 20]) { px(cx, 24, tooth[0]); px(cx, 25, tooth[1]); px(cx + 1, 24, tooth[1]); px(cx, 26, tooth[2]); }   // upper fangs
    for (const cx of [12, 18]) { px(cx, 27, tooth[1]); px(cx, 26, tooth[0]); }                                                  // lower fangs
    // Old scar across the left cheek.
    for (let k = 0; k < 6; k++) px(6 + k, 15 + k, '#5a3a32');
  }, { seed: 161 });
}

// Bigfoot's scowl (#56), 32 x 32: bare tan face like an old silverback's, a deeply furrowed
// V-shaped brow pressing down on sunken burning-amber eyes, broad flat nose, heavy downturned
// mouth showing the tips of yellowed fangs, hair framing the face. Hero density.
export function bigfootScowlTexture() {
  return pixelTexture('bigfootScowl', 32, 32, (g, px, r, w, h) => {
    const fur = ['#140d09', '#22160e', '#342215', '#4a321e', '#634428'];
    const sk = ['#1c1210', '#3a2820', '#5a4030', '#74543e', '#8c6a4e', '#a3805f'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, fur[1 + Math.floor(r() * 3)]);
    // Bare face: broad at the cheekbones, narrowing to the chin.
    for (let y = 5; y < 30; y++) {
      const half = y < 18 ? 12 : 12 - (y - 18) * 0.55;
      for (let x = Math.round(16 - half); x < Math.round(16 + half); x++) {
        const shade = y < 9 ? 3 : y > 24 ? 2 : 3 + (r() < 0.25 ? 1 : 0) - (r() < 0.15 ? 1 : 0);
        px(x, y, sk[Math.max(1, Math.min(5, shade))]);
      }
    }
    // Forehead furrows: stacked V-shaped creases pointing down to the nose bridge.
    for (const [yy, sh] of [[6, 2], [8, 1], [10, 0]]) for (let k = 0; k < 9; k++) {
      px(7 + k, yy + Math.floor(k / 3), sk[sh]); px(24 - k, yy + Math.floor(k / 3), sk[sh]);
    }
    // Heavy brow ridge, lit on top, pressing down at the centre (the scowl).
    for (let x = 5; x < 27; x++) {
      const dip = Math.max(0, 3 - Math.abs(x - 15.5) / 2.5) | 0;
      px(x, 11 + dip - 1, sk[5]); px(x, 12 + dip, sk[0]); px(x, 13 + dip, sk[1]);
    }
    // Sunken sockets with burning amber eyes (bright core, darker rim).
    for (const ex of [8, 19]) {
      for (let dx = 0; dx < 5; dx++) for (let dy = 0; dy < 3; dy++) px(ex + dx, 14 + dy, sk[0]);
      px(ex + 1, 15, '#c96b1e'); px(ex + 2, 15, '#ffd27a'); px(ex + 3, 15, '#ffb347'); px(ex + 2, 14, '#9a4a14');
    }
    // Nose: wide flat bridge, flared nostrils.
    for (let y = 17; y < 22; y++) { px(15, y, sk[4]); px(16, y, sk[3]); }
    for (const nx of [12, 18]) { px(nx, 21, sk[0]); px(nx + 1, 21, sk[0]); px(nx, 20, sk[1]); px(nx + 1, 22, sk[2]); }
    for (let x = 13; x < 19; x++) px(x, 22, sk[1]);
    // Snout folds down to a heavy, downturned mouth; fang tips just showing.
    for (let k = 0; k < 4; k++) { px(9 + k, 20 + k, sk[1]); px(22 - k, 20 + k, sk[1]); }
    for (let x = 10; x < 22; x++) px(x, 25 + (x < 12 || x > 19 ? 1 : 0), '#0b0708');
    px(12, 26, '#c9b98a'); px(12, 27, '#a89466'); px(12, 28, '#7d6c48');   // long left fang
    px(19, 26, '#7d6c48');                                                     // right fang snapped off
    for (let x = 11; x < 21; x++) px(x, 27, sk[1]);
    // Beard and cheek hair creeping onto the face edges.
    for (let y = 18; y < 32; y++) for (const x of [5, 6, 25, 26]) if (r() < 0.7) px(x, y, fur[2 + Math.floor(r() * 2)]);
    for (let y = 28; y < 32; y++) for (let x = 9; x < 23; x++) if (r() < 0.6) px(x, y, fur[1 + Math.floor(r() * 3)]);
    // Old scars across the left brow and cheek.
    for (let k = 0; k < 7; k++) px(6 + k, 9 + k, '#5a3a32');
    for (let k = 0; k < 4; k++) px(22 + k, 18 + k, '#5a3a32');
    for (let k = 0; k < 5; k++) px(13 + k, 19 - (k >> 1), '#6a463c');                          // scar across the nose
  }, { seed: 171 });
}

// Long flowing hair card, 16 x 48 with alpha: the mane that pours off the crown and shoulders,
// dark roots to warm ochre lit tips, ragged ends.
export function longHairTexture() {
  return pixelTexture('longHair', 16, 48, (g, px, r, w, h) => {
    const pal = ['#140d09', '#22160e', '#342215', '#4a321e', '#634428', '#80592f', '#9c7040'];
    for (let x = 0; x < w; x++) {
      if (r() < 0.08) continue;
      const len = 24 + Math.floor(r() * (h - 24));
      let cx = x;
      for (let y = 0; y < len; y++) {
        if (r() < 0.08) cx += r() < 0.5 ? -1 : 1;
        cx = Math.max(0, Math.min(w - 1, cx));
        const t = y / len;
        const lit = (x % 5 === 0) ? 1 : 0;          // a few highlight strands
        px(cx, y, pal[Math.max(0, Math.min(pal.length - 1, Math.round(1 + t * 3 + lit * 2 + (r() - 0.5))))]);
      }
    }
  }, { seed: 181, alpha: true });
}

// Bare, scarred patch where the fur has worn thin (#56): grey-brown hide with rib bands showing
// through and three parallel claw scars, ragged fur edges. 32 x 32, alpha-cut edges.
export function ribScarTexture() {
  return pixelTexture('ribScar', 32, 32, (g, px, r, w, h) => {
    const sk = ['#1c1210', '#2e2019', '#3e2d24', '#4f3b2f', '#614a3b'];
    const fur = ['#140d09', '#22160e', '#342215'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - 15.5) / 15, dy = (y - 15.5) / 15, d = Math.sqrt(dx * dx + dy * dy) + (r() - 0.5) * 0.25;
      if (d > 1) continue;                                                // transparent outside the patch
      if (d > 0.82) { px(x, y, fur[Math.floor(r() * 3)]); continue; }      // ragged fur rim
      px(x, y, sk[2 + (r() < 0.3 ? 1 : 0) - (r() < 0.2 ? 1 : 0)]);
    }
    // Ribs: curved bands, lit above, shadowed below.
    for (let k = 0; k < 4; k++) for (let x = 4; x < 28; x++) {
      const y = 6 + k * 6 + Math.round(Math.sin((x / 32) * Math.PI) * -2);
      px(x, y, sk[4]); px(x, y + 1, sk[3]); px(x, y + 2, sk[0]);
    }
    // Three claw scars raked diagonally across, pale and raised.
    for (let s = 0; s < 3; s++) for (let k = 0; k < 18; k++) { px(9 + s * 4 + Math.floor(k / 2), 5 + k, '#7a5a4a'); px(10 + s * 4 + Math.floor(k / 2), 5 + k, '#4a2e26'); }
  }, { seed: 191, alpha: true });
}

// --- First-person gear (#44) ------------------------------------------------------------------

// Worn leather work glove, 16 x 16: dark olive-brown hide, creases, pale stitching, scuffed knuckles.
export function gloveTexture() {
  return pixelTexture('glove', 16, 16, (g, px, r, w, h) => {
    const pal = ['#1a1612', '#2a241c', '#3a3226', '#4a4030', '#5c503c'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[2 + (r() < 0.3 ? 1 : 0) - (r() < 0.25 ? 1 : 0)]);
    for (let x = 0; x < w; x++) if (x % 3 === 0) px(x, 3, '#8a7a5a');                 // stitch line
    for (let k = 0; k < 5; k++) { const y = 6 + Math.floor(r() * 9), x = Math.floor(r() * 13); px(x, y, pal[0]); px(x + 1, y, pal[0]); px(x + 2, y, pal[1]); } // creases
    for (let k = 0; k < 4; k++) px(Math.floor(r() * w), Math.floor(r() * 4), pal[4]);   // scuffs
  }, { seed: 211 });
}

// Field-jacket sleeve, 16 x 16: waxed olive canvas, a darker cuff band, a frayed thread.
export function sleeveTexture() {
  return pixelTexture('sleeve', 16, 16, (g, px, r, w, h) => {
    const pal = ['#1b2116', '#262e1d', '#323c25', '#3f4a2e', '#4e5a38'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[(x + y) % 4 === 0 ? 3 : 2 + (r() < 0.2 ? 1 : 0) - (r() < 0.2 ? 1 : 0)]);
    for (let x = 0; x < w; x++) { px(x, 12, pal[0]); px(x, 13, pal[1]); px(x, 14, pal[1]); px(x, 15, pal[0]); }   // cuff
    px(5, 15, '#6a6040'); px(5, 14, '#6a6040');
  }, { seed: 212 });
}

// Worn black anodised metal with scratches and bare aluminium on the edges, 16 x 16.
export function metalTexture() {
  return pixelTexture('metal', 16, 16, (g, px, r, w, h) => {
    const pal = ['#0e0f12', '#17191d', '#202328', '#2c3036'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[1 + (r() < 0.25 ? 1 : 0)]);
    for (let k = 0; k < 6; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); for (let j = 0; j < 3; j++) px(x + j, y + (j >> 1), '#5a5e64'); }  // scratches
    for (let x = 0; x < w; x++) { px(x, 0, pal[3]); if (r() < 0.3) px(x, 0, '#7a7e84'); }   // worn edge
  }, { seed: 213 });
}

// Knurled rubber grip, 8 x 8: diamond pattern.
export function gripTexture() {
  return pixelTexture('grip', 8, 8, (g, px) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, (x + y) % 4 === 0 || (x - y + 8) % 4 === 0 ? '#0c0d0f' : '#1c1e22');
  }, { seed: 214 });
}

// Olive drab plastic housing (trail camera, goggles), 16 x 16: moulded texture, mud splash.
export function oliveCaseTexture() {
  return pixelTexture('oliveCase', 16, 16, (g, px, r, w, h) => {
    const pal = ['#22281a', '#2e3622', '#3a442a', '#475234'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[1 + (r() < 0.35 ? 1 : 0)]);
    for (let x = 0; x < w; x++) px(x, 0, pal[3]);
    for (let k = 0; k < 6; k++) px(Math.floor(r() * w), 10 + Math.floor(r() * 6), r() < 0.5 ? '#3a2e22' : '#4a3a28');   // dried mud
  }, { seed: 215 });
}

// --- First-person gear v2 (#57): calmer, low-contrast materials that let the sculpt read ------

// Glove leather, 32 x 32: soft oiled hide, gentle grain, a few scuffs. Narrow value range on purpose.
export function gloveLeatherTexture() {
  return pixelTexture('glove2', 32, 32, (g, px, r, w, h) => {
    const pal = ['#2e251c', '#352b21', '#3c3126', '#43372b'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[1 + ((x * 7 + y * 13 + Math.floor(r() * 3)) % 5 === 0 ? 1 : 0) - (r() < 0.12 ? 1 : 0)]);
    for (let k = 0; k < 5; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, '#56473a'); px(x + 1, y, pal[3]); }   // scuffs catching light
    for (let x = 0; x < w; x += 2) px(x, 20, '#5e4e3a');                                                         // one stitched seam
  }, { seed: 221 });
}
// Waxed canvas, 32 x 32: fine twill weave in olive, no stripes.
export function canvasTexture() {
  return pixelTexture('canvas2', 32, 32, (g, px, r, w, h) => {
    const pal = ['#2c3522', '#323c27', '#38432b', '#3e4a30'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[((x + y) % 3 === 0 ? 2 : 1) + (r() < 0.08 ? 1 : 0) - (r() < 0.08 ? 1 : 0)]);
    for (let k = 0; k < 3; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, '#4a5636'); px(x + 1, y + 1, '#4a5636'); }   // waxy sheen
  }, { seed: 222 });
}
// Anodised metal, 32 x 32: near-flat dark finish, two thin scratches.
export function anodizedTexture() {
  return pixelTexture('anodized', 32, 32, (g, px, r, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, r() < 0.1 ? '#22252a' : '#1c1f23');
    for (let k = 0; k < 2; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); for (let j = 0; j < 5; j++) px(x + j, y + (j >> 1), '#3d434b'); }
  }, { seed: 223 });
}
// Pebbled leatherette (camera body), 16 x 16.
export function leatheretteTexture() {
  return pixelTexture('leatherette', 16, 16, (g, px, r, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, '#141518');
    for (let k = 0; k < 40; k++) px(Math.floor(r() * w), Math.floor(r() * h), r() < 0.6 ? '#1c1d21' : '#0e0f11');
  }, { seed: 224 });
}

// --- Bigfoot, rebuilt (#58) -------------------------------------------------------------------

// Long shaggy fur, 32 x 64 (tiles ~0.4 m x 0.85 m on the body). Hard pixel clumps running down:
// each clump is a 3-6 px lock with a lit ridge, a mid body and a dark gap to the next lock, broken
// every so often where the strands end (a dark notch, lighter tips below). A few grizzled hairs,
// and debris caught in the coat: pine needles, a twig, a dead leaf, burrs.
const BF_FUR = ['#100a07', '#1d130c', '#2b1c11', '#3c2817', '#50361e', '#664627', '#7e5833', '#966c40'];
const BF_FUR_DARK = ['#0b0705', '#150e09', '#20150d', '#2d1e12', '#3d2918', '#4f3720', '#634629', '#785633'];
function drawBigfootFur(px, r, w, h, pal, debris = true) {
  // Lay out clumps across the tile (wrapping), each with its own tone and strand breaks.
  const clumps = [];
  for (let x = 0; x < w;) { const cw = 3 + Math.floor(r() * 4); clumps.push({ x, cw, tone: 3 + Math.floor(r() * 3), ph: r() * 6.28, breaks: [Math.floor(r() * h), Math.floor(r() * h)] }); x += cw; }
  const last = clumps[clumps.length - 1]; last.cw += w - (last.x + last.cw);   // close the wrap exactly
  for (const c of clumps) {
    for (let y = 0; y < h; y++) {
      const sway = Math.round(Math.sin((y / h) * Math.PI * 2 * 2 + c.ph) * 1.1);   // period divides h: tiles
      // Tone drifts down the lock; just below a break the tips are lighter, above it a dark notch.
      let tone = c.tone + Math.round(Math.sin((y / h) * Math.PI * 2 + c.ph) * 0.8);
      for (const bk of c.breaks) { const dy = (y - bk + h) % h; if (dy < 2) tone = 1; else if (dy < 6) tone += 1; }
      for (let j = 0; j < c.cw; j++) {
        let t = tone;
        if (j === c.cw - 1) t = Math.min(t, 2) - 1;            // dark gap between locks
        else if (j === 1) t += 1;                              // lit ridge
        else if (j === c.cw - 2 && c.cw > 3) t -= 1;           // shadow side
        px(c.x + j + sway, y, pal[Math.max(0, Math.min(pal.length - 1, t))]);
      }
    }
  }
  // Loose single strands across the clumps.
  for (let k = 0; k < 26; k++) {
    const x = Math.floor(r() * w), y = Math.floor(r() * h), len = 5 + Math.floor(r() * 10), t = r() < 0.5 ? pal.length - 1 : 1;
    for (let j = 0; j < len; j++) px(x + Math.round(Math.sin(j * 0.5) * 0.6), y + j, pal[t]);
  }
  for (let k = 0; k < 7; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); for (let j = 0; j < 7; j++) px(x, y + j, j % 3 ? '#9b8c72' : '#7c6e58'); }   // grizzle
  if (!debris) return;
  // Debris caught in the coat.
  for (let k = 0; k < 3; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); for (let j = 0; j < 4; j++) px(x + j, y + (j >> 1), j ? '#6f6a2c' : '#4f4c20'); }   // pine needles
  { const x = Math.floor(r() * w), y = Math.floor(r() * h); for (let j = 0; j < 6; j++) { px(x + j, y + j, '#5e4a30'); px(x + j + 1, y + j, '#2a2016'); } }       // twig
  { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, '#8a5a24'); px(x + 1, y, '#a06c2c'); px(x, y + 1, '#6e4418'); px(x + 1, y + 1, '#8a5a24'); px(x + 2, y + 1, '#5a3814'); }   // dead leaf
  for (let k = 0; k < 2; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, '#3e3a1c'); px(x + 1, y + 1, '#3e3a1c'); px(x + 1, y, '#5c5528'); }   // burrs
}
export function bigfootFur2Texture(variant = 0) {
  return pixelTexture(`bfFur3-${variant}`, 32, 64, (g, px, r, w, h) => drawBigfootFur(px, r, w, h, variant === 1 ? BF_FUR_DARK : BF_FUR, variant !== 1), { seed: 301 + variant });
}

// Chest, 64 x 48 (projected once across the chest): the same fur, raked by three old claw scars
// running diagonally down across the pecs - bare scar tissue with the fur parted dark beside it.
export function bigfootChestTexture() {
  return pixelTexture('bfChest', 64, 48, (g, px, r, w, h) => {
    drawBigfootFur(px, r, w, h, BF_FUR, false);
    for (let s = 0; s < 3; s++) {
      for (let k = 0; k < 26; k++) {
        const x = 36 + s * 5 - Math.round(k * 0.8), y = 6 + k + s * 2;
        px(x - 1, y, BF_FUR[0]); px(x + 2, y, BF_FUR[0]);
        px(x, y, k % 5 === 0 ? '#5a3328' : '#8c5a48'); px(x + 1, y, '#6e4234');
      }
    }
  }, { seed: 321 });
}

// Bare ribs, 32 x 32 (one torn patch on the left flank): the coat ripped away over the ribcage,
// grey-tan hide stretched over four rib ridges, a ragged fur edge all round.
export function bigfootRibsTexture() {
  return pixelTexture('bfRibs', 32, 32, (g, px, r, w, h) => {
    drawBigfootFur(px, r, w, h, BF_FUR, false);
    const sk = ['#2a1d17', '#45322a', '#5e463a', '#76594a', '#8a6b58'];
    for (let y = 5; y < 28; y++) {
      const half = 11 - Math.abs(y - 16) * 0.45 + (r() < 0.4 ? 1 : 0);
      for (let x = Math.round(16 - half); x < Math.round(16 + half); x++) {
        const rib = (y - 6) % 5;                              // ridge, lit top, shadowed gap
        px(x, y, sk[rib === 0 ? 4 : rib === 1 ? 3 : rib === 4 ? 0 : 2]);
      }
      px(Math.round(16 - half) - 1, y, BF_FUR[0]); px(Math.round(16 + half), y, BF_FUR[0]);
    }
  }, { seed: 331 });
}

// Bigfoot face, 64 x 64 (hero): old-silverback scowl after the director's reference. Bare tan
// face under a hair hood, deeply furrowed V brow over shadowed sockets (the glowing eyes are lit
// separately), broad flat nose, long upper lip, heavy downturned mouth, a beard below.
export function bigfootFace2Texture() {
  return pixelTexture('bfFace2', 64, 64, (g, px, r, w, h) => {
    const sk = ['#24160f', '#3e2a1f', '#5a3f2f', '#70503c', '#86624a', '#9a7458', '#ae8868', '#c09a78'];
    const fur = ['#140d09', '#22160e', '#331f13', '#462c1a', '#5c3c22'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, fur[1 + Math.floor(r() * 3)]);
    // Face mask: broad at the cheekbones, a long muzzle, narrowing to the chin.
    for (let y = 8; y < 58; y++) {
      const t = (y - 8) / 50;
      const half = 26 - Math.max(0, t - 0.55) * 30 - Math.max(0, 0.12 - t) * 60;
      for (let x = Math.round(32 - half); x < Math.round(32 + half); x++) {
        const dx = Math.abs(x - 32) / half;
        let s = 5 - Math.round(dx * 2.2) - (y > 44 ? 1 : 0);            // cheeks roll into shadow
        if (r() < 0.12) s += r() < 0.5 ? 1 : -1;
        px(x, y, sk[Math.max(1, Math.min(7, s))]);
      }
    }
    // Brow: heavy shelf, pressing down to a V at the centre; stacked furrows above it.
    for (let x = 8; x < 56; x++) {
      const dip = Math.round(Math.max(0, 7 - Math.abs(x - 31.5) / 3.2));
      const y = 20 + dip;
      px(x, y - 1, sk[7]); px(x, y, sk[6]); px(x, y + 1, sk[1]); px(x, y + 2, sk[0]); px(x, y + 3, sk[1]);
      if (x % 3 !== 0) { px(x, y - 4, sk[3]); px(x, y - 7, sk[3]); }              // forehead furrows
    }
    for (let k = 0; k < 6; k++) { px(30, 12 + k, sk[2]); px(33, 12 + k, sk[2]); }  // vertical scowl lines
    // Sockets (deep shadow; the glowing eyes sit inside them on the model).
    for (const ex of [18, 39]) for (let dx = 0; dx < 8; dx++) for (let dy = 0; dy < 5; dy++) {
      if ((dx === 0 || dx === 7) && (dy === 0 || dy === 4)) continue;
      px(ex + dx, 26 + dy, dy < 2 ? sk[0] : sk[1]);
    }
    for (const ex of [18, 39]) for (let dx = 1; dx < 7; dx++) px(ex + dx, 31, sk[3]);   // lower lid / bag
    // Nose: broad flat bridge, flared nostrils.
    for (let y = 30; y < 41; y++) { px(30, y, sk[6]); px(31, y, sk[7]); px(32, y, sk[6]); px(33, y, sk[5]); }
    for (const nx of [25, 35]) { for (let k = 0; k < 4; k++) px(nx + k, 41, sk[0]); px(nx + 1, 40, sk[1]); px(nx + 2, 40, sk[1]); }
    for (let x = 24; x < 40; x++) px(x, 42, sk[2]);
    // Muzzle folds and the long upper lip down to a heavy downturned mouth.
    for (let k = 0; k < 8; k++) { px(20 + k, 38 + k, sk[2]); px(43 - k, 38 + k, sk[2]); }
    for (let x = 22; x < 42; x++) { const sag = Math.round(Math.abs(x - 31.5) / 4); px(x, 49 + sag, sk[0]); px(x, 50 + sag, sk[2]); }
    // Scars: an old one through the left brow, a claw rake across the right cheek.
    for (let k = 0; k < 10; k++) px(12 + k, 14 + k, '#6a4436');
    for (let s = 0; s < 3; s++) for (let k = 0; k < 7; k++) px(44 + s * 2 + Math.floor(k / 3), 34 + k, '#6a4436');
    for (let k = 0; k < 6; k++) { px(28 + k, 33 + (k >> 1), '#5e3226'); px(28 + k, 34 + (k >> 1), '#c49a80'); }   // nose scar
    // Beard creeping up the chin and jaw, sideburns down the cheeks.
    for (let y = 46; y < 64; y++) for (let x = 0; x < w; x++) {
      const inBeard = y > 53 || Math.abs(x - 32) > 20 - (y - 46) * 0.3;
      if (inBeard && r() < 0.8) px(x, y, fur[1 + Math.floor(r() * 4)]);
    }
  }, { seed: 311 });
}

// --- Chupacabra (#93) ------------------------------------------------------------------------
// Hairless, leathery hide, 32 x 32: grey-green with darker olive mottling, pebbled scale dots
// and a few pale old scars. variant 1 is the paler, pinker underbelly with visible rib creases.
const CHUPA_HIDE = ['#141611', '#1f231a', '#2b3024', '#373d2e', '#454b38', '#566048', '#6b7558'];
const CHUPA_BELLY = ['#2a1f1c', '#3d2e29', '#523e36', '#665044', '#7a6252', '#8e7462'];
export function chupaHideTexture(variant = 0) {
  return pixelTexture(`chupaHide${variant}`, 32, 32, (g, px, r, w, h) => {
    const pal = variant === 1 ? CHUPA_BELLY : CHUPA_HIDE;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[2 + Math.floor(r() * 1.6)]);
    for (let b = 0; b < 9; b++) {                               // dark mottled blotches
      const cx = r() * w, cy = r() * h, rr = 2 + r() * 3;
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y < rr * rr * (0.7 + r() * 0.5)) px(Math.round(cx + x), Math.round(cy + y), pal[1]);
    }
    for (let i = 0; i < 70; i++) {                              // pebbled scales: lit top, dark under
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      px(x, y, pal[4]); px(x, y + 1, pal[0]);
    }
    if (variant === 1) for (let y = 3; y < h; y += 6) for (let x = 0; x < w; x++) if (r() < 0.8) px(x, y, pal[0]);   // rib creases
    for (let s = 0; s < 2; s++) {                               // old scars
      let x = Math.floor(r() * w), y = Math.floor(r() * h);
      for (let k = 0; k < 7; k++) { px(x, y, pal[5]); x++; if (r() < 0.5) y++; }
    }
  }, { seed: 931 + variant });
}
// Head, 32 x 32: darker hide, deep sockets and a lip line of bare pink gum. Projected per facet.
export function chupaHeadTexture() {
  return pixelTexture('chupaHead', 32, 32, (g, px, r, w, h) => {
    const pal = CHUPA_HIDE;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[1 + Math.floor(r() * 2)]);
    for (let i = 0; i < 40; i++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, pal[3]); px(x, y + 1, pal[0]); }
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x++) if (r() < 0.35) px(x, y, pal[0]);   // wrinkled brow folds
  }, { seed: 951 });
}
// Spines and claws, 8 x 16: bone-pale at the base going to dried-blood red-black at the tip.
export function chupaSpineTexture() {
  return pixelTexture('chupaSpine', 8, 16, (g, px, r, w, h) => {
    const pal = ['#c8b894', '#a89070', '#8a5a44', '#6a2a22', '#3a1210', '#1c0a08'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[Math.min(5, Math.floor((y / h) * 6 + r() * 0.8))]);
  }, { seed: 961 });
}
