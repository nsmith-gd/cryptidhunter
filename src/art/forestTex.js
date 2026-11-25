import { pixelTexture } from './pixelTex.js';

// Pixel-art textures for the Pine Hollow forest kit (trees, ferns, bushes, logs, rocks, ground
// cover). Same approach as pixelTex.js: tiny canvases, small hue-shifted palettes (shadows lean
// blue-green, lights lean warm yellow-green), dark outlines, deliberate wear. Nearest sampled.

const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// --- Pine ------------------------------------------------------------------------------------

// Ponderosa/Douglas-fir style bark, 16 x 32: deep dark fissures around warm red-brown plates,
// grey weathered plate edges, a few lichen flecks.
export function pineBarkTexture(variant = 0) {
  return pixelTexture(`pineBark${variant}`, 16, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#120f0e', '#221c19', '#352c27', '#4a3f37', '#5f5349', '#77695c']      // old grey (snags, logs)
      : ['#140d0b', '#28181b', '#3d241a', '#56331f', '#6e4428', '#8a5a36'];      // living, red-brown
    g.fillStyle = pal[0]; g.fillRect(0, 0, w, h);
    // Plates: irregular rounded rectangles stacked in staggered columns.
    for (let col = 0; col < 4; col++) {
      let y = Math.floor(r() * 6) - 6;
      while (y < h + 6) {
        const pw = 3 + Math.floor(r() * 2), ph = 4 + Math.floor(r() * 5), x0 = col * 4 + Math.floor(r() * 2) - 1;
        for (let yy = 1; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) {
          const edge = xx === 0 || xx === pw - 1 || yy === 1 || yy === ph - 1;
          if (edge && (yy === 1 || yy === ph - 1) && (xx === 0 || xx === pw - 1)) continue; // rounded corners
          let c = 3;
          if (yy === 1) c = 4;                         // lit top lip of each plate
          else if (xx === pw - 1 || yy === ph - 1) c = 2; // shaded side and bottom
          if (!edge && r() < 0.18) c = r() < 0.5 ? 4 : 2;
          if (yy === 1 && r() < 0.3) c = 5;            // sun-bleached flake
          px(x0 + xx, y + yy, pal[c]);
        }
        y += ph;
      }
    }
    // A few dark resin streaks and lichen.
    for (let i = 0; i < 3; i++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); for (let k = 0; k < 3; k++) px(x, y + k, pal[1]); }
    for (let i = 0; i < 6; i++) px(Math.floor(r() * w), Math.floor(r() * h), r() < 0.6 ? '#56634a' : '#7d8a63');
  }, { seed: 201 + variant });
}

// Needle mass wrapped on each tier of the crown, 32 x 32 (tiles). Layered sprays: each spray is a
// lit upper edge of needle ticks over a deep blue-green shadow, so the tier reads as branches.
export function pineNeedleTexture(variant = 0) {
  return pixelTexture(`pineNeedles${variant}`, 32, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#0a1412', '#10201b', '#173025', '#20402c', '#2d5534', '#3f6c3b', '#5a8446']   // fir: bluer, deeper
      : ['#0b1310', '#121f17', '#1b2f1d', '#253f24', '#33532b', '#466a34', '#61833f'];  // pine: warmer
    g.fillStyle = pal[1]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      // One spray: a short drooping branch running down-right or down-left.
      const x0 = Math.floor(r() * w), y0 = Math.floor(r() * h), dir = r() < 0.5 ? 1 : -1, len = 5 + Math.floor(r() * 6);
      const tone = 3 + Math.floor(r() * 2);
      for (let k = 0; k < len; k++) {
        const x = x0 + dir * k, y = y0 + Math.floor(k * 0.45);
        px(x, y + 1, pal[0]);                           // shadow under the spray
        px(x, y, pal[tone]);
        if (k % 2 === 0) { px(x, y - 1, pal[tone + 1]); if (r() < 0.45) px(x - dir, y - 2, pal[Math.min(6, tone + 2)]); } // needle tips catch light
      }
    }
    // Darkest gaps between branches.
    for (let i = 0; i < 18; i++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, pal[0]); px(x + 1, y, pal[0]); }
  }, { seed: 211 + variant * 5 });
}

