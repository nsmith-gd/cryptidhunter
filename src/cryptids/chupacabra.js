import * as THREE from 'three';

// Chupacabra greybox placeholder: a low box that creeps after the player only while
// they aren't looking at it, and charges once it gets within range unseen.
export const CHUPA = {
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
  constructor(scene, player, camera, colliders) {
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
    this.watched = this.isWatched();
    const toPlayer = this.flatToPlayer();
    const dist = toPlayer.length();
    this.timer += dt;

    switch (this.state) {
      case 'stalk':
        if (this.watched) break;              // freezes while you look at it
        if (dist <= CHUPA.chargeRange) { this.enter('windup'); break; }
        this.face(toPlayer);
        this.move(toPlayer.normalize(), CHUPA.stalkSpeed * dt);
        break;
      case 'windup':
        this.face(toPlayer);
        if (this.watched) { this.enter('stalk'); break; }   // caught it in time
        if (this.timer >= CHUPA.chargeWindup) {
          this.chargeDir.copy(toPlayer).normalize();
          this.enter('charge');
        }
        break;
      case 'charge': {
        this.move(this.chargeDir, CHUPA.chargeSpeed * dt);
        if (this.flatToPlayer().length() < CHUPA.hitRadius) this.hitPlayer();
        else if (this.timer >= CHUPA.chargeMaxTime) this.enter('stalk');
        break;
      }
      case 'retreat': {
        const away = new THREE.Vector3(this.retreatTo.x - this.position.x, 0, this.retreatTo.z - this.position.z);
        if (away.length() < 0.5 || this.timer > 5) { this.enter('stalk'); break; }
        this.face(away);
        this.move(away.normalize(), CHUPA.retreatSpeed * dt);
        break;
      }
    }
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
    this.retreatTo.copy(this.position).addScaledVector(this.chargeDir, -CHUPA.retreatDistance);
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
