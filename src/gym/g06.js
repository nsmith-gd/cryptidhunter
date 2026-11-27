import * as THREE from 'three';
import { DogmanProxy } from '../cryptids/dogmanProxy.js';

// Gym G06: observation network and adaptive threat (GDD §15.2 G06; task #152). Greybox, ?map=g06
// (&proxy=dogman for the Dogman mode). A camp in dense woods; three cover corridors come at it from
// the north (west, centre, east) and an alternate route loops round behind a rock on the far west
// (the blind spot). Three camera anchors cover the corridors; a fourth sits where the rock occludes
// it. A power hub (battery) at the camp feeds the cameras. A perimeter alarm rings the camp.
//   Coverage   a point is WATCHED if you can see it directly (your view cone, 32 m, clear line) or a
//              camera can: powered, intact, in its field of view and range, with a clear line. An
//              unpowered, removed or occluded camera covers nothing. Hidebehind checks coverage, not
//              ownership.
//   Hidebehind moves only along connected cover (the corridor graph), node to node at walking pace
//              - never teleports - and only steps onto a stretch that's unwatched right now. Watched
//              everywhere, it waits. The alarm warns when it crosses the perimeter; it intrudes when
//              it reaches the camp.
// Keys (gym): 5/6/7 remove or restore camera A/B/C · 8 hub power on/off · 9 recharge the hub ·
//             0 move camera D to the anchor past the rock (the remedy for the blind spot).

export const G06 = {
  half: 36,
  camp: { x: 0, z: 18 },
  hub: { x: 3, z: 20 },
  perimeter: 13,                   // alarm ring radius round the camp
  intrude: 4,                      // metres from the camp centre: an intrusion
  start: { x: 0, z: 24 },
  hidebehindSpeed: 1.6,
  sight: { you: 32, youCone: THREE.MathUtils.degToRad(55), cam: 30, camCone: THREE.MathUtils.degToRad(16) },   // narrow: each camera covers its own corridor
  hub0: 100, drainPerCamPerSec: 0.05,
  // Corridors of cover (north to south), joined along the north edge (connected cover).
  corridors: {
    west: [[-14, -30], [-14, -22], [-13, -14], [-12, -6], [-10, 2], [-6, 9], [-2, 15]],
    centre: [[0, -30], [0, -22], [0, -14], [0, -6], [0, 2], [0, 9], [0, 15]],
    east: [[14, -30], [14, -22], [13, -14], [12, -6], [10, 2], [6, 9], [2, 15]],
    behindRock: [[-14, -30], [-24, -24], [-28, -12], [-28, 0], [-24, 10], [-14, 16], [-4, 17]],
  },
  cameras: [
    { id: 'A', x: -8, z: 14, aim: [-12, -8] },
    { id: 'B', x: 0, z: 13, aim: [0, -10] },
    { id: 'C', x: 8, z: 14, aim: [12, -8] },
    { id: 'D', x: -12, z: 18, aim: [-28, -4] },           // looks at the behind-rock route, but the rock is in the way
  ],
  remedyD: { x: -26, z: 20, aim: [-27, -8] },             // the anchor past the rock: covers the alternate route
  rock: { x: -21, z: 9, w: 6, d: 10, h: 4 },
  // Dogman mode: where it watches from, the route it sees you walk, and the alternate route.
  dogman: { at: { x: 0, z: 5 }, routeA: [[-6, 12], [6, 12], [6, 23], [-6, 23], [-6, 12]], routeB: [[-28, -12], [-28, 0], [-24, 10]] },   // A: across the camp clearing in its view; B: behind the rock
};

