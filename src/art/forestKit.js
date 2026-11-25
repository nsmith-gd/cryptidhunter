import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, pixelMaterial, barkTexture } from './pixelTex.js';
import {
  pineBarkTexture, pineNeedleTexture, pineBranchCard, pineSprayCard, fernFrondTexture, bushLeafTexture, bushSprigCard,
  grassTuftCard, logEndTexture, logBarkTexture, mossCarpetTexture, rockTexture, needleLitterTexture,
} from './forestKitTex.js';

// Pine Hollow forest kit: pines (4 shapes), dead snags (2), bushes (3), ferns (3), fallen logs (4),
// boulders/rocks (5), grass tufts (2), and needle-litter decals. Every prop is built once as a
// prototype (geometry merged per material) and drawn with instancing, so thousands of placements
// cost a few dozen draw calls. Each placement gets its own rotation and scale, and variants are
// different shapes, not just re-scales, so repetition doesn't read.
//
// Units: pines and snags are built 1 unit tall (instance scale = height in metres); everything
// else is built at real size in metres (instance scale ≈ 1, jittered).

const TAU = Math.PI * 2;

export class ForestKit {
  constructor(seed = 4242) {
    this.r = rng(seed);
    this.wind = { value: 0 };
    this.mats = this.buildMaterials();
    this.protos = new Map();   // key -> { parts: [{ mat, geo }], cast }
    this.instances = new Map(); // key -> [Matrix4]
    this.buildPrototypes();
  }