// Branch-tip card that hangs off each tier's rim so the crown silhouette is ragged, 32 x 16, alpha.
export function pineBranchCard(variant = 0) {
  return pixelTexture(`pineBranch${variant}`, 32, 16, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#0d1a16', '#173025', '#22432f', '#2f5837', '#456f43']
      : ['#0e1812', '#1b2f1d', '#28442a', '#385a30', '#4f733a'];
    // Main twig from left (attached to the tree) drooping to the right.
    const twig = [];
    for (let x = 0; x < w - 1; x++) twig.push(Math.round(3 + (x / w) * (x / w) * 7));
    for (let x = 0; x < w - 1; x++) {
      const y = twig[x];
      // Needles: ticks above (lit) and below (shade), thinning toward the tip.
      const dens = 1 - x / w * 0.6;
      for (let k = 1; k <= 3; k++) {
        if (r() < dens) px(x, y - k, pal[k === 3 ? 4 : 3]);
        if (r() < dens) px(x, y + k, pal[k === 1 ? 1 : 2]);
      }
      px(x, y, pal[0]);
      // Side sprigs every few pixels.
      if (x % 5 === 2 && x < w - 5) {
        for (let k = 1; k < 5; k++) { px(x + k, y + k, pal[2]); if (r() < 0.6) px(x + k, y + k - 1, pal[3]); if (r() < 0.5) px(x + k + 1, y + k + 1, pal[1]); }
      }
    }
  }, { seed: 221 + variant, alpha: true });
}

// --- Undergrowth ----------------------------------------------------------------------------

// Sword fern frond, 16 x 32, alpha: midrib up the centre, alternating leaflets angled toward the
// tip, lit on their upper edge; the frond tapers to a point at the top (v = 1).
export function fernFrondTexture(variant = 0) {
  return pixelTexture(`fern${variant}`, 16, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#1d2a14', '#2f4119', '#45591f', '#5e7226', '#7a8a32']    // late season, yellower
      : ['#10200f', '#1b3417', '#284a1e', '#386226', '#4e7c31'];
    const cx = 7;
    for (let y = 1; y < h; y++) {
      const t = 1 - y / h;                         // 1 at the base (bottom), 0 at the tip (top)
      const len = Math.max(1, Math.round(1 + 6 * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.1)) * (0.35 + 0.65 * t)));
      if (y % 2 === 0) {
        for (const s of [-1, 1]) {
          for (let k = 1; k <= len; k++) {
            const yy = y - Math.floor(k / 2.5);   // leaflets sweep up toward the tip
            px(cx + s * k, yy, k === len ? pal[2] : pal[3]);
            px(cx + s * k, yy + 1, pal[1]);
            if (k < len - 1 && r() < 0.35) px(cx + s * k, yy - 1, pal[4]);
          }
        }
      }
      px(cx, y, pal[0]); px(cx + 1, y, y > h * 0.7 ? pal[1] : pal[0]); // midrib (stem shows at the base)
    }
    // A couple of browned leaflet tips.
    for (let i = 0; i < 3; i++) px(Math.floor(r() * w), 6 + Math.floor(r() * (h - 8)), r() < 0.5 ? '#6b4a22' : '#86602c');
  }, { seed: 231 + variant, alpha: true });
}

// Salal / huckleberry leaves on bush blobs, 32 x 32 (tiles): overlapping oval leaves with a lit
// top, dark gaps, and berries in some variants.
export function bushLeafTexture(variant = 0) {
  return pixelTexture(`bushLeaf${variant}`, 32, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#140f0b', '#2a2416', '#42381c', '#5c4b22', '#7a6128', '#9b7a32']   // autumn huckleberry
      : ['#0a140f', '#13261a', '#1d3a22', '#2a5029', '#3b6932', '#55843c'];
    g.fillStyle = pal[0]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), c = 2 + Math.floor(r() * 3);
      // 3x2 leaf with a highlight on top and shadow under.
      px(x, y, pal[c + 1]); px(x + 1, y, pal[Math.min(5, c + 1)]); px(x + 2, y + 1, pal[c]);
      px(x, y + 1, pal[c]); px(x + 1, y + 1, pal[c]); px(x + 1, y + 2, pal[c - 1]); px(x + 2, y + 2, pal[1]);
    }
    if (variant !== 1) for (let i = 0; i < 6; i++) {   // dark blue huckleberries
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      px(x, y, '#2b2c55'); px(x + 1, y, '#1b1b38'); if (r() < 0.6) px(x, y - 1, '#5a5c94');
    }
  }, { seed: 241 + variant });
}

// Loose leaf sprig card for bush edges, 16 x 16, alpha.
export function bushSprigCard(variant = 0) {
  return pixelTexture(`bushSprig${variant}`, 16, 16, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#2a2416', '#5c4b22', '#7a6128', '#9b7a32']
      : ['#13261a', '#2a5029', '#3b6932', '#55843c'];
    for (let y = h - 1; y > 2; y--) px(7 + Math.round((h - y) * 0.15), y, pal[0]);   // stem
    for (let i = 0; i < 9; i++) {
      const y = 2 + Math.floor(r() * (h - 5)), side = r() < 0.5 ? -1 : 1, x = 7 + side * (1 + Math.floor(r() * 4));
      px(x, y, pal[3]); px(x + side, y, pal[2]); px(x, y + 1, pal[1]); px(x + side, y + 1, pal[1]); px(x + side * 2, y + 1, pal[0]);
    }
  }, { seed: 251 + variant, alpha: true });
}

