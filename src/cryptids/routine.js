// Routine memory (#107; GDD 5.3 routine channel: "repeated actions actually witnessed or inferred
// from traces; bounded confidence and decay; no raw input spying").
//
// A creature remembers WHERE it has seen you (your route), and where it found traces you left
// (food you ate, blood). Each sighting near a remembered spot raises its confidence (seen: +0.25,
// inferred from a trace: +0.12), never above 1; confidence fades as the memory ages and the spot is
// forgotten at its expiry (seen 300 s, trace 180 s). It can only anticipate a place it has a memory
// of: a route you took while it never saw you, and left no trace on, can't be anticipated.

// #151 (GDD 5.4 L10, 5.7): it also learns ROUTES - the legs it watched you walk, with direction -
// and CAMPS it actually saw (a pitched tent, a fire). A leg you walk again while it watches gains
// confidence; a leg it has watched you use twice is somewhere it can wait for you (ambushSpot), and
// from the start of a remembered leg it can predict where you're heading (predictNext). A route it
// never saw you use has no memory, so nothing can be predicted on it. Bounded and decaying like spots.

export const ROUTINE = Object.freeze({
  merge: 8,              // metres: a new observation this close strengthens an existing spot
  gain: { seen: 0.25, trace: 0.12, camp: 0.4 },
  ttl: { seen: 300, trace: 180, camp: 600 },
  leg: { min: 4, gapMax: 10, ttl: 420, gain: 0.3, size: 40 },   // route legs: min length (m), max seconds between samples
  every: 3,              // seconds between route samples while it keeps watching you
  size: 24,
});

export class RoutineMemory {
  constructor() { this.spots = []; this.legs = []; this.time = 0; this.lastSample = -Infinity; this.prev = null; this.log = []; }

  /** Record a witnessed or inferred action at (x, z). via: 'seen' | 'trace'. */
  observe(kind, x, z, via = 'seen', what = null) {
    const s = this.spots.find((p) => p.kind === kind && Math.hypot(p.x - x, p.z - z) < ROUTINE.merge);
    const ttl = ROUTINE.ttl[via], gain = ROUTINE.gain[via];
    if (s) {
      s.base = Math.min(1, this.confidenceOf(s) + gain);
      s.x = (s.x * s.count + x) / (s.count + 1); s.z = (s.z * s.count + z) / (s.count + 1);
      s.count++; s.t = this.time; s.expiry = Math.max(s.expiry, this.time + ttl); s.via = s.via === 'seen' ? 'seen' : via;
      return s;
    }
    const spot = { kind, x, z, via, base: gain, count: 1, t: this.time, expiry: this.time + ttl, ...(what ? { what } : {}) };
    this.spots.push(spot);
    this.log.push({ t: +this.time.toFixed(1), kind, via, x: +x.toFixed(1), z: +z.toFixed(1) });
    if (this.spots.length > ROUTINE.size) { this.spots.sort((a, b) => this.confidenceOf(b) - this.confidenceOf(a)); this.spots.length = ROUTINE.size; }
    return spot;
  }

  /** Confidence fades linearly from its base to 0 at expiry. */
  confidenceOf(s) { return Math.max(0, Math.min(1, s.base * (s.expiry - this.time) / Math.max(1e-6, s.expiry - s.t))); }

  /** Sample your position while it watches you (throttled). Consecutive samples become a route leg. */
  sampleSeen(p) {
    if (this.time - this.lastSample < ROUTINE.every) return null;
    this.lastSample = this.time;
    const prev = this.prev;
    this.prev = { x: p.x, z: p.z, t: this.time };
    if (prev && this.time - prev.t <= ROUTINE.leg.gapMax && Math.hypot(p.x - prev.x, p.z - prev.z) >= ROUTINE.leg.min) this.observeLeg(prev, p);
    return this.observe('route', p.x, p.z, 'seen');
  }

