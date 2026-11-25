import { NavGrid } from '../nav/navGrid.js';
import { CryptidAI } from './cryptidAI.js';

// Owns every cryptid in the level and the walkable grids they path on
// (one grid per body size, baked lazily from the map's colliders).
export class CryptidManager {
  constructor({ scene, colliders, halfSize, getPlayerPosition, lures = null, senses = null, calls = null }) {
    this.calls = calls;
    this.senses = senses ? { colliders, ...senses } : null;
    this.lures = lures;
    this.scene = scene;
    this.colliders = colliders;
    this.halfSize = halfSize;
    this.getPlayerPosition = getPlayerPosition;
    this.grids = new Map();
    this.cryptids = [];
  }

  gridFor(profile) {
    const key = `${profile.radius}|${profile.height}`;
    if (!this.grids.has(key)) {
      this.grids.set(key, new NavGrid(this.colliders, {
        halfSize: this.halfSize, agentRadius: profile.radius, agentHeight: profile.height,
      }));
    }
    return this.grids.get(key);
  }

  spawn(profile, x, z) {
    const c = new CryptidAI({
      scene: this.scene, grid: this.gridFor(profile), profile, x, z, getPlayerPosition: this.getPlayerPosition, lures: this.lures, senses: this.senses, calls: this.calls,
    });
    this.cryptids.push(c);
    return c;
  }

  clear() {
    for (const c of this.cryptids) c.dispose();
    this.cryptids.length = 0;
  }

  update(dt) {
    for (const c of this.cryptids) c.update(dt);
  }
}
