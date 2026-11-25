import * as THREE from 'three';

// Mothman greybox placeholder: a sphere that circles high over its home area and
// is drawn toward the player while their flashlight is on.
export const MOTHMAN = {
  catchHits: 1,                      // if it ever reaches you, it takes you
  home: new THREE.Vector3(0, 0, -15),
  farRadius: 22, nearRadius: 4,      // orbit radius when ignoring / fully lured
  farHeight: 14, nearHeight: 3.5,    // orbit height when ignoring / fully lured
  orbitSpeed: 7,                     // metres per second along the circle
  lureRise: 0.12,                    // lure gained per second with the light on (~8s to full)
  lureFall: 0.15,                    // lure lost per second with the light off
  follow: 1.5,                       // how quickly it slides toward its target spot
};

export class Mothman {
  constructor(scene, player, flashlight) {
    this.player = player;
    this.flashlight = flashlight;
    this.lure = 0;                   // 0 = circling home, 1 = circling right over the player
    this.angle = 0;
    this.center = MOTHMAN.home.clone();

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3440, emissive: 0x1a1020, roughness: 0.8 }),
    );
    // Two red eye dots so it reads in the dark.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    for (const x of [-0.25, 0.25]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), eyeMat);
      eye.position.set(x, 0.15, 0.72);
      this.mesh.add(eye);
    }
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.update(0);
  }

  update(dt) {
    const M = MOTHMAN;
    this.lure = THREE.MathUtils.clamp(
      this.lure + (this.flashlight.on ? M.lureRise : -M.lureFall) * dt, 0, 1);

    // Orbit centre slides from its home toward the player as the lure builds.
    const p = this.player.position;
    const targetCenter = new THREE.Vector3().lerpVectors(M.home, new THREE.Vector3(p.x, 0, p.z), this.lure);
    this.center.lerp(targetCenter, 1 - Math.exp(-M.follow * dt));

    const radius = THREE.MathUtils.lerp(M.farRadius, M.nearRadius, this.lure);
    const height = THREE.MathUtils.lerp(M.farHeight, M.nearHeight, this.lure);
    this.angle += (M.orbitSpeed / radius) * dt;
    this.mesh.position.set(
      this.center.x + Math.cos(this.angle) * radius,
      height + Math.sin(this.angle * 2.3) * 0.6,   // slight bob
      this.center.z + Math.sin(this.angle) * radius,
    );
    // Face the player.
    this.mesh.lookAt(p.x, p.y + 1.6, p.z);
  }

  distanceToPlayer() {
    return this.mesh.position.distanceTo(new THREE.Vector3(this.player.position.x, this.player.position.y + 1.6, this.player.position.z));
  }
}
