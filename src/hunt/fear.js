import * as THREE from 'three';

// Fear (L1): 0 calm .. 100 terrified.
//  Rises:  standing in the dark (no torch, no lamp nearby), a cryptid close by (faster the closer),
//          and sudden scares (a cryptid getting near, or bolting nearby) that spike it at once.
//  Falls:  in light (torch on, faster near a lamp or fire), fastest in the safe zone at the van.
//  Effect: above SWAY_START the view sways (breathing + tremor) — it throws off your aim and
//          blurs photos (PhotoCamera reads swaySpeed).
export const FEAR = {
  darkRise: 4,            // per second in the dark
  nearRange: 22,          // metres: cryptids closer than this frighten you
  nearRise: 16,           // per second with a cryptid right next to you (scaled by closeness)
  torchFall: 2,           // per second with your torch on and nothing near
  lampFall: 9,            // per second standing in lamp/fire light
  safeFall: 15,           // per second in a safe interior (van, cabin, tent)
  safeRadius: 8,          // around the van (other safe zones carry their own radius)
  scareRange: 10,         // a cryptid coming this close is a jump scare...
  scareAmount: 25,
  boltScare: 12,          // ...and one bolting away nearby is a smaller one
  scareCooldown: 20,      // seconds before the same cryptid can jump-scare you again
  swayStart: 35,          // fear above this sways the view
  swayMaxDeg: 3.2,        // shake amplitude at 100 fear (degrees) — what the photo feels
  screenSway: 0.5,        // share of that shake you actually see (comfort; 0 in VR)
};

export class Fear {
  /**
   * getThreats: () => [{ id, x, z, state? }] — cryptids that can frighten you.
   * safeZone: { x, z } (the extraction point). safeZones: [{ x, z, r, name }] safe interiors
   * (cabin, tent). screenSway: share of the shake shown on screen (0 for VR).
   * scene: scanned for lamps (PointLights).
   */
  constructor({ scene, player, flashlight, camera, getThreats, safeZone, safeZones = [], screenSway = FEAR.screenSway }) {
    this.safeZones = safeZones;
    this.screenSway = screenSway;
    this.scene = scene;
    this.player = player;
    this.flashlight = flashlight;
    this.camera = camera;
    this.getThreats = getThreats;
    this.safeZone = safeZone;
    this.value = 0;
    this.time = 0;
    this.lastScare = new Map();   // threat id -> time of last jump scare
    this.wasNear = new Map();     // threat id -> was inside scare range last frame
    this.lastState = new Map();
    this.swayYaw = 0; this.swayPitch = 0; this.swayTime = 0;
    this.swaySpeed = 0;           // degrees per second the view is drifting from sway
    this.lastReason = '';
    this.lamps = [];
    this.refreshLamps();
  }

  /** Re-scan the scene for fixed lamps (call if lights are added later). */
  refreshLamps() {
    this.lamps = [];
    this.scene.traverse((o) => { if (o.isPointLight && o.distance > 0) this.lamps.push(o); });
  }

  get level() { return this.value / 100; }

  /** 0..1 how lit the player is by fixed lamps (not the torch). */
  lampLight() {
    const p = this.player.position;
    let best = 0;
    const w = new THREE.Vector3();
    for (const l of this.lamps) {
      if (!l.visible || l.intensity <= 0) continue;
      l.getWorldPosition(w);
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      best = Math.max(best, 1 - d / (l.distance * 0.6));
    }
    return Math.max(0, Math.min(1, best));
  }

  torchOn() { return this.flashlight.on && (this.flashlight.battery ?? 1) > 0; }

  inSafeZone() {
    const p = this.player.position, s = this.safeZone;
    if (s && Math.hypot(p.x - s.x, p.z - s.z) < FEAR.safeRadius) return true;
    return this.safeZones.some((z) => Math.hypot(p.x - z.x, p.z - z.z) < z.r);
  }

  /** Spike fear right now (other systems can call this: wood-knocks, roars, ...). */
  scare(amount = FEAR.scareAmount, why = 'scare') {
    this.value = Math.min(100, this.value + amount);
    this.lastReason = why;
  }

  update(dt) {
    this.time += dt;
    const p = this.player.position;
    let rate = 0, near = 0;
    const reasons = [];

    for (const t of this.getThreats()) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < FEAR.nearRange) near = Math.max(near, 1 - d / FEAR.nearRange);
      // Jump scare: crossing into scare range (per cryptid, with a cooldown).
      const inside = d < FEAR.scareRange;
      const last = this.lastScare.get(t.id) ?? -Infinity;
      if (inside && !this.wasNear.get(t.id) && this.time - last > FEAR.scareCooldown) {
        this.scare(FEAR.scareAmount, `${t.id} close`);
        this.lastScare.set(t.id, this.time);
      }
      this.wasNear.set(t.id, inside);
      // Something big crashing away through the trees nearby.
      if (t.state === 'flee' && this.lastState.get(t.id) !== 'flee' && d < FEAR.nearRange) this.scare(FEAR.boltScare, `${t.id} bolted`);
      this.lastState.set(t.id, t.state);
    }

    const lamp = this.lampLight(), torch = this.torchOn(), safe = this.inSafeZone();
    const dark = !torch && lamp < 0.3 && !safe; // inside a tent/cabin/van the dark isn't frightening
    if (dark) { rate += FEAR.darkRise; reasons.push('dark'); }
    if (near > 0) { rate += FEAR.nearRise * near * near; reasons.push('cryptid near'); }
    if (near === 0) {
      if (safe) { rate -= FEAR.safeFall; reasons.push('safe'); }
      else if (lamp >= 0.3) { rate -= FEAR.lampFall * lamp; reasons.push('lamplight'); }
      else if (torch) { rate -= FEAR.torchFall; reasons.push('torch'); }
    }
    this.value = Math.max(0, Math.min(100, this.value + rate * dt));
    this.rate = rate;
    this.reasons = reasons;
  }

  /** Fear shake (call after player.update each frame). The full shake blurs photos (swaySpeed);
   *  only screenSway of it is added to the view, to keep it comfortable (none in VR). */
  applySway(dt) {
    const k = Math.max(0, (this.value - FEAR.swayStart) / (100 - FEAR.swayStart));
    const amp = THREE.MathUtils.degToRad(FEAR.swayMaxDeg) * k * k;
    const t = (this.swayTime += dt);
    // Slow heavy breathing plus a faster, irregular tremor.
    const yaw = amp * (0.7 * Math.sin(t * 1.3) + 0.3 * Math.sin(t * 7.1 + 1.7) * Math.sin(t * 2.3));
    const pitch = amp * (0.6 * Math.sin(t * 1.9 + 0.8) + 0.4 * Math.sin(t * 8.3) * Math.sin(t * 1.1 + 2));
    if (dt > 0) this.swaySpeed = THREE.MathUtils.radToDeg(Math.hypot(yaw - this.swayYaw, pitch - this.swayPitch)) / dt;
    this.swayYaw = yaw; this.swayPitch = pitch;
    this.camera.rotation.y += yaw * this.screenSway;
    this.camera.rotation.x += pitch * this.screenSway;
    // The part of the hand's shake the screen doesn't show (comfort share, reduced-shake setting,
    // VR). The photo camera adds it back, so evidence always sees the full shake (#77).
    this.hiddenSway = { yaw: yaw * (1 - this.screenSway), pitch: pitch * (1 - this.screenSway) };
  }
}