// Grass / sedge tuft card, 16 x 16, alpha: thin blades, some dry and pale.
export function grassTuftCard(variant = 0) {
  return pixelTexture(`grassTuft${variant}`, 16, 16, (g, px, r, w, h) => {
    const green = ['#1a2c16', '#2a4120', '#3b5628', '#557035'];
    const dry = ['#4a4224', '#665a30', '#857640', '#a1915a'];
    for (let s = 0; s < 11; s++) {
      const pal = r() < (variant === 1 ? 0.6 : 0.2) ? dry : green;
      const base = 5 + Math.floor(r() * 7), top = 1 + Math.floor(r() * 8), lean = (r() - 0.5) * 1.2;
      for (let y = h - 1; y >= top; y--) {
        const t = (h - 1 - y) / (h - 1 - top);
        px(Math.round(base + lean * t * t * 6), y, pal[t > 0.75 ? 3 : t > 0.35 ? 2 : 1]);
      }
    }
  }, { seed: 261 + variant, alpha: true });
}

// --- Logs & rocks ------------------------------------------------------------------------------

// Bark of a long-fallen log, 16 x 32: long wavy furrows running along the trunk (v), grey-brown
// weathered ridges, a few cross-checks, punky orange rot showing where bark has sloughed off,
// and moss creeping into the furrows.
export function logBarkTexture() {
  return pixelTexture('logBark', 16, 32, (g, px, r, w, h) => {
    const pal = ['#15110e', '#241d18', '#352b23', '#463a2f', '#5a4c3e', '#6f6150'];
    g.fillStyle = pal[2]; g.fillRect(0, 0, w, h);
    // Ridges with a lit left edge, separated by dark furrows; all wander gently along v.
    for (let s = 0; s < 6; s++) {
      let x = Math.floor((s / 6) * w + r() * 2);
      const tone = 3 + Math.floor(r() * 2);
      for (let y = 0; y < h; y++) {
        if (r() < 0.12) x += r() < 0.5 ? -1 : 1;
        px(x - 1, y, pal[0]);                       // furrow
        px(x, y, pal[tone + 1 > 5 ? 5 : tone + 1]); // lit ridge edge
        px(x + 1, y, pal[tone]);
        if (r() < 0.5) px(x + 2, y, pal[tone - 1]);
      }
    }
    // Cross-checks.
    for (let i = 0; i < 5; i++) { const y = Math.floor(r() * h), x0 = Math.floor(r() * w); for (let k = 0; k < 3; k++) px(x0 + k, y, pal[1]); }
    // Sloughed patch: punky orange-brown heartwood.
    const py = Math.floor(r() * h), pxx = Math.floor(r() * w);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) if (r() < 0.85) px(pxx + x, py + y, r() < 0.5 ? '#7a4a26' : '#8e5a2e');
    // Moss in the furrows.
    for (let i = 0; i < 14; i++) px(Math.floor(r() * w), Math.floor(r() * h), r() < 0.6 ? '#2f4520' : '#46622a');
  }, { seed: 311 });
}

// Cut / broken log end, 16 x 16 (mapped onto a disc): growth rings, radial cracks, dark rotten
// heart in the hollow variant.
export function logEndTexture(variant = 0) {
  return pixelTexture(`logEnd${variant}`, 16, 16, (g, px, r, w, h) => {
    const rings = ['#5a4130', '#6d5039', '#806044', '#94714f'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7.6) { px(x, y, '#2a1d15'); continue; }
      if (d > 6.6) { px(x, y, r() < 0.5 ? '#3b2a1f' : '#2e2118'); continue; }   // bark rim
      const ring = Math.floor(d * 1.3 + Math.sin(Math.atan2(y - 7.5, x - 7.5) * 3) * 0.3);
      px(x, y, rings[ring % 2 === 0 ? 2 : 1]);
      if (variant === 1 && d < 3.4) px(x, y, d < 2.4 ? '#0f0b09' : '#2a1d15');   // hollow / rotten heart
      if (variant === 0 && d < 0.9) px(x, y, rings[3]);
    }
    // Radial checks (drying cracks).
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2;
      for (let d = 1.5; d < 6.5; d += 0.8) px(Math.round(7.5 + Math.cos(a) * d), Math.round(7.5 + Math.sin(a) * d), '#3a2a20');
    }
    // Weathering: grey bleach on the face.
    for (let i = 0; i < 8; i++) { const x = 3 + Math.floor(r() * 10), y = 3 + Math.floor(r() * 10); if (Math.hypot(x - 7.5, y - 7.5) < 6) px(x, y, '#8d8273'); }
  }, { seed: 271 + variant });
}

