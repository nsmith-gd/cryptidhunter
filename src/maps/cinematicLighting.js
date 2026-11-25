import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAMPS } from '../art/palette.js';

// Cinematic lighting pass for Pine Hollow (art #36), layered on the night baseline
// (maps/nightLighting.js), the atmosphere (maps/atmosphere.js) and the palette grades.
//
//   Key   — the moon: higher-resolution, softer shadow map; flashlight shadow sharpened.
//   Fill  — a dim, cool bounce light from the opposite side (no shadows) so the shadowed fronts
//           of trunks and rocks keep some form instead of going flat black.
//   Rim   — a moonlit fresnel edge on every lit surface, strongest when you look toward the
//           moon: silhouettes of pines, logs and the cryptid pick up a thin cold outline.
//   Shafts— moonbeams slanting through canopy gaps over clearings, trails and the creek, plus a
//           warm beam spilling out of the cabin window and a glow cone under the lookout lamp.
//           Pixel art: alpha is stepped and Bayer-dithered per render pixel, no smooth gradients.
//           Faint dust motes drift inside the beams.
//
// Everything is cheap: one fill light, a few shader instructions per pixel for the rim, and the
// shafts are a handful of crossed-plane cards (a few dozen triangles each).
// ?nocine turns the pass off for comparison.

export const CINE = {
  shadowMap: 2048,           // moon shadow resolution (was 1024)
  flashlightShadowMap: 1024, // was 512
  fillColor: RAMPS.night[4], fillIntensity: 0.22,
  rimColor: RAMPS.night[5], rimStrength: 0.22, rimPower: 5.0,
  shaftColor: RAMPS.night[6], shaftStrength: 0.34,
  warmShaftColor: RAMPS.warm[4], warmShaftStrength: 0.38,
};

