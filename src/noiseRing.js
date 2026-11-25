import * as THREE from 'three';

// Debug: a ring on the ground showing how far the player's noise carries, plus the HUD noise bar.
// Toggle with N.
export class NoiseRing {
  constructor(scene, player) {
    this.player = player;
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc9a0ff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.mesh.visible = false;
    scene.add(this.mesh);
    addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat) this.enabled = !this.enabled; });
    this.enabled = false;
  }

  update() {
    const p = this.player;
    this.mesh.visible = this.enabled && p.noiseRadius > 0.1;
    this.mesh.position.set(p.position.x, 0.03, p.position.z);
    this.mesh.scale.setScalar(Math.max(0.1, p.noiseRadius));
  }
}
