// Scent traces (#107; GDD 5.3 scent channel, 2.4 "scent emission and traces", S14).
//
// Real things leave traces at real places: food you eat (opened, chewed, crumbs), blood from a
// wound that's bleeding (injury system, S08), and carcasses. A trace is strongest when fresh and
// fades by half every `halfLife` seconds. The wind carries it: downwind of a trace a creature can
// smell it from far off (further for a strong, fresh trace and a steady wind); across the wind the
// plume is narrow; upwind it can't be smelled beyond a couple of metres.
// A creature only ever smells traces that exist in the world. Nothing reads your pack: food you're
// carrying leaves no scent until you open it.

export const SCENT = Object.freeze({
  kinds: {
    food: { strength: 1.0, halfLife: 120, label: 'food' },
    blood: { strength: 0.55, halfLife: 150, label: 'blood' },
    carcass: { strength: 1.4, halfLife: 600, label: 'a carcass' },
  },
  nearAnyway: 2,       // metres: smelled from any direction this close
  baseReach: 10,       // metres downwind a full-strength trace carries in still air
  reachPerWind: 18,    // extra metres per m/s of wind
  spread: 0.3,         // plume widens by this per metre downwind
  minWidth: 2.5,
  gone: 0.03,          // traces weaker than this are dropped
});

/** The world's scent traces and wind. One per map; perception reads `SCENT_WORLD.field`. */
export class ScentField {
  constructor({ wind = { x: 1, z: 0, speed: 1.5 } } = {}) {
    this.traces = [];
    this.time = 0;
    this.nextId = 1;
    this.setWind(wind);
    this.log = [];                    // { t, kind, x, z, source } every emission
  }

  /** Wind blowing TOWARD (x, z), at speed m/s. */
  setWind({ x, z, speed }) {
    const l = Math.hypot(x, z) || 1;
    this.wind = { x: x / l, z: z / l, speed };
  }

  emit(kind, x, z, { strength = null, source = kind } = {}) {
    const k = SCENT.kinds[kind];
    if (!k) return null;
    // Re-emitting at the same spot refreshes that trace instead of piling up.
    const near = this.traces.find((t) => t.kind === kind && Math.hypot(t.x - x, t.z - z) < 1.5);
    if (near) { near.strength0 = Math.max(this.strengthOf(near), strength ?? k.strength); near.born = this.time; return near; }
    const t = { id: this.nextId++, kind, x, z, strength0: strength ?? k.strength, born: this.time, halfLife: k.halfLife, source };
    this.traces.push(t);
    this.log.push({ t: +this.time.toFixed(2), kind, x: +x.toFixed(1), z: +z.toFixed(1), source });
    return t;
  }

  strengthOf(t) { return t.strength0 * Math.pow(0.5, (this.time - t.born) / t.halfLife); }
  /** Seconds until the trace fades below detection. */
  expiresIn(t) { return Math.max(0, t.halfLife * Math.log2(this.strengthOf(t) / SCENT.gone)); }

  /** How strongly a trace reaches a point (0..), given the wind. */
  levelAt(t, x, z) {
    const s = this.strengthOf(t);
    const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz);
    if (d <= SCENT.nearAnyway) return s;
    const along = dx * this.wind.x + dz * this.wind.z;            // metres downwind of the trace
    if (along <= 0) return 0;                                       // upwind: nothing
    const across = Math.abs(dx * this.wind.z - dz * this.wind.x);
    const reach = (SCENT.baseReach + SCENT.reachPerWind * this.wind.speed) * Math.min(1.5, s);
    if (along >= reach) return 0;
    const width = SCENT.minWidth + along * SCENT.spread;
    return s * (1 - along / reach) * Math.exp(-((across / width) ** 2));
  }

  /** The strongest trace reaching (x, z) for a nose of keenness k: { trace, level } or null. */
  smell(x, z, keenness = 1) {
    let best = null;
    for (const t of this.traces) {
      const level = this.levelAt(t, x, z) * keenness;
      if (level > (best?.level ?? 0)) best = { trace: t, level };
    }
    return best;
  }

  update(dt) {
    this.time += dt;
    this.traces = this.traces.filter((t) => this.strengthOf(t) >= SCENT.gone);
  }
}

/** The active map's field (set by the game; perception reads it). */
export const SCENT_WORLD = { field: null };
