// Electrical interference around the creature (#145; GDD §5.3 "localized interference", §5.4 L08
// Mothman: an anomalous disruptor, not a predator). Pure: no three.js, no DOM.
//
// The creature carries a field. Its strength at a point is 1 within `inner` metres, fading to 0 at
// `outer`. Powered devices inside it misbehave by how strong it is where they are:
//   flicker   above the device's flicker level: drops out in irregular bursts
//   failed    above its fail level: dead. It stays dead until the field there has been below the
//             flicker level for `recover` seconds - walk out of range and it comes back.
// Only devices inside the field are touched (no global shutdown): a trail camera across the map
// keeps working while your torch dies. Analogue tools have no entry here and are never affected:
// the paper map and compass, and the film camera.

export const INTERFERENCE = Object.freeze({
  inner: 8,            // metres: full strength
  outer: 30,           // metres: no effect beyond
  recover: 1.5,        // seconds below flicker level before a failed device works again
  vertical: 0.4,       // height difference counts this much toward distance
  devices: Object.freeze({
    torch: { name: 'torch', flicker: 0.2, fail: 0.65 },
    nightVision: { name: 'night vision', flicker: 0.15, fail: 0.45 },
    recorder: { name: 'field recorder', flicker: 0.2, fail: 0.5 },
    trailCam: { name: 'trail camera', flicker: 0.25, fail: 0.5 },
    audioLure: { name: 'audio lure', flicker: 0.25, fail: 0.5 },
    gps: { name: 'GPS', flicker: 0.1, fail: 0.35 },
  }),
  analogue: Object.freeze(['paper map', 'compass', 'film camera']),
});

/** Field strength (0..1) of one source { x, y?, z, inner?, outer? } at point p { x, y?, z }. */
export function strengthAt(src, p) {
  // Height counts for less than ground distance: the field drops down from a high perch (#146).
  const d = Math.hypot(p.x - src.x, ((p.y ?? 0) - (src.y ?? 0)) * INTERFERENCE.vertical, p.z - src.z);
  const inner = src.inner ?? INTERFERENCE.inner, outer = src.outer ?? INTERFERENCE.outer;
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  const t = (d - inner) / (outer - inner);
  return 1 - t * t * (3 - 2 * t);
}

export class InterferenceField {
  /** sources(): the creatures' current field centres [{ x, y, z }] (empty when none is around). */
  constructor({ sources = () => [], cfg = INTERFERENCE } = {}) {
    this.sources = sources;
    this.cfg = cfg;
    this.state = new Map();      // device id -> { kind, status, calm, level }
    this.trace = [];             // { t, id, kind, from, to, level }
    this.time = 0;
  }

  level(p) { let m = 0; for (const s of this.sources()) m = Math.max(m, strengthAt(s, p)); return m; }

  /**
   * Advance. devices: [{ id, kind, x, y?, z }]. Returns Map id -> 'ok' | 'flicker' | 'failed'.
   * Unknown kinds (analogue tools) are always 'ok'.
   */
  update(dt, devices) {
    this.time += dt;
    const out = new Map();
    for (const d of devices) {
      const spec = this.cfg.devices[d.kind];
      if (!spec) { out.set(d.id, 'ok'); continue; }
      const level = this.level(d);
      const s = this.state.get(d.id) ?? { kind: d.kind, status: 'ok', calm: 0, level: 0 };
      let next = s.status;
      if (level >= spec.fail) { next = 'failed'; s.calm = 0; }
      else if (s.status === 'failed') {
        s.calm = level < spec.flicker ? s.calm + dt : 0;
        if (s.calm >= this.cfg.recover) next = level >= spec.flicker ? 'flicker' : 'ok';
      } else next = level >= spec.flicker ? 'flicker' : 'ok';
      if (next !== s.status) this.trace.push({ t: +this.time.toFixed(2), id: d.id, kind: d.kind, from: s.status, to: next, level: +level.toFixed(2) });
      s.status = next; s.level = level;
      this.state.set(d.id, s);
      out.set(d.id, next);
    }
    return out;
  }

  /** While flickering, is the device getting power right now? Irregular bursts, deterministic in time. */
  flickerOn(id, level = 0.5) {
    const h = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const v = Math.sin(this.time * 23 + h) + Math.sin(this.time * 9.7 + h * 2) + Math.sin(this.time * 3.1);
    return v > -0.4 + level * 1.6;     // the stronger the field, the longer the dropouts
  }
}
