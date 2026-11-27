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
  // Trails (#143): drops close enough together read as one trail, followed toward the fresher end.
  link: 7,             // metres: the furthest gap a nose bridges between two traces of a trail
  arrive: 1.5,         // metres: close enough to have checked a trace
});

/** The world's scent traces and wind. One per map; perception reads `SCENT_WORLD.field`. */
export class ScentField {
  constructor({ wind = { x: 1, z: 0, speed: 1.5 }, isWet = null } = {}) {
    this.traces = [];
    this.sources = [];                // continuous emitters (#143): a carcass keeps smelling while it lies there
    this.isWet = isWet;               // (x, z) -> true in water: scent landing there is carried off (breaks a trail)
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
    if (this.isWet?.(x, z)) { this.log.push({ t: +this.time.toFixed(2), kind, x: +x.toFixed(1), z: +z.toFixed(1), source, washed: true }); return null; }
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

  /**
   * A continuous emitter (#143): { kind, x, z } or { kind, at: () => ({ x, z }) } for a moving one
   * (a carcass you carry), re-emitting every `every` seconds until removed. Returns its id.
   */
  addSource({ kind, x = 0, z = 0, at = null, every = 20, strength = null, source = kind }) {
    const s = { id: `src${this.nextId++}`, kind, x, z, at, every, strength, source, clock: 0 };
    this.sources.push(s);
    const p = at ? at() : { x, z };
    this.emit(kind, p.x, p.z, { strength, source });
    return s.id;
  }
  removeSource(id) { this.sources = this.sources.filter((s) => s.id !== id); }

  /**
   * The next trace along a trail from `t`: the nearest trace within `link` m that was laid later
   * than `t` (the fresher direction), skipping ids in `visited`. Null at the fresh end, or where
   * the trail breaks (a gap wider than a nose can bridge: wound bandaged, water crossed).
   */
  trailNext(t, { link = SCENT.link, visited = null } = {}) {
    let best = null, bd = Infinity;
    for (const o of this.traces) {
      if (o === t || o.born <= t.born || visited?.has(o.id)) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      if (d <= link && d < bd) { best = o; bd = d; }
    }
    return best;
  }

  /** Readable records of every live trace (debug overlay, checks). */
  records() {
    return this.traces.map((t) => ({ id: t.id, kind: t.kind, x: +t.x.toFixed(1), z: +t.z.toFixed(1), source: t.source,
      strength: +this.strengthOf(t).toFixed(3), age: +(this.time - t.born).toFixed(1), expiresIn: Math.round(this.expiresIn(t)) }));
  }

  update(dt) {
    this.time += dt;
    for (const s of this.sources) {
      if ((s.clock += dt) < s.every) continue;
      s.clock = 0;
      const p = s.at ? s.at() : s;
      this.emit(s.kind, p.x, p.z, { strength: s.strength, source: s.source });
    }
    this.traces = this.traces.filter((t) => this.strengthOf(t) >= SCENT.gone);
  }
}

/**
 * Following a scent trail (#143, GDD 5.3/5.4: "Howler follows believable recent trails"). Reads
 * only the world's traces - never anyone's pack. From where it stands it waits for a trace on the
 * wind (smell()); walks to it; then, nose down, goes trace to trace toward the fresher end
 * (trailNext). Where the trail stops (the fresh end, or a break: bandaged wound, water crossed)
 * it casts about at the last trace, then gives up.
 *   state: idle | approach | follow | casting | lost
 *   waypoint(): where to walk now ({ x, z } or null). log: what it did and why.
 */
export class ScentTracker {
  constructor(field, { keenness = 1.5, notice = 0.08, castTime = 8 } = {}) {
    Object.assign(this, { field, keenness, notice, castTime });
    this.state = 'idle';
    this.target = null;
    this.visited = new Set();
    this.path = [];                 // traces it checked, in order
    this.log = [];
    this.cast = 0;
  }

  note(what, t) { this.log.push({ t: +this.field.time.toFixed(1), what, ...(t ? { trace: t.id, kind: t.kind, x: +t.x.toFixed(1), z: +t.z.toFixed(1) } : {}) }); }

  waypoint() { return this.target && (this.state === 'approach' || this.state === 'follow') ? { x: this.target.x, z: this.target.z } : null; }

  /** Advance from the creature's position (x, z). dt: seconds. */
  update(x, z, dt = 0) {
    const f = this.field;
    if (this.target && !f.traces.includes(this.target)) this.target = null;   // faded or gone
    if (this.state === 'idle' || this.state === 'lost') {
      const sm = f.smell(x, z, this.keenness);
      if (sm && sm.level >= this.notice && !this.visited.has(sm.trace.id)) {
        this.target = sm.trace; this.state = 'approach'; this.cast = 0;
        this.note(`smells ${SCENT.kinds[sm.trace.kind].label} on the wind (${sm.level.toFixed(2)})`, sm.trace);
      }
      return this.state;
    }
    if ((this.state === 'approach' || this.state === 'follow') && !this.target) { this.state = 'casting'; this.cast = 0; this.note('the scent faded'); }
    if (this.state === 'approach' || this.state === 'follow') {
      if (Math.hypot(this.target.x - x, this.target.z - z) <= SCENT.arrive) {
        const here = this.target;
        this.visited.add(here.id); this.path.push({ id: here.id, kind: here.kind, x: here.x, z: here.z });
        const next = f.trailNext(here, { visited: this.visited });
        if (next) { this.target = next; this.state = 'follow'; this.note('follows the trail', next); }
        else { this.target = null; this.state = 'casting'; this.cast = 0; this.lastAt = here; this.note('the trail ends here: casting about', here); }
      }
    } else if (this.state === 'casting') {
      // Circle the last trace a while: a fresher one may turn up within reach (the trail picked up again).
      const from = this.lastAt;
      const next = from && f.trailNext(from, { visited: this.visited, link: SCENT.link * 1.3 });
      if (next) { this.target = next; this.state = 'follow'; this.note('picks the trail up again', next); }
      else if ((this.cast += dt) >= this.castTime) { this.state = 'lost'; this.note('lost the trail'); }
    }
    return this.state;
  }
}

/** The active map's field (set by the game; perception reads it). */
export const SCENT_WORLD = { field: null };
