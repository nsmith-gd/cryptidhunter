import * as THREE from 'three';

// Spare battery pickups: walk over one to pocket it (R swaps it into the flashlight).
export const BATTERY_SPOTS = [
  [3, -3], [-9, -9], [10, -20], [-14, 12], [16, 2],
];

export class BatteryPickups {
  constructor(scene, player, flashlight, spots = BATTERY_SPOTS) {
    this.player = player;
    this.flashlight = flashlight;
    this.items = spots.map(([x, z]) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.32, 8),
        new THREE.MeshStandardMaterial({ color: 0x2f6f2f, emissive: 0x0b2a0b, roughness: 0.6 }));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 6),
        new THREE.MeshStandardMaterial({ color: 0xc8c8c8, emissive: 0x303030 }));
      cap.position.y = 0.185;
      g.add(body, cap);
      g.position.set(x, 0.3, z);
      scene.add(g);
      return g;
    });
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    const p = this.player.position;
    for (const g of this.items) {
      if (!g.visible) continue;
      g.rotation.y += dt * 1.5;
      g.position.y = 0.3 + Math.sin(this.t * 2 + g.position.x) * 0.05;
      if (Math.hypot(g.position.x - p.x, g.position.z - p.z) < 1.0) {
        g.visible = false;
        this.flashlight.addSpare();
      }
    }
  }
}