// Moss carpet, 16 x 16, alpha: patchy cushions with lit tops, used on logs and rocks.
export function mossCarpetTexture(variant = 0) {
  return pixelTexture(`mossCarpet${variant}`, 16, 16, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#2a3a1a', '#3c5020', '#536a28', '#6f8634']   // brighter, sunnier moss
      : ['#1a2a16', '#28401d', '#385625', '#4c6e2e'];
    for (let i = 0; i < 9; i++) {
      const cx = Math.floor(r() * w), cy = Math.floor(r() * h), rad = 1.5 + r() * 2.5;
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x, y);
        if (d > rad) continue;
        px(cx + x, cy + y, pal[d > rad - 1 ? 0 : y < -rad * 0.3 ? 3 : r() < 0.5 ? 2 : 1]);
      }
    }
  }, { seed: 281 + variant, alpha: true });
}

// Granite boulder, 32 x 32 (tiles): cool grey with feldspar speckles, dark cracks, pale and
// orange lichen rosettes.
export function rockTexture(variant = 0) {
  return pixelTexture(`rock${variant}`, 32, 32, (g, px, r, w, h) => {
    const pal = variant === 1
      ? ['#1c1d1f', '#2c2d30', '#3c3d40', '#4d4e50', '#606061', '#77756f']   // darker basalt
      : ['#24262a', '#36383c', '#484a4c', '#5a5b5b', '#6e6d69', '#878478'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = r() + r() * 0.8 + (Math.sin((x + y * 0.6) * 0.5) * 0.15);
      px(x, y, pal[Math.max(1, Math.min(4, Math.floor(n * 2.2)))]);
    }
    for (let i = 0; i < 26; i++) px(Math.floor(r() * w), Math.floor(r() * h), r() < 0.5 ? pal[5] : pal[0]); // speckles
    // Cracks: wandering dark lines with a lit lip above.
    for (let c = 0; c < 3; c++) {
      let x = Math.floor(r() * w), y = Math.floor(r() * h);
      for (let k = 0; k < 14; k++) {
        px(x, y, pal[0]); px(x, y - 1, pal[4]);
        x += 1; if (r() < 0.45) y += r() < 0.5 ? -1 : 1;
      }
    }
    // Lichen rosettes.
    for (let i = 0; i < 5; i++) {
      const cx = Math.floor(r() * w), cy = Math.floor(r() * h), col = r() < 0.7 ? ['#5f6e52', '#7e8c66', '#9aa57c'] : ['#8a5a26', '#a8722e', '#c08a3a'];
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 4 && r() < 0.75) px(cx + x, cy + y, col[x * x + y * y <= 1 ? 2 : r() < 0.5 ? 1 : 0]);
    }
  }, { seed: 291 + variant });
}

// Forest-floor litter decal, 32 x 32, alpha: fallen needles, twigs and a pine cone, scattered
// in clumps around tree bases so the ground under each tree reads as lived-in.
export function needleLitterTexture() {
  return pixelTexture('needleLitter', 32, 32, (g, px, r, w, h) => {
    const needles = ['#4a3220', '#5c3f26', '#73502e', '#8a6236', '#3a2818'];
    for (let i = 0; i < 160; i++) {
      const cx = 16 + (r() - 0.5) * 30 * Math.sqrt(r()), cy = 16 + (r() - 0.5) * 30 * Math.sqrt(r());
      const dx = r() < 0.5 ? 1 : -1, dy = r() < 0.5 ? 1 : 0, c = pick(r, needles);
      for (let k = 0; k < 3; k++) px(Math.round(cx + dx * k), Math.round(cy + dy * k * 0.5), c);
    }
    for (let t = 0; t < 2; t++) {   // twigs
      let x = 4 + Math.floor(r() * 24), y = 4 + Math.floor(r() * 24);
      const dx = r() < 0.5 ? 1 : -1;
      for (let k = 0; k < 8; k++) { px(x, y, '#2e2119'); px(x, y - 1, '#5a4535'); x += dx; if (r() < 0.3) y += 1; }
    }
    // A pine cone.
    const cx = 10 + Math.floor(r() * 12), cy = 10 + Math.floor(r() * 12);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) px(cx + x, cy + y, (x + y) % 2 ? '#3d2614' : '#7a5230');
    px(cx + 1, cy - 1, '#a0703e');
  }, { seed: 301, alpha: true });
}
