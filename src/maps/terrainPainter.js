import * as THREE from 'three';

// Terrain painter: the path tool (#61).
//
// Dirt trails, clearings, creek banks, moss and grass are PAINTED INTO the ground instead of being
// laid over it as thin strips and discs. A splat map (one RGBA texel every ~0.3 m) stores how much
// of each surface is at each spot, and a single ground material picks the surface per world
// texel (32 per metre, the style guide's density) with an ordered-dither edge. One surface, one
// depth: nothing on the ground can z-fight, and trails blend into the forest floor with ragged
// pixel-art edges.
//
// Ground layering hierarchy (what lives where, top wins):
//   1. Terrain (this file)   one mesh at y = 0: base litter < grass < moss < creek bank < dirt path
//   2. Ground props          real geometry standing on the terrain (rocks, logs, ferns, roots)
//   3. Decals                small flat things (clue footprints, scorch marks): never offset in y
//                            alone; they use polygonOffset tiers (DECAL_OFFSET) so they always win
//   4. Water                 its own surface, clearly above the bed (creek ribbon at +6 cm,
//                            swamp water planes biased with WATER_OFFSET), never stacked strips
// Rules: no two coplanar surfaces; no overlapping strips; if something must sit on another flat
// surface, give it a polygonOffset tier from this table rather than a millimetre lift.

export const DECAL_OFFSET = Object.freeze({ factor: -2, units: -4 });
export const WATER_OFFSET = Object.freeze({ factor: -1, units: -2 });

const CHANNELS = { dirt: 0, moss: 1, grass: 2, bank: 3 };
// Painting a higher-priority surface clears the lower ones underneath it.
const PRIORITY = ['grass', 'moss', 'bank', 'dirt'];

export class TerrainPainter {
  constructor({ half, res = 1024, seed = 1 }) {
    this.half = half;
    this.res = res;
    this.m = (2 * half) / res;                          // metres per splat texel
    this.data = new Uint8Array(res * res * 4);
    this.seed = seed;
  }

