import * as THREE from 'three';
import { capsule, ellipsoid, roundBox, blend, surfaceNets, facetUV } from '../art/sdfMesh.js';

// Sculpted first-person models (#57). Hands are single organic glove surfaces whose fingers
// actually wrap the torch / camera; hard-surface gear is turned (lathe) or rounded with bevels.
// All flat-shaded low-poly with pixel textures at a constant ~2.5 mm per texel (hero density).

const PPM = 12;          // texture repeats per metre for the 32 px gear textures (~2.6 mm/texel)

function sculpt(sdf, min, max, cell, mat, { smooth = 1, ppm = PPM } = {}) {
  const m = new THREE.Mesh(facetUV(surfaceNets(sdf, min, max, cell, { smooth }), ppm), mat);
  m.castShadow = false;
  return m;
}

/** Lathe along -Z (profile y -> -z): [ [r, y], ... ]; UVs scaled to real size. */
function turned(profile, mat, segments = 14, ppm = PPM) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const rMax = Math.max(...profile.map((p) => p[0]));
  const len = Math.abs(profile[profile.length - 1][1] - profile[0][1]);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * rMax * ppm, uv.getY(i) * len * ppm);
  g.rotateX(-Math.PI / 2);
  const flat = g.toNonIndexed(); flat.computeVertexNormals();
  return new THREE.Mesh(flat, mat);
}

/** Fingers curling round an axis along Z through (cx, cy): one capsule chain per finger. */
function curledFingers({ cx = 0, cy = 0, R, zs, from, to, radius, bendIn = 0.004 }) {
  const parts = [];
  zs.forEach((z, i) => {
    const steps = 4, r = radius * (i === zs.length - 1 ? 0.88 : 1);
    let prev = null;
    for (let s = 0; s <= steps; s++) {
      const a = from + (to - from) * (s / steps) * (i === zs.length - 1 ? 0.85 : 1);
      const rr = R - bendIn * s;
      const p = [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z + s * 0.0015];
      if (prev) parts.push(capsule(prev, p, r * (1 - 0.04 * s), r * (1 - 0.04 * (s + 1))));
      prev = p;
    }
  });
  return parts;
}

/** Right hand: gloved fist around the flashlight (torch along -Z, lens at z = -0.155). */
export function buildTorchHand(M) {
  const g = new THREE.Group();
  // --- torch: turned aluminium body, knurled grip sleeve, flared head, bezel, lens ---------
  g.add(turned([[0, -0.118], [0.02, -0.118], [0.0245, -0.113], [0.0245, -0.094], [0.022, -0.09], [0.0215, 0.03], [0.022, 0.07],
    [0.026, 0.09], [0.0325, 0.118], [0.0365, 0.124], [0.0365, 0.146], [0.033, 0.152], [0.028, 0.153]], M.metal, 14));
  g.add(turned([[0.0222, -0.086], [0.0232, -0.083], [0.0232, 0.026], [0.0222, 0.029]], M.grip, 14, 60));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 14), M.lensOn);
  lens.position.z = -0.1505; lens.rotation.y = Math.PI;
  g.add(lens);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.006, 8), M.rubber);
  button.position.set(0, 0.024, -0.035);
  g.add(button);
  // --- glove: back of the hand on the right of the tube, fingers wrap under and round ------
  const fingers = curledFingers({ R: 0.033, zs: [-0.018, 0.0045, 0.026, 0.046], from: 0.35, to: -2.9, radius: 0.0098 });
  const glove = blend([
    [ellipsoid([0.031, 0.006, 0.05], [0.027, 0.036, 0.05]), 0.02],      // back of hand / palm mass
    [capsule([0.03, 0.025, -0.015], [0.032, 0.02, 0.05], 0.014), 0.012], // knuckle ridge
    ...fingers.map((f) => [f, 0.0025]),                                    // tight blend: fingers stay separate
    [capsule([0.035, -0.012, 0.085], [0.05, -0.02, 0.17], 0.03, 0.034), 0.02],   // wrist
  ], 0.012);
  g.add(sculpt(glove, [-0.06, -0.07, -0.05], [0.1, 0.07, 0.2], 0.003, M.glove));
  // Thumb: its own piece so it can press the switch.
  const thumb = sculpt(blend([capsule([0.036, 0.032, 0.05], [0.016, 0.036, 0.006], 0.0125, 0.011), capsule([0.016, 0.036, 0.006], [0.003, 0.031, -0.018], 0.011, 0.0095)], 0.008),
    [-0.02, 0.005, -0.04], [0.06, 0.06, 0.075], 0.0035, M.glove);
  thumb.name = 'thumb';
  g.add(thumb);
  // Sleeve: waxed jacket cuff and forearm running back out of view.
  const sleeve = blend([
    [capsule([0.05, -0.022, 0.15], [0.1, -0.08, 0.48], 0.046, 0.06), 0.02],
    [ellipsoid([0.051, -0.023, 0.152], [0.05, 0.05, 0.02]), 0.015],          // cuff roll
  ]);
  g.add(sculpt(sleeve, [-0.02, -0.16, 0.12], [0.18, 0.05, 0.5], 0.008, M.sleeve));
  g.userData = { lens, thumb };
  return g;
}

