import * as THREE from 'three';

// Gameplay gym G00 (GDD 15.2): interaction, visibility and evidence bench. Greybox only.
// ?map=gym. Layout (north = -z):
//   south   — the room you start in: an equipment table, a wet reflective corner (SW).
//   north   — a bright doorway in the room's north wall onto the yard (a lamp over it).
//   east    — a dim corridor running out of the room's east wall.
//   yard    — open ground north of the doorway; the creature beds down in the shadow at its far
//             end, and its fresh trail starts by the doorway, so there are clues to examine.
// Fixed exposure: no fog changes, a fixed ambient; the doorway lamp is the one light you can toggle.
// The fixture is rebuilt from scratch on every page load; with ?seed=N everything is repeatable.

export const GYM = { half: 24 };

export function buildGymMap(scene) {
  const colliders = [];
  const mats = new Map();
  const grey = (shade, extra = {}) => {
    const k = `${shade}${JSON.stringify(extra)}`;
    if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: new THREE.Color(shade, shade, shade), roughness: 0.9, ...extra }));
    return mats.get(k);
  };
  const box = (x0, z0, x1, z1, y0, y1, shade = 0.5, { collide = true, name } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), grey(shade));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    if (name) m.name = name;
    scene.add(m);
    if (collide) colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };
  const H = GYM.half;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), grey(0.32));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'gym-floor';
  scene.add(ground);
  // Perimeter.
  box(-H, -H - 1, H, -H, 0, 3, 0.3); box(-H, H, H, H + 1, 0, 3, 0.3);
  box(-H - 1, -H, -H, H, 0, 3, 0.3); box(H, -H, H + 1, H, 0, 3, 0.3);

  // The room: x -6..6, z 6..16, walls 0.3 thick, 2.8 high; doorway (2 m) in the north wall,
  // corridor opening (1.6 m) in the east wall.
  const W = 2.8;
  box(-6, 6, -1, 6.3, 0, W, 0.55); box(1, 6, 6, 6.3, 0, W, 0.55);            // north wall, doorway x -1..1
  box(-6, 15.7, 6, 16, 0, W, 0.55);                                            // south wall
  box(-6, 6, -5.7, 16, 0, W, 0.55);                                            // west wall
  box(5.7, 6, 6, 10, 0, W, 0.55); box(5.7, 11.6, 6, 16, 0, W, 0.55);          // east wall, opening z 10..11.6
  box(-6, 6, 6, 16, W, W + 0.2, 0.45, { collide: false, name: 'gym-ceiling' });
  // Dim corridor east: 1.6 m wide, 12 m long, roofed.
  box(6, 9.7, 18, 10, 0, W, 0.5); box(6, 11.6, 18, 11.9, 0, W, 0.5);
  box(6, 9.7, 18, 11.9, W, W + 0.2, 0.42, { collide: false, name: 'gym-corridor-roof' });
  // Equipment table (east side of the room) with target objects on it.
  box(2.4, 12.6, 4.6, 13.6, 0, 0.9, 0.62, { name: 'gym-table' });
  for (const [x, c] of [[2.8, 0xb04030], [3.5, 0x3070b0], [4.2, 0xd0b040]]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    t.position.set(x, 1.01, 13.1); t.name = 'gym-target'; scene.add(t);
  }
  // Wet reflective corner (SW): a dark glossy puddle.
  const wet = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ color: 0x1a1e22, roughness: 0.08, metalness: 0.5 }));
  wet.rotation.x = -Math.PI / 2; wet.position.set(-4.2, 0.005, 14.2); wet.name = 'gym-wet-corner';
  scene.add(wet);
  // Yard props: a few blocks to hide behind, and a low wall the creature beds down behind.
  box(-8, -6, -6, -4, 0, 1.6, 0.45); box(5, -2, 7, 0, 0, 2.2, 0.45); box(-3, -16, 3, -15.5, 0, 1.4, 0.4, { name: 'gym-bed-wall' });

  // Lights: fixed ambient; a lamp over the doorway (the toggleable light); the yard's far end dark.
  const lamp = new THREE.PointLight(0xfff0d0, 6, 14, 2);
  lamp.position.set(0, 2.6, 5.4); lamp.name = 'gym-doorway-lamp';
  scene.add(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0d0 }));
  bulb.position.copy(lamp.position); scene.add(bulb);

  return {
    colliders,
    bounds: H,
    playerStart: { x: 0, z: 12.5, yaw: 0 },
    exit: { x: -3, z: 13, name: 'the bench room' },
    spawns: { bigfoot: { x: 0, z: -18 } },
    spawnZones: {
      bigfoot: [{ name: 'behind the low wall', x: 0, z: -18.5, r: 1.5 }],
      clues: [{ name: 'by the doorway', x: 1.5, z: 3, r: 1 }],
    },
    landmarks: { doorway: { x: 0, z: 6 }, corridor: { x: 12, z: 10.8 }, table: { x: 3.5, z: 13.1 }, wetCorner: { x: -4.2, z: 14.2 }, bed: { x: 0, z: -18 } },
    lamp,
    gym: 'G00',
  };
}