  // Cheap smooth value noise for wobbly edges (deterministic, metres in, -1..1 out).
  noise(x, z, scale = 0.35) {
    const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7 + this.seed * 74.7) * 43758.5453; return s - Math.floor(s); };
    const fx = x * scale, fz = z * scale, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
  }

  /** Write weight w (0..1) of `surface` at texel (i, j), clearing lower-priority surfaces under it. */
  put(i, j, surface, w) {
    if (w <= 0) return;
    const o = (j * this.res + i) * 4, ch = CHANNELS[surface];
    this.data[o + ch] = Math.max(this.data[o + ch], Math.round(w * 255));
    for (const s of PRIORITY.slice(0, PRIORITY.indexOf(surface))) {
      const c = CHANNELS[s];
      this.data[o + c] = Math.round(this.data[o + c] * (1 - w));
    }
  }

  /**
   * Paint along a polyline: a band `width` metres wide with soft, wobbly edges.
   * points: [{x, z}, ...]  opts: { width, edge (m of falloff), wobble (m of edge noise) }
   */
  paintPath(points, surface, { width = 3, edge = 0.5, wobble = 0.4 } = {}) {
    const pad = width / 2 + edge + wobble + 1;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const [i0, j0] = this.cell(x0 - pad, z0 - pad), [i1, j1] = this.cell(x1 + pad, z1 + pad);
    for (let j = Math.max(0, j0); j <= Math.min(this.res - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.res - 1, i1); i++) {
        const x = -this.half + (i + 0.5) * this.m, z = -this.half + (j + 0.5) * this.m;
        const d = distToPolyline(x, z, points) + this.noise(x, z) * wobble;
        const t = (d - (width / 2 - edge)) / (2 * edge);
        this.put(i, j, surface, 1 - Math.min(1, Math.max(0, t)));
      }
    }
  }

  /** Paint a round patch (clearings, moss pads) with a wobbly rim. */
  paintDisc(c, radius, surface, opts = {}) {
    this.paintPath([c, c], surface, { width: radius * 2, ...opts });
  }

  cell(x, z) { return [Math.floor((x + this.half) / this.m), Math.floor((z + this.half) / this.m)]; }

  /** Weight (0..1) of a surface at a world point (for checks and gameplay queries). */
  sample(x, z, surface) {
    const [i, j] = this.cell(x, z);
    if (i < 0 || j < 0 || i >= this.res || j >= this.res) return 0;
    return this.data[(j * this.res + i) * 4 + CHANNELS[surface]] / 255;
  }

  texture() {
    const t = new THREE.DataTexture(this.data, this.res, this.res, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;                  // smooth weights; the shader dithers them crisp
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /**
   * The ground material: picks base / grass / moss / bank / dirt per world texel from the splat,
   * dithered at the edges. layers: { base, grass, moss, bank, dirt } -> { map, tile (m), tint? }
   */
  material(layers) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 1 });
    const U = {
      uSplat: { value: this.texture() }, uHalf: { value: this.half },
      uBase: { value: layers.base.map }, uGrass: { value: layers.grass.map }, uMoss: { value: layers.moss.map },
      uBank: { value: layers.bank.map }, uDirt: { value: layers.dirt.map },
      uTiles: { value: new THREE.Vector4(layers.grass.tile, layers.moss.tile, layers.bank.tile, layers.dirt.tile) },
      uBaseTile: { value: layers.base.tile },
      uBankTint: { value: new THREE.Color(layers.bank.tint ?? 0xffffff) },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vTerrainW;
          uniform sampler2D uSplat, uBase, uGrass, uMoss, uBank, uDirt;
          uniform float uHalf, uBaseTile; uniform vec4 uTiles; uniform vec3 uBankTint;
          float terrainBayer(vec2 p) {
            vec2 q = mod(p, 4.0);
            int i = int(q.x) + int(q.y) * 4;
            int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
            return float(m[i]) / 16.0 - 0.5;
          }`)
        .replace('#include <map_fragment>', `{
          vec2 wp = vTerrainW.xz;
          vec4 sp = texture2D(uSplat, (wp + uHalf) / (2.0 * uHalf));
          float dz = terrainBayer(floor(wp * 32.0)) * 0.5;      // ordered dither on the 32/m texel grid
          vec4 col = texture2D(uBase, wp / uBaseTile);
          if (sp.b + dz > 0.5) col = texture2D(uGrass, wp / uTiles.x);
          if (sp.g + dz > 0.5) col = texture2D(uMoss, wp / uTiles.y);
          if (sp.a + dz > 0.5) col = texture2D(uBank, wp / uTiles.z) * vec4(uBankTint, 1.0);
          if (sp.r + dz > 0.5) col = texture2D(uDirt, wp / uTiles.w);
          diffuseColor *= col;
        }`);
    };
    mat.customProgramCacheKey = () => 'terrainSplat';
    return mat;
  }
}

/** One continuous ribbon along a polyline (mitred joints): no overlapping strips at the bends. */
export function ribbonGeometry(points, width, y, uvTile = 4) {
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let k = 0; k < points.length; k++) {
    const p = points[k], prev = points[Math.max(0, k - 1)], next = points[Math.min(points.length - 1, k + 1)];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // Miter: keep the ribbon's width constant through the bend.
    let miter = 1;
    if (k > 0 && k < points.length - 1) {
      const ax = p.x - prev.x, az = p.z - prev.z, al = Math.hypot(ax, az) || 1;
      miter = 1 / Math.max(0.5, (ax / al) * dx + (az / al) * dz);
    }
    const nx = -dz * (width / 2) * miter, nz = dx * (width / 2) * miter;
    if (k > 0) along += Math.hypot(p.x - points[k - 1].x, p.z - points[k - 1].z);
    pos.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz);
    uv.push(along / uvTile, 0, along / uvTile, width / uvTile);
    if (k > 0) { const b = (k - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure the face points up whatever the winding came out as.
  if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((_, i) => idx[i - (i % 3) + (2 - (i % 3))])); g.computeVertexNormals(); }
  return g;
}

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}
