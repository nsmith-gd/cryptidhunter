// Walkable-area grid ("navmesh") baked from the map's AABB colliders, plus A* pathfinding.
// Each grid is baked for one agent size: blockers are inflated by the agent radius, and anything
// lower than the agent's head with a top above step height blocks (so a 2.4m cryptid can't
// squeeze under the crawl slab the player can crouch through).

const SQRT2 = Math.SQRT2;

export class NavGrid {
  /**
   * @param {THREE.Box3[]} colliders
   * @param {object} opts { halfSize, cellSize, agentRadius, agentHeight, stepHeight }
   */
  constructor(colliders, { halfSize = 40, cellSize = 0.5, agentRadius = 0.4, agentHeight = 2, stepHeight = 0.35 } = {}) {
    this.cell = cellSize;
    this.origin = -halfSize;
    this.n = Math.ceil((halfSize * 2) / cellSize);
    this.blocked = new Uint8Array(this.n * this.n);
    this.agentRadius = agentRadius;
    this.agentHeight = agentHeight;

    for (const c of colliders) {
      if (c.max.y <= stepHeight || c.min.y >= agentHeight) continue;
      const x0 = this.toCell(c.min.x - agentRadius), x1 = this.toCell(c.max.x + agentRadius);
      const z0 = this.toCell(c.min.z - agentRadius), z1 = this.toCell(c.max.z + agentRadius);
      for (let z = Math.max(0, z0); z <= Math.min(this.n - 1, z1); z++)
        for (let x = Math.max(0, x0); x <= Math.min(this.n - 1, x1); x++) this.blocked[z * this.n + x] = 1;
    }
    // Map edge is never walkable.
    for (let i = 0; i < this.n; i++) {
      this.blocked[i] = this.blocked[(this.n - 1) * this.n + i] = 1;
      this.blocked[i * this.n] = this.blocked[i * this.n + this.n - 1] = 1;
    }
  }

  toCell(v) { return Math.floor((v - this.origin) / this.cell); }
  center(ix) { return this.origin + (ix + 0.5) * this.cell; }
  inside(x, z) { return x >= 0 && z >= 0 && x < this.n && z < this.n; }
  walkableCell(x, z) { return this.inside(x, z) && !this.blocked[z * this.n + x]; }
  isWalkable(px, pz) { return this.walkableCell(this.toCell(px), this.toCell(pz)); }

  /** Nearest walkable point within maxDist (metres), or null. Like NavMesh.SamplePosition. */
  sample(px, pz, maxDist = 3) {
    const cx = this.toCell(px), cz = this.toCell(pz);
    if (this.walkableCell(cx, cz)) return { x: px, z: pz };
    const rMax = Math.ceil(maxDist / this.cell);
    let best = null, bestD = Infinity;
    for (let r = 1; r <= rMax; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (!this.walkableCell(x, z)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = { x: this.center(x), z: this.center(z) }; }
      }
      if (best) return best;
    }
    return null;
  }

  /** Random walkable point within radius of (cx, cz), or null after a few tries. */
  randomPoint(cx, cz, radius, rand = Math.random, tries = 16) {
    for (let i = 0; i < tries; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
      const p = this.sample(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 2);
      if (p) return p;
    }
    return null;
  }

  /** Straight walkable line between two points (grid DDA-ish sampling at quarter-cell steps). */
  lineClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) / (this.cell * 0.25));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      if (!this.isWalkable(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /** A* from start to goal (world x/z). Returns smoothed waypoint list [{x,z}...] or null. */
  findPath(sx, sz, gx, gz) {
    const start = this.sample(sx, sz, 2), goal = this.sample(gx, gz, 3);
    if (!start || !goal) return null;
    const n = this.n;
    const s = this.toCell(start.z) * n + this.toCell(start.x);
    const g = this.toCell(goal.z) * n + this.toCell(goal.x);
    const gxC = g % n, gzC = (g / n) | 0;

    const gScore = new Float32Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap = new MinHeap();
    gScore[s] = 0;
    heap.push(s, octile(s % n, (s / n) | 0, gxC, gzC));

    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === g) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % n, cz = (cur / n) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx, z = cz + dz;
        if (!this.walkableCell(x, z)) continue;
        // No corner cutting.
        if (dx && dz && (!this.walkableCell(cx + dx, cz) || !this.walkableCell(cx, cz + dz))) continue;
        const nb = z * n + x;
        if (closed[nb]) continue;
        const tentative = gScore[cur] + (dx && dz ? SQRT2 : 1);
        if (tentative < gScore[nb]) {
          gScore[nb] = tentative;
          came[nb] = cur;
          heap.push(nb, tentative + octile(x, z, gxC, gzC));
        }
      }
    }
    if (!found) return null;

    const cells = [];
    for (let c = g; c !== -1; c = came[c]) cells.push({ x: this.center(c % n), z: this.center((c / n) | 0) });
    cells.reverse();
    cells[0] = { x: start.x, z: start.z };
    cells[cells.length - 1] = { x: goal.x, z: goal.z };
    return this.smooth(cells);
  }

  // String-pull: skip waypoints while there's a clear straight line.
  smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineClear(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

function octile(x, z, gx, gz) {
  const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
}

class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const a = this.items, q = this.prio;
    let i = a.length;
    a.push(item); q.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= p) break;
      a[i] = a[parent]; q[i] = q[parent];
      i = parent;
    }
    a[i] = item; q[i] = p;
  }
  pop() {
    const a = this.items, q = this.prio;
    const top = a[0];
    const lastI = a.pop(), lastP = q.pop();
    if (a.length) {
      let i = 0;
      const len = a.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && q[c + 1] < q[c]) c++;
        if (q[c] >= lastP) break;
        a[i] = a[c]; q[i] = q[c];
        i = c;
      }
      a[i] = lastI; q[i] = lastP;
    }
    return top;
  }
}