const _ray = new THREE.Ray(), _hit = new THREE.Vector3(), V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildGymG06(scene) {
  const colliders = [];
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const box = (x, z, w, d, h, color, { collide = true, name } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true;
    if (name) m.name = name; scene.add(m); if (collide) colliders.push(new THREE.Box3().setFromObject(m)); return m;
  };
  const H = G06.half;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), mat(0x34402e)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'gym-floor'; scene.add(ground);
  for (const [x, z, w, d] of [[0, -H - 0.5, H * 2, 1], [0, H + 0.5, H * 2, 1], [-H - 0.5, 0, 1, H * 2], [H + 0.5, 0, 1, H * 2]]) box(x, z, w, d, 3, 0x3a3a3a);
  // Dense trees everywhere except the corridors, the camp clearing and the rock route.
  const near = (x, z, pts, r) => pts.some(([a, b], i) => i < pts.length - 1 && segD(x, z, a, b, pts[i + 1][0], pts[i + 1][1]) < r);
  let seed = 606; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const x = (rnd() * 2 - 1) * (H - 2), z = (rnd() * 2 - 1) * (H - 2);
    if (Math.hypot(x - G06.camp.x, z - G06.camp.z) < 9 || Object.values(G06.corridors).some((c) => near(x, z, c, 2.2))) continue;
    if (Math.abs(x - G06.rock.x) < G06.rock.w / 2 + 2 && Math.abs(z - G06.rock.z) < G06.rock.d / 2 + 2) continue;
    if (G06.cameras.some((c) => Math.hypot(x - c.x, z - c.z) < 2)) continue;
    box(x, z, 0.5, 0.5, 6, 0x2e2a22, { name: 'g06-tree' });
  }
  box(G06.rock.x, G06.rock.z, G06.rock.w, G06.rock.d, G06.rock.h, 0x6a665e, { name: 'g06-rock' });
  for (const c of Object.values(G06.corridors)) for (const [x, z] of c) { const p = new THREE.Mesh(new THREE.CircleGeometry(0.4, 8), mat(0x4a5038)); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.01, z); p.name = 'g06-cover-node'; scene.add(p); }
  box(G06.hub.x, G06.hub.z, 1, 0.8, 1, 0xb08a2a, { name: 'g06-power-hub' });
  const ring = new THREE.Mesh(new THREE.RingGeometry(G06.perimeter - 0.1, G06.perimeter, 64), new THREE.MeshBasicMaterial({ color: 0xc84a3a, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(G06.camp.x, 0.02, G06.camp.z); ring.name = 'g06-alarm-perimeter'; scene.add(ring);
  const lamp = new THREE.PointLight(0xffd8a0, 4, 18, 1.5); lamp.position.set(G06.camp.x, 3, G06.camp.z); scene.add(lamp);
  return {
    colliders, bounds: H, gym: 'G06', title: 'G06 Observation network and adaptive threat', noBigfoot: true, level: 11,
    playerStart: { x: G06.start.x, z: G06.start.z, yaw: 0 }, exit: { x: 30, z: 32, name: 'the forestry road' },
    spawns: {}, spawnZones: { bigfoot: [], clues: [] }, safeZones: [],
    landmarks: { camp: G06.camp, hub: G06.hub },
    environment: { background: 0x10141a, fog: { color: 0x182028, near: 18, far: 70 }, lightLevel: 0.3, airTemp: 4 },
  };
}

function segD(x, z, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1)));
  return Math.hypot(x - ax - abx * t, z - az - abz * t);
}

