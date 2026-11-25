import * as THREE from 'three';
import { DECAL_OFFSET } from '../maps/terrainPainter.js';

// Level flow (L1): at the start of a hunt, pick where the cryptid beds down and where its fresh
// trail starts from the map's spawn zones, then let it actually walk that route (fast-forwarded)
// so the footprints, hair and scratches lie along its real path and the clue hints point the
// right way. Maps without zones keep their single spawn point and no head start.
export const FLOW = {
  prerollSpeed: 4.5,   // m/s while fast-forwarding its walk (so the oldest prints are still fresh)
  prerollStep: 1 / 20, // s per simulation step
  prerollMax: 240,     // s of simulated walking at most
};

export class LevelFlow {
  constructor({ scene, map, rand = Math.random }) {
    this.scene = scene;
    this.map = map;
    this.rand = rand;
    this.zones = map.spawnZones ?? null;
    this.cryptidZone = null;
    this.clueZone = null;
    this.preroll = null;     // { from, to, metres, seconds, clues }
    this.debugGroup = null;
  }

  pick(list) { return list[Math.floor(this.rand() * list.length)]; }

  /** A walkable point inside a zone (falls back to its centre). */
  pointIn(zone, grid) {
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * zone.r;
      const p = grid?.sample?.(zone.x + Math.cos(a) * r, zone.z + Math.sin(a) * r, 2);
      if (p && Math.hypot(p.x - zone.x, p.z - zone.z) <= zone.r + 1) return p;
    }
    return grid?.sample?.(zone.x, zone.z, zone.r) ?? { x: zone.x, z: zone.z };
  }

  /**
   * Spawns the cryptid for this hunt. With zones: at the start of its trail, then walks it to
   * its bed-down zone while the clue trail records. Call after ClueTrails and the TrailReader
   * exist so the dropped clues get their route anchors.
   */
  spawnCryptid({ cryptids, profile, clueTrails, clues }) {
    const zones = this.zones?.[profile.id];
    if (!zones?.length) {
      const s = this.map.spawns?.[profile.id] ?? { x: 10, z: -25 };
      return cryptids.spawn(profile, s.x, s.z);
    }
    const grid = cryptids.gridFor(profile);
    this.cryptidZone = this.pick(zones);
    const bed = this.pointIn(this.cryptidZone, grid);
    const clueZones = this.zones.clues ?? [];
    if (!clueZones.length) return cryptids.spawn(profile, bed.x, bed.z);

    this.clueZone = this.pick(clueZones);
    const start = this.pointIn(this.clueZone, grid);
    const c = cryptids.spawn(profile, start.x, start.z);
    if (!c.agent.setDestination(bed.x, bed.z)) {
      // No route (shouldn't happen on a connected map): just put it to bed, no head start.
      c.agent.x = bed.x; c.agent.z = bed.z; c.agent.stop();
      c.home = { x: bed.x, z: bed.z };
      return c;
    }
    // Fast-forward its walk: clue trail records and drops clues, clues age as they would have.
    const before = clues.clues.length;
    c.agent.speed = FLOW.prerollSpeed;
    let t = 0, metres = 0, last = { x: c.agent.x, z: c.agent.z };
    clueTrails.update();
    let check = { x: c.agent.x, z: c.agent.z, t: 0 }, stuck = 0;
    while (c.agent.hasPath && t < FLOW.prerollMax) {
      c.agent.update(FLOW.prerollStep);
      c.syncMesh();
      metres += Math.hypot(c.agent.x - last.x, c.agent.z - last.z);
      last = { x: c.agent.x, z: c.agent.z };
      clueTrails.update();
      clues.update(FLOW.prerollStep);
      t += FLOW.prerollStep;
      // Wedged on a corner (it happens in tight gaps)? Re-plan; if that doesn't free it, hop to
      // the next point on its own route. This all happens before the player arrives, unseen.
      if (t - check.t >= 2) {
        if (Math.hypot(c.agent.x - check.x, c.agent.z - check.z) < 1) {
          stuck++;
          if (stuck % 2 === 1) c.agent.setDestination(bed.x, bed.z);
          else {
            const next = c.agent.path?.[Math.min(c.agent.index + 1, c.agent.path.length - 1)];
            if (next) { c.agent.x = next.x; c.agent.z = next.z; clueTrails.update(); c.agent.setDestination(bed.x, bed.z); }
          }
        }
        check = { x: c.agent.x, z: c.agent.z, t };
      }
    }
    c.agent.stop();
    c.agent.speed = profile.roamSpeed;
    c.home = { x: c.agent.x, z: c.agent.z };
    c.enterRoam?.('bedded down');
    this.preroll = { from: start, to: { x: c.agent.x, z: c.agent.z }, metres: Math.round(metres), seconds: Math.round(t), clues: clues.clues.length - before, unstuck: stuck };
    return c;
  }

  /** F3 debug: rings for cryptid zones (red), clue zones (amber) and the exit (green). */
  setDebug(on) {
    if (on && !this.debugGroup) {
      const g = this.debugGroup = new THREE.Group();
      const ring = (z, color, picked) => {
        // Filled translucent disc plus a solid rim, so it reads from the ground and from overhead.
        const mat = (o) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, fog: false,
          polygonOffset: true, polygonOffsetFactor: DECAL_OFFSET.factor, polygonOffsetUnits: DECAL_OFFSET.units });   // decal tier (#61)
        const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 40).rotateX(-Math.PI / 2), mat(picked ? 0.35 : 0.15));
        const rim = new THREE.Mesh(new THREE.RingGeometry(z.r * 0.85, z.r, 40).rotateX(-Math.PI / 2), mat(picked ? 0.95 : 0.5));
        disc.position.set(z.x, 0.05, z.z);
        rim.position.set(z.x, 0.06, z.z);
        g.add(disc, rim);
      };
      for (const z of this.zones?.bigfoot ?? []) ring(z, 0xff4a3a, z === this.cryptidZone);
      for (const z of this.zones?.clues ?? []) ring(z, 0xffb43a, z === this.clueZone);
      if (this.map.exit) ring({ ...this.map.exit, r: 4 }, 0x3cff7a, true);
      this.scene.add(g);
    }
    if (this.debugGroup) this.debugGroup.visible = on;
  }
}
