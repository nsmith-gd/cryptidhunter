import * as THREE from 'three';
import { sel, seq, when, act, tier, Brain, OK, RUN, FAIL } from './brains/bt.js';

// CHUPACABRA — behaviour tree, lore first (Puerto Rico 1995, then Texas ranch country):
//  · The "goat-sucker": a low, spined night predator that drains livestock through puncture
//    wounds. It is hungry above all else — blood bait stops it in its tracks.
//  · It hunts like a predator: it never comes at you while you face it; it creeps in when
//    your back is turned, circles to get behind you, then coils and leaps.
//  · Reported to hiss before it strikes, and to shy from bright light.
// Rules this teaches the player:
//  1. Never turn your back on it — while you watch it, it freezes.
//  2. A hiss means it's coiling to pounce: turn and face it NOW.
//  3. Bright light close up drives it back (not at the highest level).
//  4. Bait buys you time: it can't resist feeding.
// Escalation: at higher levels it's faster, coils quicker, flanks, and stops fearing the light.
export const CHUPA_TIERS = {
  1: { stalkSpeed: 2.0, windup: 0.6, flank: false, lightRepel: 12, retreatDistance: 18 },
  2: { stalkSpeed: 2.6, windup: 0.45, flank: true, lightRepel: 8, retreatDistance: 16 },
  3: { stalkSpeed: 3.0, windup: 0.35, flank: true, lightRepel: 0, retreatDistance: 11 },
};
export const CHUPA = {
  homeLevel: 3,            // ranch country: the third and harshest hunting ground
  scentRange: 30,          // smells blood bait this far away
  eatTime: 8,
  catchHits: 3,            // small: you can shake it off twice; the third charge that lands ends the hunt
  spawn: new THREE.Vector3(14, 0, 22),
  size: new THREE.Vector3(0.6, 0.55, 1.1),   // width, height, length (metres)
  stalkSpeed: 2.6,         // slower than walking, so you can outpace it
  chargeRange: 6,          // starts a charge when this close and unseen
  chargeWindup: 0.35,      // crouch-before-the-leap pause (seconds)
  chargeSpeed: 11,
  chargeMaxTime: 1.4,
  hitRadius: 0.9,
  knockback: 4,            // metres the player is shoved
  retreatDistance: 16,     // where it slinks off to after a hit
  retreatSpeed: 5,
  viewAngle: THREE.MathUtils.degToRad(38),  // half-angle of the "you're watching me" cone
  viewDistance: 35,
};

const _v = new THREE.Vector3();
const _ray = new THREE.Ray();