  /** A leg it watched you walk, from a to b. The same leg again (same ends, same way) gains confidence. */
  observeLeg(a, b) {
    const L = ROUTINE.leg;
    // The same leg: both ends close, within under half its length (so the next leg along a straight
    // path isn't mistaken for this one), and the same way round.
    // The same stretch of route, sampled at a different moment: the two legs overlap (each one's
    // midpoint lies on the other) and run the same way. Neighbouring legs along a straight path
    // don't overlap, so they stay separate.
    const len = Math.hypot(b.x - a.x, b.z - a.z), m = Math.max(1.5, Math.min(ROUTINE.merge, len * 0.4));
    const seg = (x, z, ax, az, bx, bz) => { const abx = bx - ax, abz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1))); return Math.hypot(x - ax - abx * t, z - az - abz * t); };
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, ux = (b.x - a.x) / (len || 1), uz = (b.z - a.z) / (len || 1);
    const leg = this.legs.find((g) => {
      const gl = Math.hypot(g.bx - g.ax, g.bz - g.az) || 1;
      return ((g.bx - g.ax) * ux + (g.bz - g.az) * uz) / gl > 0.8
        && seg(mx, mz, g.ax, g.az, g.bx, g.bz) < m && seg((g.ax + g.bx) / 2, (g.az + g.bz) / 2, a.x, a.z, b.x, b.z) < m;
    });
    if (leg) {
      leg.base = Math.min(1, this.confidenceOf(leg) + L.gain); leg.count++; leg.t = this.time; leg.expiry = Math.max(leg.expiry, this.time + L.ttl);
      return leg;
    }
    const g = { kind: 'leg', ax: a.x, az: a.z, bx: b.x, bz: b.z, base: L.gain, count: 1, t: this.time, expiry: this.time + L.ttl };
    this.legs.push(g);
    this.log.push({ t: +this.time.toFixed(1), kind: 'leg', from: [+a.x.toFixed(1), +a.z.toFixed(1)], to: [+b.x.toFixed(1), +b.z.toFixed(1)] });
    if (this.legs.length > L.size) { this.legs.sort((x, y) => this.confidenceOf(y) - this.confidenceOf(x)); this.legs.length = L.size; }
    return g;
  }

  /** A camp it actually saw (tent, fire): remembered longer than a route sample. */
  observeCamp(x, z, what = 'camp') { return this.observe('camp', x, z, 'camp', what); }

  /**
   * From where you are now, where it expects you to go next: the end of the most confident
   * remembered leg starting near (x, z). Null on a route it never watched you use.
   */
  predictNext(x, z, minConfidence = 0.05) {
    let best = null;
    for (const g of this.legs) {
      const c = this.confidenceOf(g);
      if (c < minConfidence || Math.hypot(g.ax - x, g.az - z) > Math.max(2, Math.hypot(g.bx - g.ax, g.bz - g.az) * 0.5)) continue;
      if (!best || c > best.confidence) best = { x: g.bx, z: g.bz, confidence: c, count: g.count };
    }
    return best;
  }

  /** Where to wait for you: the middle of a leg it has watched you use at least `minUses` times. */
  ambushSpot(minUses = 2) {
    let best = null;
    for (const g of this.legs) {
      const c = this.confidenceOf(g);
      if (g.count < minUses || c <= 0) continue;
      if (!best || c > best.confidence) best = { x: (g.ax + g.bx) / 2, z: (g.az + g.bz) / 2, confidence: c, count: g.count };
    }
    return best;
  }

  /** What it expects near (x, z): the most confident remembered spot within radius, or null. */
  anticipate(x, z, radius = ROUTINE.merge) {
    let best = null;
    for (const s of this.spots) {
      const c = this.confidenceOf(s);
      if (c <= 0 || Math.hypot(s.x - x, s.z - z) > radius) continue;
      if (!best || c > best.confidence) best = { ...s, confidence: c };
    }
    return best;
  }

  /** Its most confident memory (for the AI to go and check a spot it has seen you use). */
  strongest() {
    let best = null;
    for (const s of this.spots) { const c = this.confidenceOf(s); if (c > (best?.confidence ?? 0)) best = { ...s, confidence: c }; }
    return best;
  }

  update(dt) {
    this.time += dt;
    this.spots = this.spots.filter((s) => this.time < s.expiry);
    this.legs = this.legs.filter((g) => this.time < g.expiry);
  }
}
