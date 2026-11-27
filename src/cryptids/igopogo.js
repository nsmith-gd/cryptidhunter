import * as THREE from 'three';

// IGOPOGO (L03, Lake Simcoe; GDD §1.5, §5.4 "cyclic surfacing and rest; avoids noisy shoreline
// activity"): a greybox proxy. It lives in the lake and never leaves it. On a seeded cycle it
// rises in one of the map's surfacing zones for a brief window (head, neck and two humps above
// the water), then sinks and rests. Noise carries over water: if the shore near the zone it's
// about to use is noisy, it skips that window; if the shore gets noisy while it's up, it dives at
// once (the window is cut short). Either way it stays wary for a while before the next rise.
// The player's job: pick a quiet dry vantage, wait, and have the camera ready.
//
// Two parts: IgopogoSchedule (pure: timing, zone choice, noise rules, trace) and Igopogo (the
// greybox body that follows the schedule, plus the photo subject while it's up).

export const IGOPOGO = {
  firstWindow: [60, 150],    // s of hunt clock until the first rise
  gap: [150, 260],           // s resting between windows
  duration: [22, 36],        // s a window lasts if undisturbed
  diveNoise: 0.3,            // noise heard at the zone that makes it dive / skip a window
  cancelLead: 15,            // s before a rise that shore noise can still call it off
  wary: [80, 140],           // extra s of rest after it was disturbed
  rise: 3,                   // s to come up or go down
  hearOverWater: 3,          // noise carries this many times further across water than through woods
  hearFloor: 15,             // metres: anything this close to the zone is heard
};

function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (r, [a, b]) => a + r() * (b - a);

/** How loud a sound at (x, z) with `level` (0..1) carrying `radius` m is at the zone centre. */
export function heardAt(zone, { x, z, level, radius }) {
  if (!(level > 0)) return 0;
  const d = Math.max(0, Math.hypot(x - zone.x, z - zone.z) - zone.r);
  const reach = Math.max(IGOPOGO.hearFloor, radius * IGOPOGO.hearOverWater);
  return d >= reach ? 0 : level * (1 - d / reach);
}

export class IgopogoSchedule {
  /** zones: [{ id, x, z, r }] (surfacing zones, all in deep water). */
  constructor({ seed = 1, zones, cfg = IGOPOGO }) {
    this.r = rng(seed * 7919 + 13);
    this.zones = zones;
    this.cfg = cfg;
    this.state = 'down';           // down | up
    this.trace = [];               // { t, type: 'plan'|'surface'|'dive'|'withdraw'|'cancel', zone, why? }
    this.windows = [];             // completed windows { zone, start, end, cut }
    this.plan(0, between(this.r, cfg.firstWindow));
  }

  plan(t, delay) {
    const z = this.zones[Math.floor(this.r() * this.zones.length) % this.zones.length];
    this.next = { zone: z, start: +(t + delay).toFixed(1), length: +between(this.r, this.cfg.duration).toFixed(1) };
    this.trace.push({ t: +t.toFixed(1), type: 'plan', zone: z.id, at: this.next.start });
  }

  get zone() { return this.next.zone; }

  /** Advance to hunt time t. noiseAt(zone) -> 0..1 heard there now (player and camp). */
  update(t, noiseAt = () => 0) {
    const n = this.next, c = this.cfg;
    const heard = noiseAt(n.zone);
    if (this.state === 'down') {
      if (t >= n.start - c.cancelLead && t < n.start && heard >= c.diveNoise) {
        this.trace.push({ t: +t.toFixed(1), type: 'cancel', zone: n.zone.id, why: `noisy shore (${heard.toFixed(2)})` });
        this.plan(t, between(this.r, c.wary) + between(this.r, c.gap));
      } else if (t >= n.start) {
        this.state = 'up'; this.upAt = t;
        this.trace.push({ t: +t.toFixed(1), type: 'surface', zone: n.zone.id });
      }
    } else if (this.state === 'up') {
      const disturbed = heard >= c.diveNoise && t - this.upAt > 0.5;
      if (disturbed || t >= this.upAt + n.length) {
        this.state = 'down';
        this.windows.push({ zone: n.zone.id, start: +this.upAt.toFixed(1), end: +t.toFixed(1), cut: disturbed });
        this.trace.push({ t: +t.toFixed(1), type: disturbed ? 'withdraw' : 'dive', zone: n.zone.id, ...(disturbed ? { why: `noisy shore (${heard.toFixed(2)})` } : {}) });
        this.plan(t, (disturbed ? between(this.r, c.wary) : 0) + between(this.r, c.gap));
      }
    }
    return this.state;
  }

  /** Where it is (always inside its zone, i.e. in the lake): a slow drift around the zone centre. */
  position(t) {
    const z = this.next.zone, a = t * 0.05 + z.x;
    return { x: z.x + Math.cos(a) * z.r * 0.4, z: z.z + Math.sin(a * 1.3) * z.r * 0.4 };
  }
}

// ---- greybox body ------------------------------------------------------------------------------
export class Igopogo {
  constructor({ scene, zones, seed = 1, waterY = 0 }) {
    this.name = 'Igopogo';
    this.schedule = new IgopogoSchedule({ seed, zones });
    this.waterY = waterY;
    this.riseLevel = 0;            // 0 under, 1 fully up
    const mat = new THREE.MeshLambertMaterial({ color: 0x2c3a2a, flatShading: true });
    const g = new THREE.Group();
    g.name = 'igopogo-proxy';
    const seg = (r, len, x, y, z, rx = 0) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
    seg(0.45, 1.2, 0, 0.15, 1.4, Math.PI / 2);                 // rear hump
    seg(0.55, 1.4, 0, 0.3, -0.4, Math.PI / 2);                 // front hump
    seg(0.28, 1.6, 0, 1.1, -1.7, -0.35);                        // neck
    const head = seg(0.3, 0.55, 0, 2.0, -2.15, Math.PI / 2.4);  // long head, snout forward
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8d860 });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), eyeMat); e.position.set(s * 0.2, 0.15, -0.15); head.add(e); }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    this.mesh = g;
    this.head = head;
    scene.add(g);
    this.update(0, 0);
  }

  get trace() { return this.schedule.trace; }
  get up() { return this.riseLevel > 0.35; }

  /** t: hunt clock (s); dt: step; noiseAt(zone) -> heard noise. */
  update(t, dt, noiseAt) {
    const s = this.schedule.update(t, noiseAt);
    const target = s === 'up' ? 1 : 0;
    this.riseLevel += Math.sign(target - this.riseLevel) * Math.min(Math.abs(target - this.riseLevel), dt / IGOPOGO.rise);
    const p = this.schedule.position(t);
    const z = this.schedule.zone;
    this.mesh.position.set(p.x, this.waterY - 2.6 + this.riseLevel * 2.6, p.z);
    this.mesh.rotation.y = Math.atan2(z.x - p.x, z.z - p.z) + Math.PI + t * 0.02;
    this.mesh.visible = this.riseLevel > 0.02;
  }

  /** Photo subject while it's up (the head and neck above water). */
  subject() {
    if (!this.up) return null;
    const c = new THREE.Vector3(); this.head.getWorldPosition(c);
    return { name: 'Igopogo', object3d: this.mesh, radius: 0.9, center: c };
  }
}