export class Chupacabra {
  constructor(scene, player, camera, colliders, { level = null, lures = null, flashlight = null, onEvent = null } = {}) {
    this.level = level ?? CHUPA.homeLevel;
    this.lures = lures;          // bait it can smell: { lures(), consume(b) }
    this.flashlight = flashlight;
    this.onEvent = onEvent;
    this.bait = null; this.eatLeft = 0;
    this.name = 'Chupacabra';
    this.player = player;
    this.camera = camera;
    this.colliders = colliders;
    this.state = 'stalk';    // stalk | windup | charge | retreat
    this.timer = 0;
    this.hits = 0;
    this.watched = false;
    this.chargeDir = new THREE.Vector3();
    this.retreatTo = new THREE.Vector3();

    const s = CHUPA.size;
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s.x, s.y, s.z),
      new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 0.9 }),
    );
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
    for (const x of [-0.15, 0.15]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), eyeMat);
      eye.position.set(x, 0.1, s.z / 2 + 0.01);
      this.mesh.add(eye);
    }
    this.mesh.castShadow = true;
    this.mesh.position.copy(CHUPA.spawn);
    this.mesh.position.y = s.y / 2;
    scene.add(this.mesh);

    // Red screen flash when it hits you.
    this.flash = Object.assign(document.createElement('div'), { textContent: 'CHARGED!' });
    Object.assign(this.flash.style, {
      position: 'fixed', inset: '0', background: 'rgba(160,0,0,0.45)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px',
      pointerEvents: 'none', opacity: '0', transition: 'opacity .5s',
    });
    document.body.appendChild(this.flash);
    this.brain = this.buildBrain();
  }

  get T() { return CHUPA_TIERS[Math.min(3, Math.max(1, this.level))]; }
  emit(type, data = {}) { this.onEvent?.(type, { name: 'Chupacabra', ...data }); }
  get pathText() { return this.brain.pathText; }

  /** Your flashlight beam is on it (and it's close enough to be blinded). */
  lit(maxDist) {
    if (!maxDist || !this.flashlight?.on) return false;
    const to = this.position.clone().sub(this.camera.position);
    return to.length() < maxDist && this.camera.getWorldDirection(new THREE.Vector3()).angleTo(to) < THREE.MathUtils.degToRad(20);
  }

  nearestBait() {
    if (!this.lures) return null;
    let best = null, bd = CHUPA.scentRange;
    for (const b of this.lures.lures()) {
      if (b.gone || (b.claimedBy && b.claimedBy !== this)) continue;
      const d = Math.hypot(b.x - this.position.x, b.z - this.position.z);
      if (d < bd) { best = b; bd = d; }
    }
    return best;
  }

  buildBrain() {
    const c = this;
    const root = sel('Chupacabra',
      seq('Pouncing', when('leaping', () => c.state === 'charge'), act('leap', () => c.tickCharge())),
      seq('Coiling', when('coiling', () => c.state === 'windup'), act('hiss and coil', () => c.tickWindup())),
      seq('Slinking off', when('retreating', () => c.state === 'retreat'), act('slink off', () => c.tickRetreat())),
      seq('Hungry', when('smells bait', () => (c.bait = c.bait && !c.bait.gone ? c.bait : c.nearestBait())), act('drain the bait', () => c.tickFeed())),
      seq('Blinded', when('beam on it, close', () => c.lit(c.T.lightRepel)), act('back out of the light', () => c.tickBackoff())),
      seq('Watched', when('you are facing it', () => c.watched), act('freeze', () => { c.enter2('freeze'); return RUN; })),
      seq('In range', when('close and unseen', () => c.dist <= CHUPA.chargeRange), act('coil to pounce', () => { c.enter('windup'); c.emit('hiss'); return RUN; })),
      tier(2, seq('Flank', when('your back is turned', () => c.T.flank && c.dist < 16), act('circle behind you', () => c.tickFlank()))),
      act('stalk', () => c.tickStalk()),
    );
    return new Brain(root, { get level() { return c.level; } });
  }

  enter2(state) { if (this.state !== state) this.enter(state); }

  tickStalk() {
    this.enter2('stalk');
    this.face(this.toPlayer);
    this.move(this.toPlayer.clone().normalize(), this.T.stalkSpeed * this.dt);
    return RUN;
  }

  // Aim for a point behind you (opposite to where you're looking), closing in as it goes.
  tickFlank() {
    this.enter2('flank');
    const p = this.player.position, f = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const behind = new THREE.Vector3(p.x - f.x * 3, 0, p.z - f.z * 3);
    const dir = behind.sub(this.position).setY(0);
    if (dir.length() < 0.5) dir.copy(this.toPlayer);
    this.face(dir);
    this.move(dir.normalize(), this.T.stalkSpeed * 1.15 * this.dt);
    return RUN;
  }

  tickWindup() {
    this.face(this.toPlayer);
    if (this.watched) { this.enter('freeze'); return RUN; }   // you turned in time
    if (this.timer >= this.T.windup) { this.chargeDir.copy(this.toPlayer).normalize(); this.enter('charge'); }
    return RUN;
  }

  tickCharge() {
    this.move(this.chargeDir, CHUPA.chargeSpeed * this.dt);
    if (this.flatToPlayer().length() < CHUPA.hitRadius) this.hitPlayer();
    else if (this.timer >= CHUPA.chargeMaxTime) this.enter('stalk');
    return RUN;
  }

  tickRetreat() {
    const away = new THREE.Vector3(this.retreatTo.x - this.position.x, 0, this.retreatTo.z - this.position.z);
    if (away.length() < 0.5 || this.timer > 5) { this.enter('stalk'); return OK; }
    this.face(away);
    this.move(away.normalize(), CHUPA.retreatSpeed * this.dt);
    return RUN;
  }

  tickBackoff() {
    this.enter2('backoff');
    const away = this.toPlayer.clone().negate().normalize();
    this.face(this.toPlayer);
    this.move(away, CHUPA.retreatSpeed * 0.7 * this.dt);
    return RUN;
  }

  tickFeed() {
    const b = this.bait;
    const to = new THREE.Vector3(b.x - this.position.x, 0, b.z - this.position.z);
    if (to.length() > 0.8) {
      this.enter2('feed');
      b.claimedBy = this;
      this.face(to);
      this.move(to.normalize(), this.T.stalkSpeed * 1.4 * this.dt);
      this.eatLeft = CHUPA.eatTime;
      return RUN;
    }
    this.enter2('feed');
    this.eatLeft -= this.dt;
    if (this.eatLeft <= 0) { this.lures.consume(b); this.bait = null; this.emit('fed'); return OK; }
    return RUN;
  }

  get position() { return this.mesh.position; }

  // Watched = inside the camera's view cone, close enough, and not hidden behind a box.
  isWatched() {
    const cam = this.camera.position;
    const toMe = _v.copy(this.position).sub(cam);
    const dist = toMe.length();
    if (dist > CHUPA.viewDistance) return false;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    if (fwd.angleTo(toMe) > CHUPA.viewAngle) return false;
    _ray.set(cam, toMe.normalize());
    const hit = new THREE.Vector3();
    for (const c of this.colliders) {
      if (_ray.intersectBox(c, hit) && hit.distanceTo(cam) < dist - 0.6) return false;
    }
    return true;
  }

  flatToPlayer() {
    const p = this.player.position;
    return new THREE.Vector3(p.x - this.position.x, 0, p.z - this.position.z);
  }

  update(dt) {
    this.dt = dt;
    this.watched = this.isWatched();
    this.toPlayer = this.flatToPlayer();
    this.dist = this.toPlayer.length();
    this.timer += dt;
    this.brain.tick();
    // Squash during wind-up so the leap is telegraphed.
    this.mesh.scale.y = this.state === 'windup' ? 0.7 : 1;
  }

  enter(state) { this.state = state; this.timer = 0; }

  face(dir) { this.mesh.rotation.y = Math.atan2(dir.x, dir.z); }

  hitPlayer() {
    this.hits++;
    this.onHit?.();
    const shove = this.chargeDir.clone().multiplyScalar(CHUPA.knockback);
    this.player.velocity.x += shove.x * 3;
    this.player.velocity.z += shove.z * 3;
    this.flash.style.transition = 'none';
    this.flash.style.opacity = '1';
    requestAnimationFrame(() => { this.flash.style.transition = 'opacity .8s'; this.flash.style.opacity = '0'; });
    this.retreatTo.copy(this.position).addScaledVector(this.chargeDir, -this.T.retreatDistance);
    this.enter('retreat');
  }

  // Slide along obstacles one axis at a time.
  move(dir, amount) {
    const half = Math.max(CHUPA.size.x, CHUPA.size.z) / 2 * 0.8;
    for (const axis of ['x', 'z']) {
      const prev = this.position[axis];
      this.position[axis] += dir[axis] * amount;
      const box = new THREE.Box3(
        new THREE.Vector3(this.position.x - half, 0.01, this.position.z - half),
        new THREE.Vector3(this.position.x + half, CHUPA.size.y, this.position.z + half));
      if (this.colliders.some((c) => c.intersectsBox(box))) this.position[axis] = prev;
    }
  }
}
