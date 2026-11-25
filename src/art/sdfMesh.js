import * as THREE from 'three';

// Sculpt-in-code toolkit for organic low-poly models (#57, #58).
// Shapes are written as signed distance functions (capsules, ellipsoids, rounded boxes) blended
// with a smooth union, so limbs flow into each other like a sculpt instead of meeting as boxes.
// The surface is meshed with "surface nets" (one vertex per cell, quads between them: clean,
// even topology), relaxed a little, and flat-shaded: a faceted low-poly look with no stair-steps.
// UVs come from a per-face planar projection at a fixed texel density, so painted pixel
// textures sit at a constant pixel size on every facet.

// ---- SDF primitives -------------------------------------------------------------------------
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = v3(), _b = v3(), _p = v3();

/** Capsule from a to b, radius ra at a tapering to rb at b. */
export function capsule(a, b, ra, rb = ra) {
  const A = v3(...a), B = v3(...b), ab = B.clone().sub(A), len2 = ab.lengthSq();
  return (x, y, z) => {
    _p.set(x, y, z).sub(A);
    const t = Math.max(0, Math.min(1, _p.dot(ab) / len2));
    _a.copy(ab).multiplyScalar(t);
    return _p.distanceTo(_a) - (ra + (rb - ra) * t);
  };
}
/** Ellipsoid centred at c with radii r (approximate distance, fine for meshing). */
export function ellipsoid(c, r) {
  return (x, y, z) => {
    const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
    return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
  };
}
/** Box centred at c with half-size h and corner radius rad. */
export function roundBox(c, h, rad) {
  return (x, y, z) => {
    const qx = Math.abs(x - c[0]) - h[0] + rad, qy = Math.abs(y - c[1]) - h[1] + rad, qz = Math.abs(z - c[2]) - h[2] + rad;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
  };
}
/** Smooth union of distance values (k = blend radius in metres). */
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** Smooth union of many SDFs; each entry may be [sdf, blend]. */
export function blend(parts, k = 0.03) {
  return (x, y, z) => {
    let d = Infinity;
    for (const p of parts) {
      const [f, kk] = Array.isArray(p) ? p : [p, k];
      const v = f(x, y, z);
      d = d === Infinity ? v : smin(d, v, kk);
    }
    return d;
  };
}
export const subtract = (a, b, k = 0.01) => (x, y, z) => -smin(-a(x, y, z), b(x, y, z), k);

// ---- Surface nets ---------------------------------------------------------------------------

/**
 * Mesh the zero surface of sdf inside [min, max] with cells of `cell` metres.
 * Returns an indexed BufferGeometry (positions only), relaxed `smooth` times.
 */
export function surfaceNets(sdf, min, max, cell, { smooth = 2 } = {}) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1, ny = Math.ceil((max[1] - min[1]) / cell) + 1, nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    field[id(i, j, k)] = sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  // One vertex per cell that the surface passes through: average of its edge crossings.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      val[c] = field[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
      if (val[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((val[a] < 0) === (val[b] < 0)) continue;
      const t = val[a] / (val[a] - val[b]);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
      n++;
    }
    cellVert[cid(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  // A quad across every grid edge that crosses the surface.
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const inside = field[id(i, j, k)] < 0;
    if (i < nx - 1 && inside !== (field[id(i + 1, j, k)] < 0))
      quad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)], !inside);
    if (j < ny - 1 && inside !== (field[id(i, j + 1, k)] < 0))
      quad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i - 1, j, k)], cellVert[cid(i, j, k)], cellVert[cid(i, j, k - 1)], !inside);
    if (k < nz - 1 && inside !== (field[id(i, j, k + 1)] < 0))
      quad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)], !inside);
  }
  // Relax: pull each vertex toward its neighbours' average, then re-project onto the surface.
  const P = Float32Array.from(pos);
  if (smooth > 0) {
    const nb = Array.from({ length: P.length / 3 }, () => new Set());
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; nb[a].add(b); nb[b].add(a); }
    for (let it = 0; it < smooth; it++) {
      const Q = P.slice();
      for (let v = 0; v < nb.length; v++) {
        if (!nb[v].size) continue;
        let x = 0, y = 0, z = 0;
        for (const u of nb[v]) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; }
        const s = nb[v].size;
        Q[v * 3] = P[v * 3] * 0.5 + (x / s) * 0.5; Q[v * 3 + 1] = P[v * 3 + 1] * 0.5 + (y / s) * 0.5; Q[v * 3 + 2] = P[v * 3 + 2] * 0.5 + (z / s) * 0.5;
      }
      // Project back onto the zero surface (one Newton step with a numerical gradient).
      const e = cell * 0.25;
      for (let v = 0; v < nb.length; v++) {
        const x = Q[v * 3], y = Q[v * 3 + 1], z = Q[v * 3 + 2], d = sdf(x, y, z);
        const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
        const gl = Math.hypot(gx, gy, gz) / (2 * e) || 1;
        P[v * 3] = x - (gx / (2 * e)) / gl * d / gl; P[v * 3 + 1] = y - (gy / (2 * e)) / gl * d / gl; P[v * 3 + 2] = z - (gz / (2 * e)) / gl * d / gl;
      }
      P.set(P);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Flat-shade + planar UVs: un-index the geometry; each triangle's UVs are its positions
 * projected onto the plane facing its normal's dominant axis, times `ppm` texture repeats per metre.
 * Optional regionOf(centroid, normal) -> material index groups the triangles (face, fur, skin...).
 */
export function facetUV(geo, ppm, regionOf = null) {
  const g = geo.toNonIndexed();
  const p = g.attributes.position, n = p.count;
  const uv = new Float32Array(n * 2), reg = new Int32Array(n / 3);
  const a = v3(), b = v3(), c = v3(), e1 = v3(), e2 = v3(), nm = v3(), ctr = v3();
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
    nm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const ax = Math.abs(nm.x), ay = Math.abs(nm.y), az = Math.abs(nm.z);
    for (let k = 0; k < 3; k++) {
      const q = [a, b, c][k];
      const [u, w] = ax >= ay && ax >= az ? [q.z, q.y] : ay >= az ? [q.x, q.z] : [q.x, q.y];
      uv[(t + k) * 2] = u * ppm; uv[(t + k) * 2 + 1] = w * ppm;
    }
    if (regionOf) reg[t / 3] = regionOf(ctr.copy(a).add(b).add(c).divideScalar(3), nm);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (regionOf) {
    // Sort triangles by region so each material gets one contiguous group.
    const order = [...reg.keys()].sort((x, y) => reg[x] - reg[y]);
    const P2 = new Float32Array(n * 3), U2 = new Float32Array(n * 2);
    order.forEach((t, o) => { for (let k = 0; k < 3; k++) { for (let d = 0; d < 3; d++) P2[(o * 3 + k) * 3 + d] = p.array[(t * 3 + k) * 3 + d]; for (let d = 0; d < 2; d++) U2[(o * 3 + k) * 2 + d] = uv[(t * 3 + k) * 2 + d]; } });
    g.setAttribute('position', new THREE.BufferAttribute(P2, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U2, 2));
    let start = 0;
    for (let o = 1; o <= order.length; o++) {
      if (o === order.length || reg[order[o]] !== reg[order[start]]) { g.addGroup(start * 3, (o - start) * 3, reg[order[start]]); start = o; }
    }
  }
  g.computeVertexNormals();      // non-indexed: per-face normals = flat shading
  return g;
}
