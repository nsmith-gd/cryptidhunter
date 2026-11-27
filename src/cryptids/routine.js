// Routine memory (#107; GDD 5.3 routine channel: "repeated actions actually witnessed or inferred
// from traces; bounded confidence and decay; no raw input spying").
//
// A creature remembers WHERE it has seen you (your route), and where it found traces you left
// (food you ate, blood). Each sighting near a remembered spot raises its confidence (seen: +0.25,
// inferred from a trace: +0.12), never above 1; confidence fades as the memory ages and the spot is
// forgotten at its expiry (seen 300 s, trace 180 s). It can only anticipate a place it has a memory
// of: a route you took while it never saw you, and left no trace on, can't be anticipated.

export const ROUTINE = Object.freeze({
  merge: 8,              // metres: a new observation this close strengthens an existing spot
  gain: { seen: 0.25, trace: 0.12 },
  ttl: { seen: 300, trace: 180 },
  every: 3,              // seconds between route samples while it keeps watching you
  size: 24,
});

export class RoutineMemory {
  constructor() { this.spots = []; this.time = 0; this.lastSample = -Infinity; this.log = []; }

  /** Record a witnessed or inferred action at (x, z). via: 'seen' | 'trace'. */
  observe(kind, x, z, via = 'seen') {
    const s = this.spots.find((p) => p.kind === kind && Math.hypot(p.x - x, p.z - z) < ROUTINE.merge);
    const ttl = ROUTINE.ttl[via], gain = ROUTINE.gain[via];
    if (s) {
      s.base = Math.min(1, this.confidenceOf(s) + gain);
      s.x = (s.x * s.count + x) / (s.count + 1); s.z = (s.z * s.count + z) / (s.count + 1);
      s.count++; s.t = this.time; s.expiry = Math.max(s.expiry, this.time + ttl); s.via = s.via === 'seen' ? 'seen' : via;
      return s;
    }
    const spot = { kind, x, z, via, base: gain, count: 1, t: this.time, expiry: this.time + ttl };
    this.spots.push(spot);
    this.log.push({ t: +this.time.toFixed(1), kind, via, x: +x.toFixed(1), z: +z.toFixed(1) });
    if (this.spots.length > ROUTINE.size) { this.spots.sort((a, b) => this.confidenceOf(b) - this.confidenceOf(a)); this.spots.length = ROUTINE.size; }
    return spot;
  }

  /** Confidence fades linearly from its base to 0 at expiry. */
  confidenceOf(s) { return Math.max(0, Math.min(1, s.base * (s.expiry - this.time) / Math.max(1e-6, s.expiry - s.t))); }

  /** Sample your position while it watches you (throttled). */
  sampleSeen(p) {
    if (this.time - this.lastSample < ROUTINE.every) return null;
    this.lastSample = this.time;
    return this.observe('route', p.x, p.z, 'seen');
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
  }
}