  // --- materials -------------------------------------------------------------------------
  buildMaterials() {
    const card = { side: THREE.DoubleSide };
    // Foliage is matte (Lambert): no grazing specular, which read as pale "snow" on needle tiers.
    const leafMaterial = (tex, { side = THREE.FrontSide, flatShading = false } = {}) => new THREE.MeshLambertMaterial({
      map: tex, side, flatShading, ...(tex.userData.alpha ? { alphaTest: 0.5 } : {}),
    });
    const m = {
      bark0: pixelMaterial(pineBarkTexture(0)),
      bark1: pixelMaterial(pineBarkTexture(1)),
      snagWood: pixelMaterial(barkTexture(1)),
      logBark: pixelMaterial(logBarkTexture()),
      needles0: leafMaterial(pineNeedleTexture(0)),
      needles1: leafMaterial(pineNeedleTexture(1)),
      branch0: leafMaterial(pineSprayCard(0), card),
      branch1: leafMaterial(pineSprayCard(1), card),
      fern0: leafMaterial(fernFrondTexture(0), card),
      fern1: leafMaterial(fernFrondTexture(1), card),
      bush0: leafMaterial(bushLeafTexture(0), { flatShading: true }),
      bush1: leafMaterial(bushLeafTexture(1), { flatShading: true }),
      sprig0: leafMaterial(bushSprigCard(0), card),
      sprig1: leafMaterial(bushSprigCard(1), card),
      grass0: leafMaterial(grassTuftCard(0), card),
      grass1: leafMaterial(grassTuftCard(1), card),
      logEnd0: leafMaterial(logEndTexture(0)),
      logEnd1: leafMaterial(logEndTexture(1)),
      moss0: leafMaterial(mossCarpetTexture(0), card),
      moss1: leafMaterial(mossCarpetTexture(1), card),
      rock0: pixelMaterial(rockTexture(0), { flatShading: true }),
      rock1: pixelMaterial(rockTexture(1), { flatShading: true }),
      litter: pixelMaterial(needleLitterTexture(), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    };
    // Gentle wind on the light, hanging parts. Amplitude grows with height above the prop's base.
    const sway = (mat, amp, freq) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWind = this.wind;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uWind;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec2 wBase = instanceMatrix[3].xz;
            #else
              vec2 wBase = vec2(0.0);
            #endif
            float wPhase = uWind * ${freq.toFixed(2)} + wBase.x * 0.31 + wBase.y * 0.17;
            float wAmt = ${amp.toFixed(3)} * max(transformed.y, 0.0);
            transformed.x += sin(wPhase) * wAmt;
            transformed.z += sin(wPhase * 0.77 + 1.3) * wAmt * 0.7;`);
      };
      mat.customProgramCacheKey = () => `sway${amp}${freq}`;
    };
    for (const k of ['branch0', 'branch1']) sway(m[k], 0.0035, 0.9);
    for (const k of ['fern0', 'fern1']) sway(m[k], 0.06, 1.6);
    for (const k of ['grass0', 'grass1']) sway(m[k], 0.12, 2.1);
    for (const k of ['sprig0', 'sprig1']) sway(m[k], 0.04, 1.4);
    return m;
  }

  // --- prototype registry ----------------------------------------------------------------
  define(key, partsByMat, { cast = true } = {}) {
    const parts = [];
    for (const [mat, geos] of Object.entries(partsByMat)) {
      if (!geos.length) continue;
      parts.push({ mat: this.mats[mat], geo: mergeGeometries(geos.map(prep)) });
    }
    this.protos.set(key, { parts, cast });
    this.instances.set(key, []);
  }

  /**
   * Queue one placement. rotY in radians; s = uniform scale or [sx, sy, sz]; tilt = { x, z } lean;
   * tint = optional THREE.Color multiplied into this instance (per-tree colour variation).
   */
  add(key, x, y, z, rotY = 0, s = 1, tilt = null, tint = null) {
    const list = this.instances.get(key);
    if (!list) throw new Error(`forest kit: no prototype ${key}`);
    const sc = Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s);
    const e = new THREE.Euler(tilt?.x ?? 0, rotY, tilt?.z ?? 0, 'YXZ');
    list.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), sc), tint });
  }

  variants(prefix) { return [...this.protos.keys()].filter((k) => k.startsWith(`${prefix}:`)); }

  /** Build the instanced meshes for everything queued and add them under one group. */
  build(scene) {
    const group = new THREE.Group();
    group.name = 'forest-kit';
    let draws = 0, count = 0;
    for (const [key, proto] of this.protos) {
      const list = this.instances.get(key);
      if (!list.length) continue;
      count += list.length;
      for (const part of proto.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((e, i) => im.setMatrixAt(i, e.m));
        if (list.some((e) => e.tint)) {
          const white = new THREE.Color(1, 1, 1);
          list.forEach((e, i) => im.setColorAt(i, e.tint ?? white));
          im.instanceColor.needsUpdate = true;
        }
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = proto.cast;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.name = `kit-${key}`;
        group.add(im);
        draws++;
      }
    }
    scene.add(group);
    this.stats = { draws, count };
    return group;
  }

  update(dt) { this.wind.value += dt; }

  // --- prototypes --------------------------------------------------------------------------
  buildPrototypes() {
    const r = this.r;
    // Pines (#60): 12 grown trees with different silhouettes (classic, columnar, broad, windswept,
    // sparse, broken-topped, forked ...) and 4 young ones, each built from whorls of drooping
    // branch sprays around a bent trunk rather than stacked cones.
    for (let v = 0; v < 12; v++) this.define(`pine:${v}`, this.pineWhorl(v));
    for (let v = 0; v < 4; v++) this.define(`youngPine:${v}`, this.pineWhorl(v, { young: true }));
    // Snags: a broken-topped dead pine and a bare silver one with stubby limbs.
    this.define('snag:0', this.snag({ limbs: 6, top: 0.7, bark: 'bark1' }));
    this.define('snag:1', this.snag({ limbs: 9, top: 1, bark: 'snagWood' }));
    // Bushes.
    for (let v = 0; v < 3; v++) this.define(`bush:${v}`, this.bush(v));
    // Ferns.
    for (let v = 0; v < 3; v++) this.define(`fern:${v}`, this.fern(v), { cast: false });
    // Logs: plain, mossy, broken, hollow.
    for (let v = 0; v < 4; v++) this.define(`log:${v}`, this.log(v));
    // Rocks: boulders, a flat slab, a tall stone, small rocks.
    for (let v = 0; v < 5; v++) this.define(`rock:${v}`, this.rock(v));
    // Ground cover.
    this.define('grass:0', this.grass(0), { cast: false });
    this.define('grass:1', this.grass(1), { cast: false });
    this.define('litter:0', { litter: [xform(new THREE.PlaneGeometry(1, 1), { r: [-Math.PI / 2, 0, 0], p: [0, 0.009, 0] })] }, { cast: false });
  }

  /**
   * A pine grown from whorls of branch sprays (unit height; instance scale = height in metres).
   * Each variant draws its shape from its own seed, so no two prototypes share a silhouette.
   */
  pineWhorl(v, { young = false } = {}) {
    const r = rng(9001 + v * 131 + (young ? 7000 : 0));
    const pick = (a, b) => a + r() * (b - a);
    const styles = young ? ['young', 'young', 'sparseYoung', 'young'] : ['classic', 'columnar', 'broad', 'windswept', 'sparse', 'broken', 'classic', 'fork', 'columnar', 'broad', 'windswept', 'classic'];   // one sparse tree in twelve: a dense, dark forest (director)
    const style = styles[v % styles.length];
    const P = {
      classic: { base: 0.16, r0: 0.2, shape: 1.0, whorls: 10, per: 5, skip: 0.12, asym: 0.14, droop: 0.42, stubs: 3 },
      columnar: { base: 0.24, r0: 0.13, shape: 0.55, whorls: 12, per: 5, skip: 0.1, asym: 0.1, droop: 0.55, stubs: 4 },
      broad: { base: 0.07, r0: 0.28, shape: 1.3, whorls: 9, per: 6, skip: 0.1, asym: 0.12, droop: 0.32, stubs: 1 },
      windswept: { base: 0.22, r0: 0.21, shape: 0.9, whorls: 10, per: 5, skip: 0.2, asym: 0.5, droop: 0.38, stubs: 3, bend: 0.07 },
      sparse: { base: 0.4, r0: 0.18, shape: 0.9, whorls: 8, per: 4, skip: 0.32, asym: 0.22, droop: 0.48, stubs: 8 },
      broken: { base: 0.18, r0: 0.22, shape: 0.8, whorls: 8, per: 5, skip: 0.18, asym: 0.18, droop: 0.4, stubs: 3, top: 0.8 },
      fork: { base: 0.2, r0: 0.2, shape: 0.95, whorls: 9, per: 5, skip: 0.15, asym: 0.16, droop: 0.42, stubs: 2, fork: true },
      young: { base: 0.04, r0: 0.3, shape: 1.05, whorls: 6, per: 5, skip: 0.08, asym: 0.16, droop: 0.22, stubs: 0 },
      sparseYoung: { base: 0.12, r0: 0.26, shape: 0.9, whorls: 5, per: 4, skip: 0.25, asym: 0.3, droop: 0.3, stubs: 1 },
    }[style];
    const n = !young && v % 3 === 2 ? 1 : 0;                 // every third grown pine is a bluer fir
    const top = (P.top ?? 1) * pick(0.97, 1.0);
    const bark = [], branch = [], core = [], dead = [];
    const trunkR = (young ? 0.034 : 0.021) * pick(0.85, 1.2);
    const bendDir = r() * TAU, bend = (P.bend ?? 0) + pick(0, 0.035);
    const center = (y) => [Math.cos(bendDir) * bend * y * y, Math.sin(bendDir) * bend * y * y];

    // Trunk: tapered, gently bent, with a root flare.
    const trunk = new THREE.CylinderGeometry(trunkR * 0.22, trunkR, top, 7, 8, true);
    trunk.translate(0, top / 2, 0);
    { const p = trunk.attributes.position; for (let i = 0; i < p.count; i++) { const [cx, cz] = center(p.getY(i)); p.setX(i, p.getX(i) + cx); p.setZ(i, p.getZ(i) + cz); } }
    trunk.computeVertexNormals();
    scaleUV(trunk, 4, 14 * top);
    bark.push(trunk);
    const flare = new THREE.CylinderGeometry(trunkR * 1.05, trunkR * 1.9, 0.035, 7, 1, true);
    flare.translate(0, 0.0175, 0); scaleUV(flare, 2, 0.4); bark.push(flare);

    // One branch spray: a drooping, tapering card along +x, plus a smaller vertical fin across it
    // so it has volume from the side. Placed at height y, pointing out at azimuth az, length L.
    const spray = (y, az, L, droop, fin = true) => {
      const w = Math.max(0.04, L * pick(0.75, 0.95));
      const mk = (vertical) => {
        const g = new THREE.PlaneGeometry(L, vertical ? w * 0.55 : w, 2, 1);
        g.translate(L / 2, 0, 0);
        if (!vertical) g.rotateX(-Math.PI / 2);           // lie flat
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const u = p.getX(i) / L;
          const side = vertical ? 0 : p.getZ(i);
          const lift = vertical ? p.getY(i) : 0;
          // taper toward the tip, droop down the length, cup the sides up a little
          p.setXYZ(i, p.getX(i), (lift * (1 - 0.6 * u)) + L * (0.06 * u - droop * u * u) + Math.abs(side) * 0.18, side * (1 - 0.65 * u));
        }
        g.computeVertexNormals();
        return g;
      };
      const [cx, cz] = center(y);
      for (const g of fin ? [mk(false), mk(true)] : [mk(false)]) {
        g.rotateY(-az);
        g.translate(cx, y, cz);
        branch.push(g);
      }
    };
    // A branch: the main spray plus two side sprays forking off halfway, so the crown is a mass of
    // overlapping twigs instead of single sticks.
    const limb = (y, az, L, droop) => {
      spray(y, az, L, droop);
      for (const sgn of [-1, 1]) {
        if (r() < 0.25) continue;
        const f = pick(0.35, 0.55), Ls = L * pick(0.45, 0.65);
        const bx = Math.cos(az) * L * f, bz = Math.sin(az) * L * f;
        const by = y + L * (0.06 * f - droop * f * f) - 0.004;
        const before = branch.length;
        spray(by, az + sgn * pick(0.55, 0.9), Ls, droop * 1.1, false);
        // shift the side spray out to its fork point on the main branch
        for (let i = before; i < branch.length; i++) branch[i].translate(bx, 0, bz);
      }
    };

    // Whorls of branches up the trunk, lengths from a crown profile with per-variant asymmetry.
    const asymDir = r() * TAU;
    const W = Math.round(P.whorls * 1.3) + Math.round(pick(-1, 1));
    for (let k = 0; k < W; k++) {
      const t = k / (W - 1);
      const y = P.base + t * (top * 0.96 - P.base) + pick(-0.012, 0.012);
      const R = P.r0 * Math.pow(1 - t * 0.9, P.shape) + 0.022;   // tops stay bushy, not a bare spike
      const per = P.per + 1 + Math.round(pick(-1, 1));   // dense crowns (director: darker, more lost)
      const az0 = k * 2.39996 + r();                        // golden-angle spiral between whorls
      for (let j = 0; j < per; j++) {
        if (r() < P.skip * 0.35 && t < 0.85) continue;       // missing branches: gaps in the crown
        const az = az0 + (j / per) * TAU + pick(-0.35, 0.35);
        const L = R * (1 + P.asym * Math.cos(az - asymDir)) * pick(0.78, 1.18);
        limb(y, az, Math.max(0.025, L), P.droop * pick(0.75, 1.25) * (1 - 0.4 * t));
      }
    }
    // A dark inner core so you can't see daylight straight through the middle of the crown.
    const coreH = (top - P.base) * 0.9;
    const cone = new THREE.ConeGeometry(P.r0 * 0.4, coreH * 0.78, 6, 1, true);   // fills the crown's heart, stops short of the top
    cone.translate(0, P.base + coreH * 0.36, 0);
    { const p = cone.attributes.position; for (let i = 0; i < p.count; i++) { const [cx, cz] = center(p.getY(i)); p.setX(i, p.getX(i) + cx); p.setZ(i, p.getZ(i) + cz); } }
    scaleUV(cone, 3, 4);
    core.push(cone);

    // Top: a leader, a broken snapped top with a side shoot curling up, or a fork.
    const [tx, tz] = center(top);
    const leader = (ox, oz, lean) => {
      const g = new THREE.ConeGeometry(0.012, 0.04, 5, 1, true);
      g.translate(0, 0.02, 0); g.rotateZ(lean); g.translate(tx + ox, top - 0.01, tz + oz);
      core.push(g);
    };
    if (P.top) {
      for (let i = 0; i < 3; i++) {
        const s = new THREE.ConeGeometry(0.006, 0.03 + r() * 0.04, 4, 1, true);
        s.translate(0, 0.02, 0); s.rotateZ((r() - 0.5) * 0.5); s.translate(tx, top - 0.005, tz);
        dead.push(s);
      }
      leader(0.03, 0, -0.5);
    } else if (P.fork) { leader(-0.012, 0, 0.35); leader(0.012, 0, -0.35); }
    else leader(0, 0, pick(-0.15, 0.15));

    // Dead lower limbs: bare stubs on the trunk below the crown.
    for (let i = 0; i < P.stubs; i++) {
      const y = pick(0.06, Math.max(0.08, P.base));
      const len = pick(0.03, 0.09);
      const l = new THREE.CylinderGeometry(0.0015, 0.004, len, 4, 1, true);
      l.translate(0, len / 2, 0); l.rotateZ(-(1.1 + r() * 0.6)); l.rotateY(r() * TAU);
      const [cx, cz] = center(y); l.translate(cx, y, cz);
      dead.push(l);
    }
    return { bark0: bark, [`branch${n}`]: branch, [`needles${n}`]: core, snagWood: dead };
  }

  snag({ limbs, top, bark }) {
    const r = this.r;
    const wood = [];
    const trunk = new THREE.CylinderGeometry(0.016, 0.034, top, 7, 5, true);
    trunk.translate(0, top / 2, 0);
    scaleUV(trunk, 4, 12 * top);
    wood.push(trunk);
    // Jagged broken top: three splinters.
    for (let i = 0; i < 3; i++) {
      const s = new THREE.ConeGeometry(0.008, 0.05 + r() * 0.06, 4, 1, true);
      s.translate(0, 0.03, 0);
      s.rotateZ((r() - 0.5) * 0.4);
      s.translate((r() - 0.5) * 0.012, top - 0.01, (r() - 0.5) * 0.012);
      wood.push(s);
    }
    for (let i = 0; i < limbs; i++) {
      const len = 0.08 + r() * 0.16;
      const l = new THREE.CylinderGeometry(0.003, 0.009, len, 4, 1, true);
      l.translate(0, len / 2, 0);
      l.rotateZ(-(0.9 + r() * 0.8));             // angled out and up/down
      l.rotateY(r() * TAU);
      l.translate(0, top * (0.35 + r() * 0.55), 0);
      wood.push(l);
    }
    const flare = new THREE.CylinderGeometry(0.025, 0.045, 0.035, 7, 1, true);
    flare.translate(0, 0.0175, 0);
    wood.push(flare);
    return { [bark]: wood };
  }

  bush(v) {
    const r = this.r;
    const leaf = [], sprig = [];
    const blobs = 3 + v + Math.floor(r() * 2);
    const mat = v === 2 ? 1 : 0;
    for (let i = 0; i < blobs; i++) {
      const a = r() * TAU, d = i === 0 ? 0 : 0.25 + r() * 0.35;
      const s = 0.38 + r() * 0.25;
      const g = new THREE.IcosahedronGeometry(1, 1);
      jitterVerts(g, 0.18, r);
      g.scale(s * (1 + r() * 0.3), s * (0.7 + r() * 0.2), s * (1 + r() * 0.3));
      g.translate(Math.cos(a) * d, s * 0.55, Math.sin(a) * d);
      scaleUV(g, 2, 2);
      leaf.push(g);
    }
    // Sprigs poking out of the silhouette.
    for (let i = 0; i < 10 + v * 3; i++) {
      const a = r() * TAU, d = 0.35 + r() * 0.35, h = 0.35 + r() * 0.3;
      const c = new THREE.PlaneGeometry(h * 0.9, h);
      c.translate(0, h / 2, 0);
      c.rotateX(-0.2 - r() * 0.4);
      c.rotateY(-a + Math.PI / 2);
      c.translate(Math.cos(a) * d, 0.15 + r() * 0.35, Math.sin(a) * d);
      sprig.push(c);
    }
    return { [`bush${mat}`]: leaf, [`sprig${mat}`]: sprig };
  }

  fern(v) {
    const r = this.r;
    const fronds = [];
    const n = [8, 11, 6][v], len = [1.05, 1.3, 0.8][v];
    for (let i = 0; i < n; i++) {
      const L = len * (0.75 + r() * 0.35);
      const g = new THREE.PlaneGeometry(0.3 * L, L, 1, 6);
      const pos = g.attributes.position;
      // Fronds rise steeply from the crown, then arch over and droop at the tip.
      const rise = 1.15 + r() * 0.35, fall = 0.85 + r() * 0.3;
      for (let k = 0; k < pos.count; k++) {
        const s = (pos.getY(k) + L / 2) / L;        // 0 base .. 1 tip
        const x = pos.getX(k) * (1 - s * 0.35);
        pos.setXYZ(k, x, L * (rise * s - fall * s * s), L * 0.85 * s);
      }
      g.computeVertexNormals();
      g.rotateY(((i + r() * 0.5) / n) * TAU);
      g.translate(0, 0.02, 0);
      fronds.push(g);
    }
    return { [`fern${v === 2 ? 1 : 0}`]: fronds };
  }

  log(v) {
    const r = this.r;
    const bark = [], ends = [], moss = [];
    // Unit length along X, unit diameter; instance scale = [length, diameter, diameter].
    const body = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 3, true);
    jitterVerts(body, 0.025, r);
    body.rotateZ(Math.PI / 2);
    scaleUV(body, 4, 6);
    bark.push(body);
    const endMat = v === 3 ? 'logEnd1' : 'logEnd0';
    const capL = new THREE.CircleGeometry(0.49, 10); capL.rotateY(-Math.PI / 2); capL.translate(-0.5, 0, 0); ends.push(capL);
    if (v === 2) {
      // Broken end: a ring of splinters instead of a clean cut.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        const s = new THREE.ConeGeometry(0.1, 0.25 + r() * 0.3, 4, 1);
        s.rotateZ(-Math.PI / 2);
        s.translate(0.6, Math.sin(a) * 0.3, Math.cos(a) * 0.3);
        ends.push(s);
      }
      const capR = new THREE.CircleGeometry(0.45, 10); capR.rotateY(Math.PI / 2); capR.translate(0.5, 0, 0); ends.push(capR);
    } else {
      const capR = new THREE.CircleGeometry(0.49, 10); capR.rotateY(Math.PI / 2); capR.translate(0.5, 0, 0); ends.push(capR);
    }
    // Branch stubs.
    for (let i = 0; i < 3 + v; i++) {
      const len = 0.25 + r() * 0.35;
      const s = new THREE.CylinderGeometry(0.03, 0.07, len, 5, 1, true);
      s.translate(0, len / 2 + 0.45, 0);
      s.rotateX((r() - 0.5) * 2.2);
      s.translate(-0.4 + r() * 0.8, 0, 0);
      scaleUV(s, 1, 0.5);
      bark.push(s);
    }
    // Moss blanket over the top (not on the plain log).
    if (v !== 0) {
      const cover = v === 1 ? 1.9 : 1.2;
      const m = new THREE.CylinderGeometry(0.52, 0.52, 0.92, 10, 2, true, Math.PI / 2 - cover / 2, cover);
      m.rotateZ(Math.PI / 2);
      scaleUV(m, 2, 3);
      moss.push(m);
    }
    return { logBark: bark, [endMat]: ends, [`moss${v === 1 ? 1 : 0}`]: moss };
  }

  rock(v) {
    const r = this.r;
    const [sx, sy, sz, rough, detail] = [
      [1.0, 0.7, 0.9, 0.22, 1],   // rounded boulder
      [1.2, 0.55, 1.0, 0.28, 1],  // lumpy boulder
      [1.4, 0.32, 1.1, 0.18, 1],  // flat slab
      [0.6, 1.1, 0.55, 0.22, 1],  // standing stone
      [0.5, 0.35, 0.45, 0.3, 0],  // small rock (scatter)
    ][v];
    const g = new THREE.IcosahedronGeometry(0.5, detail);
    jitterVerts(g, rough, r);
    g.scale(sx, sy, sz);
    // Sit on the ground: flatten what's below a little under y=0, then lift.
    const pos = g.attributes.position;
    let minY = Infinity;
    for (let k = 0; k < pos.count; k++) minY = Math.min(minY, pos.getY(k));
    for (let k = 0; k < pos.count; k++) pos.setY(k, Math.max(pos.getY(k), minY * 0.6) - minY * 0.6 - 0.05);
    g.computeVertexNormals();
    boxUV(g, 2);
    const parts = { [`rock${v === 1 || v === 3 ? 1 : 0}`]: [g] };
    if (v !== 4) parts[`moss0`] = [topFaces(g, 0.82, 1.015)];
    return parts;
  }

  grass(v) {
    const r = this.r;
    const cards = [];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const w = 0.75 + r() * 0.25, h = 0.55 + r() * 0.2 + v * 0.12;
      const c = new THREE.PlaneGeometry(w, h);
      c.translate(0, h / 2 - 0.02, 0);
      c.rotateY((i / n) * Math.PI + r() * 0.3);
      cards.push(c);
    }
    return { [`grass${v}`]: cards };
  }
}

// --- geometry helpers --------------------------------------------------------------------

function prep(g) {
  const out = g.index ? g.toNonIndexed() : g;
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  return out;
}

function xform(g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  return g;
}

function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
}

// Same random offset for vertices that share a position (keeps seams closed).
function hashed(r) {
  const seen = new Map();
  return (x, y, z, make) => {
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    if (!seen.has(key)) seen.set(key, make());
    return seen.get(key);
  };
}

function jitterVerts(g, amt, r) {
  const pos = g.attributes.position, h = hashed(r);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const d = h(x, y, z, () => 1 + (r() - 0.5) * 2 * amt);
    pos.setXYZ(k, x * d, y * d, z * d);
  }
  g.computeVertexNormals();
}

// Tier cone: droop the rim unevenly and push it in/out so the tier edge is ragged.
function jitterRim(g, th, droop, r) {
  const pos = g.attributes.position, h = hashed(r);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    if (y > th / 2 - 1e-4) continue;                 // apex
    const rim = y < -th / 2 + 1e-4;
    const [dy, dr] = h(x, y, z, () => [rim ? -r() * droop * th : (r() - 0.5) * 0.1 * th, 0.82 + r() * (rim ? 0.36 : 0.2)]);
    pos.setXYZ(k, x * dr, y + dy, z * dr);
  }
  g.computeVertexNormals();
}

// Planar UVs by dominant normal axis so textures don't smear on lumpy rocks.
function boxUV(g, scale) {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) { g.copy(ng); }
  g.computeVertexNormals();
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let k = 0; k < pos.count; k += 3) {
    // Use the face normal so each triangle picks one projection.
    const nx = Math.abs(nor.getX(k)), ny = Math.abs(nor.getY(k)), nz = Math.abs(nor.getZ(k));
    for (let j = 0; j < 3; j++) {
      const x = pos.getX(k + j), y = pos.getY(k + j), z = pos.getZ(k + j);
      const [u, v] = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
      uv[(k + j) * 2] = u * scale; uv[(k + j) * 2 + 1] = v * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Copy of the upward-facing triangles, puffed out a little: a moss cap.
function topFaces(g, minNy, puff) {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.attributes.position, uv = src.attributes.uv;
  const p = [], u = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let k = 0; k < pos.count; k += 3) {
    a.fromBufferAttribute(pos, k); b.fromBufferAttribute(pos, k + 1); c.fromBufferAttribute(pos, k + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    if (n.y < minNy) continue;
    for (const v of [a, b, c]) p.push(v.x * puff, v.y * puff + 0.01, v.z * puff);
    for (let j = 0; j < 3; j++) u.push(uv.getX(k + j), uv.getY(k + j));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  out.computeVertexNormals();
  return out;
}
