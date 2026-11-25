import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pixelMaterial, plankTexture, boardWallTexture, waterTexture } from '../art/pixelTex.js';
import {
  pineBarkTexture, dirtTexture, leafLitterTexture, mossTexture, rockTexture, grassTexture, grassTuftTexture, needleTexture,
} from '../art/forestTex.js';

// Pine Hollow texture pass (art #38): swaps the greybox colours for the painted forest texture
// set (docs/art-style-guide.md), with UVs set from real-world size so every surface sits at
// 32 texels per metre and tiles without seams. Layout and collision are untouched.
//
// Called at the end of buildForestMap with the meshes the map added.

const TILE = { rock: 2, dirt: 2, litter: 2, moss: 1, grass: 2, bark: 1, wood: 1, needles: 1, water: 4 };

export function dressForest({ meshes, colors, half, rng, keepClear }) {
  const C = colors;
  const M = {
    rock: pixelMaterial(rockTexture()),
    rockDark: pixelMaterial(rockTexture(), { color: 0xa8acb4 }),
    dirt: pixelMaterial(dirtTexture()),
    bank: pixelMaterial(dirtTexture(), { color: 0x8a8078 }),
    wood: pixelMaterial(boardWallTexture()),
    woodDark: pixelMaterial(plankTexture(1), { color: 0xb0a898 }),
    snag: pixelMaterial(pineBarkTexture(), { color: 0xb8b0a8 }),
    treeline: pixelMaterial(needleTexture(), { color: 0x7a8a80 }),
    litter: pixelMaterial(leafLitterTexture()),
    moss: pixelMaterial(mossTexture(), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    grass: pixelMaterial(grassTexture(), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    bark: pixelMaterial(pineBarkTexture()),
    needles: pixelMaterial(needleTexture(), { flatShading: true }),
    needlesHigh: pixelMaterial(needleTexture(), { flatShading: true, color: 0xc8d2c8 }),
    tuft: pixelMaterial(grassTuftTexture(), { side: THREE.DoubleSide }),
  };
  const byColor = new Map([
    [C.rock, ['rock', TILE.rock]], [C.rockDark, ['rockDark', TILE.rock]], [C.trail, ['dirt', TILE.dirt]],
    [C.bed, ['bank', TILE.dirt]], [C.wood, ['wood', TILE.wood]], [C.woodDark, ['woodDark', TILE.wood]],
    [C.snag, ['snag', TILE.bark]], [C.needlesDark, ['treeline', TILE.needles]],
  ]);

  for (const m of meshes) {
    if (!m.isMesh) continue;
    if (m.name === 'forest-floor') { m.material = M.litter; scaleUV(m.geometry, 2 * half / TILE.litter, 2 * half / TILE.litter); continue; }
    if (m.name === 'tree-trunks') {
      // Unit trunk scaled per tree (radius ~0.4, height ~13 m): about 2 bark tiles around, 6 up.
      m.material = M.bark; scaleUV(m.geometry, 2, 6.5); continue;
    }
    if (m.name === 'tree-canopy-low') { m.material = M.needles; scaleUV(m.geometry, 6, 4); continue; }
    if (m.name === 'tree-canopy-high') { m.material = M.needlesHigh; continue; }
    if (m.name === 'ferns') { m.geometry = tuftGeometry(); m.material = M.tuft; m.castShadow = false; continue; }
    if (m.name === 'creek') {
      const w = waterTexture(false);
      m.material = pixelMaterial(w, { roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.9, depthWrite: false, color: 0xb8c8c8 });
      fitUV(m, TILE.water);
      continue;
    }
    const mat = m.material;
    if (!mat || mat.map || !mat.color || m.isInstancedMesh) continue;
    const hit = byColor.get(mat.color.getHex());
    if (!hit) continue;
    m.material = M[hit[0]];
    fitUV(m, hit[1]);
  }

  // Break up the ground: moss pads under the trees, grass in open ground, scattered at random.
  const patches = [];
  const add = (kind, n, wantOpen) => {
    const geo = new THREE.CircleGeometry(1, 9);
    geo.rotateX(-Math.PI / 2);
    scaleUV(geo, 3, 3);
    const im = new THREE.InstancedMesh(geo, kind === 'moss' ? M.moss : M.grass, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < n * 6 && k < n; i++) {
      const x = (rng() * 2 - 1) * (half - 2), z = (rng() * 2 - 1) * (half - 2);
      if (keepClear(x, z) === wantOpen) {
        const s = 1.2 + rng() * 2.2;
        q.setFromAxisAngle(up, rng() * 6.28);
        im.setMatrixAt(k++, m4.compose(new THREE.Vector3(x, kind === 'moss' ? 0.0025 : 0.002, z), q, new THREE.Vector3(s, 1, s * (0.7 + rng() * 0.5))));
      }
    }
    im.count = k;
    im.receiveShadow = true;
    im.name = `forest-${kind}-patches`;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    patches.push(im);
  };
  add('moss', 700, false);
  add('grass', 500, false);
  return patches;
}

/** Multiply a geometry's UVs (1x1 -> sx x sy tiles). */
function scaleUV(geo, sx, sy) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  uv.needsUpdate = true;
}

/** Set UVs from the mesh's real size so its texture tiles at `tile` metres. */
function fitUV(mesh, tile) {
  const g = mesh.geometry, p = g.parameters ?? {};
  // Geometry may be shared between meshes; only rescale it once.
  if (g.userData.fitted) return;
  g.userData.fitted = true;
  const sc = mesh.scale;
  if (g.type === 'BoxGeometry') {
    const w = p.width * sc.x, h = p.height * sc.y, d = p.depth * sc.z;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
    uv.needsUpdate = true;
  } else if (g.type === 'PlaneGeometry') scaleUV(g, p.width / tile, p.height / tile);
  else if (g.type === 'CircleGeometry') scaleUV(g, 2 * p.radius / tile, 2 * p.radius / tile);
  else if (g.type === 'CylinderGeometry') scaleUV(g, Math.PI * (p.radiusTop + p.radiusBottom) / tile, p.height / tile);
  else if (p.radius) scaleUV(g, 2 * p.radius / tile, 2 * p.radius / tile);   // dodecahedrons etc.
}

/** Crossed grass cards replacing the fern cones (base at the instance's ground point). */
function tuftGeometry() {
  const a = new THREE.PlaneGeometry(1.1, 1.1); a.translate(0, 0.55 - 0.25, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const c = a.clone().rotateY(Math.PI / 4);
  return mergeGeometries([a, b, c]);
}
