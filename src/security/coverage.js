// Observation coverage (#153; GDD §5.4 L11 Hidebehind, §15.2 G06, S15 camp security). Pure: no
// three.js, no DOM.
//
// A point is WATCHED when it's covered by:
//   direct vision  an awake observer (you) whose view cone and range contain it, with a clear line
//   a camera node  powered, in place, the point inside its field of view and range, with a clear line
// Unpowered, removed or occluded nodes give no coverage at all. The Hidebehind checks coverage, not
// who owns the camera.
//
// The Hidebehind moves on a COVER GRAPH: nodes of connected cover, edges between neighbours. Each
// step goes to an adjacent node only (it never teleports), and only along an edge that is unwatched
// right now; if every way forward is watched it waits.

/** Slab test: does the segment a->b pass through box { min, max } (ignoring a start inside it)? */
export function segmentHitsBox(a, b, box, margin = 0.3) {
  const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z], mn = [box.min.x, box.min.y, box.min.z], mx = [box.max.x, box.max.y, box.max.z];
  if (o.every((v, i) => v >= mn[i] && v <= mx[i])) return false;            // standing inside / against it
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return false; continue; }
    let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  const len = Math.hypot(...d);
  return t0 * len < len - margin;                                            // something solid before the target
}

export class CoverageGraph {
  /**
   * nodes:     [{ id, x, y, z, heading (rad, 0 = +z), fov (half-angle rad), range, removed? }]
   * occluders: [{ min:{x,y,z}, max:{x,y,z} }] (trees, rocks, walls)
   * powered:   () => true while the hub feeds the network
   */
  constructor({ nodes = [], occluders = [], powered = () => true } = {}) {
    Object.assign(this, { nodes, occluders, powered });
  }

  clear(a, b) { for (const o of this.occluders) if (segmentHitsBox(a, b, o)) return false; return true; }

  /** A node gives coverage only while powered, in place and unoccluded. */
  live(n) { return !n.removed && this.powered(); }

  /** Ids of the camera nodes that see point p { x, y, z }. */
  camerasSeeing(p) {
    const out = [];
    for (const n of this.nodes) {
      if (!this.live(n)) continue;
      const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz);
      if (d > n.range) continue;
      if (d > 0.5 && (Math.sin(n.heading) * dx + Math.cos(n.heading) * dz) / d < Math.cos(n.fov)) continue;
      if (this.clear({ x: n.x, y: n.y, z: n.z }, p)) out.push(n.id);
    }
    return out;
  }

  /** Direct vision: observer { x, y, z, forward: {x, z} (unit), fov, range, awake }. */
  observerSees(o, p) {
    if (!o || o.awake === false) return false;
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
    if (d > o.range) return false;
    if (d > 2 && (o.forward.x * dx + o.forward.z * dz) / d < Math.cos(o.fov)) return false;
    return this.clear({ x: o.x, y: o.y, z: o.z }, p);
  }

  /** { watched, direct, cameras } for p, given the observers present. */
  coverage(p, observers = []) {
    const direct = observers.some((o) => this.observerSees(o, p));
    const cameras = this.camerasSeeing(p);
    return { watched: direct || cameras.length > 0, direct, cameras };
  }
  watched(p, observers = []) { return this.coverage(p, observers).watched; }

  /** A stretch is watched if any sample along it is (head height h). */
  edgeWatched(a, b, observers = [], { h = 1.4, samples = 5 } = {}) {
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      if (this.watched({ x: a.x + (b.x - a.x) * t, y: h, z: a.z + (b.z - a.z) * t }, observers)) return true;
    }
    return false;
  }
}

/** Connected cover: nodes { id: { x, z } } and undirected edges [[a, b], ...]. */
export class CoverGraph {
  constructor({ nodes, edges }) {
    this.nodes = nodes;
    this.adj = new Map(Object.keys(nodes).map((k) => [k, []]));
    for (const [a, b] of edges) { this.adj.get(a).push(b); this.adj.get(b).push(a); }
  }
  neighbours(id) { return this.adj.get(id) ?? []; }

  /**
   * The Hidebehind's next step from `at` toward `goal`: the adjacent node that starts the shortest
   * path to the goal using only unwatched edges (edgeWatched(a, b) -> bool, evaluated now). Null:
   * wait (no unwatched way forward). Never anything but a neighbour.
   */
  nextStep(at, goal, edgeWatched) {
    const N = this.nodes, open = new Map();
    const ok = (a, b) => { const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (!open.has(k)) open.set(k, !edgeWatched(N[a], N[b])); return open.get(k); };
    const prev = new Map([[at, null]]), q = [at];
    while (q.length) {
      const u = q.shift();
      if (u === goal) break;
      for (const v of this.neighbours(u)) if (!prev.has(v) && ok(u, v)) { prev.set(v, u); q.push(v); }
    }
    if (!prev.has(goal) || goal === at) {
      // No unwatched path all the way: still creep to an unwatched neighbour that's closer to the goal.
      const g = N[goal], d0 = Math.hypot(N[at].x - g.x, N[at].z - g.z);
      const best = this.neighbours(at).filter((v) => ok(at, v)).map((v) => ({ v, d: Math.hypot(N[v].x - g.x, N[v].z - g.z) })).filter((c) => c.d < d0).sort((x, y) => x.d - y.d)[0];
      return best?.v ?? null;
    }
    let step = goal;
    while (prev.get(step) !== at) step = prev.get(step);
    return step;
  }
}