/** The gym's observation network, Hidebehind and Dogman; the harness steps it. */
export class G06World {
  constructor({ game, map, trace, mode = 'hidebehind', notify = () => {} }) {
    this.g = game; this.map = map; this.trace = trace; this.notify = notify; this.mode = mode;
    this.time = 0;
    this.hub = { charge: G06.hub0, on: true };
    this.cams = G06.cameras.map((c) => ({ ...c, removed: false, heading: Math.atan2(c.aim[0] - c.x, c.aim[1] - c.z) }));
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
    for (const c of this.cams) {
      const g = new THREE.Group(); g.name = `g06-camera-${c.id}`;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), mat(0x5a4632)); post.position.y = 1;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.45), mat(0x2a2e34)); body.position.y = 2.1;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0x40ff60 })); led.position.set(0, 2.25, 0.25);
      g.add(post, body, led); g.position.set(c.x, 0, c.z); g.rotation.y = c.heading; game.scene.add(g);
      c.mesh = g; c.led = led;
    }
    // Hidebehind: a tall pale shape that keeps to cover.
    const hb = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 2.2, 4, 8), mat(0x8a8a7a)); hb.name = 'gym-proxy-hidebehind'; game.scene.add(hb);
    this.hb = { mesh: hb, corridor: 'centre', i: 0, x: 0, z: -30, state: 'waiting', wait: 0, moves: [], warned: null, intruded: null };
    this.placeHb();
    this.dogman = mode === 'dogman' ? new DogmanProxy({ scene: game.scene, colliders: map.colliders ?? [], x: G06.dogman.at.x, z: G06.dogman.at.z }) : null;
    if (this.dogman) { hb.visible = false; this.dogman.heading = 0; this.dogman.mesh.rotation.y = 0; }
    this.proxy = this.mode === 'dogman' ? { mesh: this.dogman.mesh, get x() { return this.mesh.position.x; }, get z() { return this.mesh.position.z; }, get state() { return 'watch'; } } : this.hb;
  }

  log(type, data = {}) { this.trace('security', type, data); }
  clear(a, b) {
    const dir = b.clone().sub(a), len = dir.length(); _ray.set(a, dir.normalize());
    for (const bx of this.map.colliders ?? []) if (!bx.containsPoint(a) && _ray.intersectBox(bx, _hit) && _hit.distanceTo(a) < len - 0.4) return false;
    return true;
  }
  camLive(c) { return !c.removed && this.hub.on && this.hub.charge > 0; }
  /** Which camera ids see (x, z) (head height); '' = none. Unpowered, removed or occluded cameras see nothing. */
  camsSeeing(x, z) {
    const out = [];
    for (const c of this.cams) {
      if (!this.camLive(c)) continue;
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
      if (d > G06.sight.cam) continue;
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      if ((fx * dx + fz * dz) / Math.max(d, 1e-6) < Math.cos(G06.sight.camCone)) continue;
      if (this.clear(V(c.x, 2.1, c.z), V(x, 1.4, z))) out.push(c.id);
    }
    return out;
  }
  youSee(x, z) {
    const g = this.g, p = g.player.position;
    if (g.fieldCamp?.sleeping) return false;                      // asleep: no direct vision
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > G06.sight.you) return false;
    const yaw = g.player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (d > 2 && (fx * dx + fz * dz) / d < Math.cos(G06.sight.youCone)) return false;
    return this.clear(V(p.x, p.y + 1.6, p.z), V(x, 1.4, z));
  }
  watched(x, z) { return this.youSee(x, z) || this.camsSeeing(x, z).length > 0; }
  /** A stretch of corridor is watched if any point along it is. */
  stretchWatched(a, b) { for (let t = 0; t <= 1.0001; t += 0.25) if (this.watched(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return true; return false; }

  placeHb() { const h = this.hb; h.mesh.position.set(h.x, 1.45, h.z); }

  /** Hidebehind: along connected cover only, onto unwatched stretches only. */
  stepHidebehind(dt) {
    const h = this.hb, C = G06.corridors;
    if (h.intruded) return;
    const path = C[h.corridor], next = path[h.i + 1];
    if (!next) return;
    if (h.state === 'moving') {
      const dx = next[0] - h.x, dz = next[1] - h.z, d = Math.hypot(dx, dz), k = Math.min(1, G06.hidebehindSpeed * dt / Math.max(d, 1e-6));
      h.x += dx * k; h.z += dz * k;
      if (d < 0.05) { h.i++; h.state = 'waiting'; h.wait = 0; }
    } else {
      h.wait += dt;
      const watchedNow = this.stretchWatched(path[h.i], next);
      if (!watchedNow) { h.state = 'moving'; h.moves.push({ t: +this.time.toFixed(1), corridor: h.corridor, from: path[h.i], to: next, watched: false }); this.log('hidebehind-advance', { corridor: h.corridor, to: next }); }
      else if (h.i > 0 && h.wait > 12 && !this.stretchWatched(path[h.i], path[h.i - 1])) {   // a dead end: back out along the same cover
        h.i--; h.x = path[h.i][0]; h.z = path[h.i][1]; h.wait = 0;
        this.log('hidebehind-backs-off', { corridor: h.corridor, to: path[h.i] });
      } else if (h.i === 0 && h.wait > 8) {                       // at the north edge: slip along to another corridor (connected cover)
        const names = Object.keys(C), nextName = names[(names.indexOf(h.corridor) + 1) % names.length];
        h.corridor = nextName; h.x = C[nextName][0][0]; h.z = C[nextName][0][1]; h.wait = 0;
        this.log('hidebehind-shift', { corridor: nextName });
      }
    }
    const dCamp = Math.hypot(h.x - G06.camp.x, h.z - G06.camp.z);
    if (dCamp < G06.perimeter && !h.warned) { h.warned = +this.time.toFixed(1); this.log('alarm', { at: [h.x, h.z].map((v) => +v.toFixed(1)) }); this.notify('Perimeter alarm: something is inside the ring.'); }
    if (dCamp < G06.intrude && !h.intruded) { h.intruded = +this.time.toFixed(1); this.log('intrusion', {}); this.notify('It\'s in the camp.'); }
    this.placeHb();
  }

  /** Move camera D past the rock (the remedy for the blind spot), or back. */
  moveD(toRemedy = true) {
    const d = this.cams.find((c) => c.id === 'D'), R = toRemedy ? G06.remedyD : G06.cameras[3];
    d.x = R.x; d.z = R.z; d.heading = Math.atan2(R.aim[0] - R.x, R.aim[1] - R.z);
    d.mesh.position.set(d.x, 0, d.z); d.mesh.rotation.y = d.heading;
    this.log('camera', { id: 'D', moved: toRemedy ? 'past the rock' : 'back behind the rock' });
  }
  toggleCam(id) { const c = this.cams.find((x) => x.id === id); c.removed = !c.removed; c.mesh.visible = !c.removed; this.log('camera', { id, removed: c.removed }); }
  setHub(on) { this.hub.on = on; this.log('hub', { on, charge: +this.hub.charge.toFixed(1) }); }
  recharge() { this.hub.charge = G06.hub0; this.log('hub', { recharged: true }); }

  update(dt) {
    this.time += dt;
    if (this.hub.on && this.hub.charge > 0) {
      const live = this.cams.filter((c) => !c.removed).length;
      this.hub.charge = Math.max(0, this.hub.charge - G06.drainPerCamPerSec * live * dt);
      if (this.hub.charge === 0) { this.log('hub', { flat: true }); this.notify('The power hub is flat: the cameras are dark.'); }
    }
    for (const c of this.cams) c.led.material.color.set(this.camLive(c) ? 0x40ff60 : 0x301010);
    if (this.mode === 'dogman') this.dogman.update(dt, { player: this.g.player });
    else this.stepHidebehind(dt);
  }
}