/** Left hand cradling the camera: body + grip + prism hump + turned lens, fingers round the lens. */
export function buildCameraHand(M) {
  const g = new THREE.Group();
  const body = blend([
    [roundBox([0, 0, 0], [0.072, 0.045, 0.03], 0.009), 0.01],
    [ellipsoid([0.063, -0.004, -0.02], [0.02, 0.046, 0.022]), 0.012],         // hand grip
    [roundBox([-0.004, 0.05, 0.002], [0.026, 0.016, 0.026], 0.007), 0.01],    // viewfinder prism
    [capsule([-0.047, 0.044, 0.004], [-0.047, 0.057, 0.004], 0.012), 0.004],  // mode dial
    [capsule([0.045, 0.045, 0.0], [0.045, 0.052, 0.0], 0.007), 0.003],        // shutter collar
  ], 0.008);
  g.add(sculpt(body, [-0.09, -0.06, -0.05], [0.1, 0.08, 0.045], 0.0035, M.leatherette));
  const lens = turned([[0.031, 0.025], [0.034, 0.03], [0.034, 0.05], [0.032, 0.053], [0.032, 0.075], [0.035, 0.08], [0.035, 0.098], [0.031, 0.1]], M.grip, 16, 40);
  g.add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.027, 16), M.glass); glass.position.z = -0.099; glass.rotation.y = Math.PI;
  const mount = new THREE.Mesh(new THREE.CircleGeometry(0.031, 16), M.metal); mount.position.z = -0.026;   // closes the barrel's back
  const ring = turned([[0.0335, 0.05], [0.0352, 0.052], [0.0352, 0.06], [0.0335, 0.062]], M.metal, 16);     // focus ring
  g.add(glass, mount, ring);
  const shutter = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8), M.red); shutter.position.set(0.045, 0.055, 0);
  g.add(shutter);
  // Left glove: palm under the lens, fingers curling up round it, thumb on the left side.
  const fingers = curledFingers({ R: 0.043, zs: [-0.048, -0.0665, -0.085], from: -2.6, to: -0.4, radius: 0.0098 });
  const glove = blend([
    [ellipsoid([-0.012, -0.05, -0.06], [0.034, 0.016, 0.04]), 0.018],                // palm under the lens
    ...fingers.map((f) => [f, 0.0025]),
    [capsule([-0.04, -0.02, -0.055], [-0.041, 0.012, -0.075], 0.012, 0.0105), 0.01], // thumb up the left side
    [capsule([-0.03, -0.06, -0.02], [-0.11, -0.13, 0.12], 0.028, 0.032), 0.02],      // wrist
  ], 0.012);
  g.add(sculpt(glove, [-0.14, -0.16, -0.11], [0.07, 0.02, 0.14], 0.0032, M.glove));
  const sleeve = blend([
    [capsule([-0.1, -0.12, 0.1], [-0.2, -0.24, 0.42], 0.044, 0.058), 0.02],
    [ellipsoid([-0.1, -0.12, 0.1], [0.048, 0.048, 0.022]), 0.015],
  ]);
  g.add(sculpt(sleeve, [-0.28, -0.32, 0.06], [-0.04, -0.06, 0.45], 0.008, M.sleeve));
  return g;
}

/** Night-vision goggles: twin turned tubes, a moulded bridge and a head-mount arm. */
export function buildGoggles(M) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const t = turned([[0.024, 0.0], [0.03, 0.006], [0.031, 0.05], [0.034, 0.056], [0.034, 0.075], [0.029, 0.08]], M.olive, 14);
    t.position.set(s * 0.042, 0, 0.04);
    const eyecup = turned([[0.026, -0.02], [0.03, -0.012], [0.03, 0.0]], M.rubber, 14);
    eyecup.position.set(s * 0.042, 0, 0.04);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 14), M.glassGreen); lens.position.set(s * 0.042, 0, -0.038); lens.rotation.y = Math.PI;
    g.add(t, eyecup, lens);
  }
  g.add(sculpt(blend([roundBox([0, 0.024, 0.01], [0.06, 0.014, 0.03], 0.008), capsule([0, 0.035, 0.03], [0, 0.07, 0.06], 0.012)], 0.012),
    [-0.08, -0.01, -0.03], [0.08, 0.09, 0.08], 0.004, M.olive));
  return g;
}

/** Trail camera: moulded olive case with IR panel and lens, strap, held up in a gloved hand. */
export function buildTrailCam(M) {
  const g = new THREE.Group();
  g.add(sculpt(blend([roundBox([0, 0, 0], [0.055, 0.076, 0.034], 0.012), roundBox([0, -0.012, -0.03], [0.04, 0.05, 0.01], 0.006)], 0.006),
    [-0.07, -0.09, -0.05], [0.07, 0.09, 0.05], 0.004, M.olive));
  const ir = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.035), M.glass); ir.position.set(0, -0.03, -0.0405); ir.rotation.y = Math.PI;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 12), M.glass); lens.position.set(0, 0.028, -0.0405); lens.rotation.y = Math.PI;
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 6), M.red); led.position.set(0.032, 0.05, -0.0405); led.rotation.y = Math.PI;
  g.add(ir, lens, led);
  const hand = blend([
    [ellipsoid([-0.035, -0.06, 0.03], [0.03, 0.04, 0.03]), 0.015],
    ...curledFingers({ cx: 0, cy: -0.03, R: 0.0, zs: [], from: 0, to: 0, radius: 0.01 }).map((f) => [f, 0.006]),
    [capsule([-0.06, -0.04, 0.0], [-0.06, 0.02, -0.03], 0.011), 0.008],             // fingers round the side
    [capsule([-0.05, -0.04, -0.02], [-0.05, 0.03, -0.04], 0.011), 0.008],
    [capsule([-0.04, -0.09, 0.05], [-0.09, -0.16, 0.2], 0.026, 0.03), 0.015],
  ], 0.01);
  g.add(sculpt(hand, [-0.12, -0.2, -0.07], [0.0, 0.06, 0.23], 0.0045, M.glove));
  return g;
}