export class CinematicLighting {
  constructor({ scene, camera, renderer, night, flashlight, map, rand = Math.random }) {
    this.scene = scene;
    this.camera = camera;
    this.night = night;
    this.time = 0;
    this.moonDir = night ? night.moonDir.clone() : new THREE.Vector3(0.25, 0.42, -1).normalize();
    this.group = new THREE.Group();
    this.group.name = 'cinematic-lighting';
    scene.add(this.group);

    // --- Key: shadow quality -------------------------------------------------------------
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (night) {
      const s = night.moon.shadow;
      s.mapSize.set(CINE.shadowMap, CINE.shadowMap);
      s.map?.dispose(); s.map = null;          // re-allocate at the new size
      s.radius = 2;
      s.needsUpdate = true;
    }
    if (flashlight?.light?.shadow) {
      const fs = flashlight.light.shadow;
      fs.mapSize.set(CINE.flashlightShadowMap, CINE.flashlightShadowMap);
      fs.map?.dispose(); fs.map = null;
    }

    // --- Fill: cool bounce from the side opposite the moon ---------------------------------
    this.fill = new THREE.DirectionalLight(CINE.fillColor, CINE.fillIntensity);
    this.fill.castShadow = false;
    this.fill.name = 'cine-fill';
    const opp = new THREE.Vector3(-this.moonDir.x, 0.6, -this.moonDir.z).normalize();
    this.fill.position.copy(opp.multiplyScalar(100));
    this.fill.target.position.set(0, 0, 0);
    this.group.add(this.fill, this.fill.target);

    // --- Rim: patch every lit material in the scene --------------------------------------
    this.rimUniforms = {
      uRimColor: { value: new THREE.Color(CINE.rimColor).multiplyScalar(CINE.rimStrength) },
      uRimPower: { value: CINE.rimPower },
      uMoonView: { value: new THREE.Vector3() },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.patched = new WeakSet();
    this.patchScene();

    // --- Shafts ----------------------------------------------------------------------------
    this.shaftMats = [];
    if (map?.landmarks) this.buildShafts(map, rand);
  }

  patchScene() {
    this.scene.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) this.patchMaterial(m);
    });
  }

  patchMaterial(m) {
    if (!m || this.patched.has(m)) return;
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
    this.patched.add(m);
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
    const U = this.rimUniforms;
    m.onBeforeCompile = (shader, renderer) => {
      prev?.call(m, shader, renderer);
      Object.assign(shader.uniforms, U);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uRimColor; uniform float uRimPower; uniform vec3 uMoonView; uniform vec3 uUpView;`)
        .replace('#include <opaque_fragment>', `{
          vec3 toCam = normalize(vViewPosition);
          float edge = pow(1.0 - clamp(abs(dot(normal, toCam)), 0.0, 1.0), uRimPower);
          float facing = clamp(dot(-toCam, uMoonView), 0.0, 1.0);   // looking toward the moon
          float notGround = 1.0 - smoothstep(0.35, 0.8, dot(normal, uUpView)); // edges, never the ground or tops
          outgoingLight += uRimColor * edge * notGround * facing * facing * facing * (0.15 + 0.85 * diffuseColor.rgb);
        }
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cineRim`;
    m.needsUpdate = true;
  }

  buildShafts(map, rand) {
    const L = map.landmarks;
    const shaftMat = (color, strength) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        uniforms: {
          uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: { value: 0 },
          uFogDensity: { value: this.scene.fog?.density ?? 0.02 },
        },
        vertexShader: `
          varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
          void main() {
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            vNormalW = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uStrength; uniform float uTime; uniform float uFogDensity;
          varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
          float bayer(vec2 p) {
            int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
            int i = x + y * 4;
            int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
            return float(m[i]) / 16.0;
          }
          void main() {
            vec3 toCam = cameraPosition - vWorld; float dist = length(toCam); toCam /= dist;
            float across = 1.0 - abs(vUv.x * 2.0 - 1.0);            // soft beam edges
            float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y); // fades at the top and where it lands
            float face = abs(dot(vNormalW, toCam));                // planes seen edge-on fade out
            float near = smoothstep(1.5, 7.0, dist);                // don't show the card when you're inside it
            float haze = exp(-uFogDensity * dist * 0.6);            // distant beams sink into the haze
            float flick = 0.9 + 0.1 * sin(uTime * 0.7 + vWorld.x * 0.3 + vWorld.z * 0.2); // slow shimmer of the air
            float a = across * across * along * face * near * haze * flick * uStrength;
            // Pixel art: three stepped levels, ordered-dithered between them per render pixel.
            float lv = a * 3.0 / max(uStrength, 1e-3);
            float q = floor(lv + bayer(gl_FragCoord.xy));
            q = clamp(q, 0.0, 3.0) / 3.0 * uStrength;
            if (q <= 0.0) discard;
            gl_FragColor = vec4(uColor * q, 1.0);
          }`,
      });
      this.shaftMats.push(mat);
      return mat;
    };
    const moonMat = shaftMat(CINE.shaftColor, CINE.shaftStrength);
    const warmMat = shaftMat(CINE.warmShaftColor, CINE.warmShaftStrength);

    // Three planes crossed about the beam axis read as a volume from any side.
    const beamGeo = (width, length) => {
      const geos = [];
      for (let k = 0; k < 3; k++) {
        const g = new THREE.PlaneGeometry(width, length, 1, 1);
        g.translate(0, length / 2, 0);          // v=0 at the base (ground), v=1 at the top
        g.rotateY((k / 3) * Math.PI);
        geos.push(g);
      }
      return geos;
    };
    // All beams of one material are baked into a single mesh (one draw call each).
    const pending = new Map();
    const addBeam = (mat, base, dir, width, length) => {
      const m4 = new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, 1, 1));
      if (!pending.has(mat)) pending.set(mat, []);
      for (const g of beamGeo(width, length)) pending.get(mat).push(g.applyMatrix4(m4));
    };
    const flushBeams = () => {
      for (const [mat, geos] of pending) {
        const m = new THREE.Mesh(mergeGeometries(geos), mat);
        m.frustumCulled = false;
        m.renderOrder = 3;
        m.name = 'cine-shafts';
        this.group.add(m);
      }
    };

    // Moonbeams: ground points in open sky (clearings, trail bends, creek), each beam rising
    // toward the moon through the canopy gap above it.
    const up = this.moonDir.clone().normalize();
    const spots = [];
    const ring = (c, r, n) => { for (let i = 0; i < n; i++) { const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r; spots.push([c.x + Math.cos(a) * d, c.z + Math.sin(a) * d]); } };
    for (const key of ['trailhead', 'cabin', 'campsite', 'boulders', 'lookout', 'hollow', 'footbridge', 'fork']) if (L[key]) ring(L[key], 9, key === 'fork' ? 2 : 4);
    for (const t of map.trails ?? []) for (let i = 1; i < t.length - 1; i += 2) spots.push([t[i].x + (rand() - 0.5) * 3, t[i].z + (rand() - 0.5) * 3]);
    for (const [x, z] of spots) {
      const canopy = 13 + rand() * 6;                         // where the beam enters through the crowns
      const length = canopy / Math.max(0.25, up.y);
      addBeam(moonMat, new THREE.Vector3(x, 0, z), up, 0.9 + rand() * 2.2, length);
    }

    // Warm beam out of the cabin window (south wall), angled slightly down onto the clearing.
    if (L.cabin) {
      const base = new THREE.Vector3(L.cabin.x, 0.05, L.cabin.z + 3 + 5.5);
      const dir = new THREE.Vector3(0, 0.27, -1).normalize();   // from the ground back up to the window
      addBeam(warmMat, base, dir, 1.6, 6.2);
    }
    // Glow cone under the lookout lamp.
    // A short warm spill just under the cab window; the legs stay a dark silhouette for navigation.
    if (L.lookout) addBeam(warmMat, new THREE.Vector3(L.lookout.x, 13.6, L.lookout.z + 4.1), new THREE.Vector3(0, 1, -0.4).normalize(), 2.8, 4.4);

    flushBeams();

    // Dust motes drifting in the beams (tiny lit pixels).
    const n = 260, pos = new Float32Array(n * 3);
    this.motes = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[Math.floor(rand() * spots.length)] ?? [0, 0];
      const h = 0.4 + rand() * 5;
      const p = [x + up.x / up.y * h + (rand() - 0.5) * 1.2, h, z + up.z / up.y * h + (rand() - 0.5) * 1.2];
      this.motes.push([...p, rand() * 6.28]);
      pos.set(p, i * 3);
    }
    const mg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.moteGeo = mg;
    const motes = new THREE.Points(mg, new THREE.PointsMaterial({
      color: CINE.shaftColor, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    motes.frustumCulled = false;
    motes.name = 'cine-motes';
    this.group.add(motes);
  }

  update(dt) {
    this.time += dt;
    // Materials created after start-up (clues, cryptid parts, gear) get the rim too.
    if ((this.repatchIn = (this.repatchIn ?? 2) - dt) <= 0) { this.repatchIn = 2; this.patchScene(); }
    // Rim: moon direction in view space (the camera moves every frame).
    this.camera.updateMatrixWorld();
    this.rimUniforms.uMoonView.value.copy(this.moonDir).transformDirection(this.camera.matrixWorldInverse);
    this.rimUniforms.uUpView.value.set(0, 1, 0).transformDirection(this.camera.matrixWorldInverse);
    for (const m of this.shaftMats) { m.uniforms.uTime.value = this.time; if (this.scene.fog?.density) m.uniforms.uFogDensity.value = this.scene.fog.density; }
    if (this.moteGeo) {
      const a = this.moteGeo.attributes.position;
      for (let i = 0; i < this.motes.length; i++) {
        const [x, y, z, ph] = this.motes[i];
        a.setXYZ(i, x + Math.sin(this.time * 0.13 + ph) * 0.35, y + Math.sin(this.time * 0.09 + ph * 2) * 0.25, z + Math.cos(this.time * 0.11 + ph) * 0.35);
      }
      a.needsUpdate = true;
    }
  }
}
