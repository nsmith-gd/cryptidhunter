import * as THREE from 'three';
import { groundAt } from '../maps/ground.js';

// Placeable bait (L0 greybox): press G to drop a bait cube on the ground in front of you.
// Cryptids within its scent range stop roaming and walk over to investigate it, linger while
// they eat, then the bait is gone. Each hunt starts with a few baits.
export const BAIT = {
  carried: 3,            // baits per hunt
  placeDistance: 1.6,    // metres in front of the player
  size: 0.35,
  scentRange: 45,        // cryptids this close (metres) smell it and come
  eatTime: 6,            // seconds a cryptid lingers at the bait before it's used up
  lifetime: 120,         // an untouched bait goes stale after this many seconds
};

export class BaitManager {
  constructor(scene, player, input) {
    this.scene = scene;
    this.player = player;
    this.carried = BAIT.carried;
    this.baits = [];
    this.geometry = new THREE.BoxGeometry(BAIT.size, BAIT.size, BAIT.size);
    this.material = new THREE.MeshStandardMaterial({ color: 0xb0413e, roughness: 0.7, emissive: 0x2a0806 });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && !e.repeat && input.locked) this.place();
    });
  }

  /** Drop a bait in front of the player. Returns the bait, or null if none left. */
  place() {
    if (this.carried <= 0) return null;
    this.carried--;
    const p = this.player;
    const x = p.position.x - Math.sin(p.yaw) * BAIT.placeDistance;
    const z = p.position.z - Math.cos(p.yaw) * BAIT.placeDistance;
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.position.set(x, (p.onTerrain === false ? p.position.y : groundAt(x, z)) + BAIT.size / 2, z);
    mesh.rotation.y = p.yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'bait';
    this.scene.add(mesh);
    const bait = { x, z, mesh, age: 0, eaten: 0, claimedBy: null, gone: false };
    this.baits.push(bait);
    return bait;
  }

  /** Active baits a cryptid could go for (used by the cryptid AI). */
  lures() { return this.baits.filter((b) => !b.gone); }

  consume(bait) {
    bait.gone = true;
    bait.mesh.removeFromParent();
  }

  /** New hunt: clear the ground and restock. */
  reset() {
    for (const b of this.baits) b.mesh.removeFromParent();
    this.baits.length = 0;
    this.carried = BAIT.carried;
  }

  update(dt) {
    for (const b of this.baits) {
      if (b.gone) continue;
      b.age += dt;
      if (b.age > BAIT.lifetime && !b.claimedBy) this.consume(b);
    }
    this.baits = this.baits.filter((b) => !b.gone);
  }
}
