import * as THREE from 'three';
import { pixelTexture } from '../art/pixelTex.js';
import { GRADES } from '../art/grading.js';

// Forest atmosphere (#37): makes depth read in three clear layers.
//   foreground — near trunks and ground stay crisp and dark (only light fog);
//   midground  — low ground mist pooling between the trees and a thin fog curtain ~30 m out;
//   background — a denser haze wall ~70 m out that swallows the far forest into the sky colour.
// The curtains travel with the player (they're the "air", not objects), the mist drifts slowly.
// Everything is tinted from the scene's fog colour, so it follows the grade (dusk / night).

/** Soft pixel mist puff, 32 x 16: alpha in 3 stepped bands with a Bayer edge, so it stays pixel art. */
function mistTexture() {
  return pixelTexture('mistPuff2', 64, 24, (g, px, r, w, h) => {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    // Soft lens of mist: 5 stepped alpha bands, Bayer-dithered where bands meet (no hard box edge).
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - w / 2 + 0.5) / (w / 2), dy = (y - h * 0.62) / (h * 0.5);
      const d = Math.sqrt(dx * dx + dy * dy * 1.4) + (r() - 0.5) * 0.12;
      const a = Math.max(0, 1 - d) * 4.99;                         // 0 .. 5
      const t = bayer[(y & 3) * 4 + (x & 3)] / 16;
      const level = Math.min(5, Math.floor(a + t));
      if (!level) continue;
      g.fillStyle = `rgba(255,255,255,${[0, 0.12, 0.25, 0.42, 0.6, 0.75][level]})`;
      g.fillRect(x, y, 1, 1);
    }
  }, { seed: 909, alpha: false });
}

export class Atmosphere {
  /**
   * @param {object} o { scene, camera, half (map half-size), keepClear(x,z) -> true for open ground }
   */
  constructor({ scene, camera, half, keepClear = () => true, rng = Math.random, hazeColor = null, glowColor = null }) {
    this.scene = scene;
    this.camera = camera;
    // Haze is the sky's horizon glow (lighter than the trees), so far silhouettes separate from near ones.
    const fogColor = (scene.fog?.color ?? new THREE.Color(0x162231)).clone();
    const haze = new THREE.Color(hazeColor ?? fogColor).lerp(new THREE.Color(glowColor ?? hazeColor ?? fogColor), 0.3);
    this.haze = haze;
    this.group = new THREE.Group();
    this.group.name = 'atmosphere';
    scene.add(this.group);

    // --- Ground mist: puffs hugging the ground in open spots (clearings, trails, the creek). --
    this.mistMat = new THREE.SpriteMaterial({ map: mistTexture(), color: haze.clone().lerp(new THREE.Color(0xffffff), 0.12),
      transparent: true, opacity: 0.6, depthWrite: false, fog: true });
    this.mistMat.map.magFilter = THREE.NearestFilter;
    this.puffs = [];
    for (let i = 0, n = 0; i < 4000 && n < 420; i++) {
      const x = (rng() * 2 - 1) * (half - 4), z = (rng() * 2 - 1) * (half - 4);
      if (!keepClear(x, z) && rng() < 0.75) continue;               // mostly in the open, some under trees
      const s = new THREE.Sprite(this.mistMat);
      const w = 4 + rng() * 5;
      s.scale.set(w, w * 0.3, 1);
      s.position.set(x, 0.2 + rng() * 0.35, z);
      s.userData = { x, z, ph: rng() * 6.28, sp: 0.15 + rng() * 0.25 };
      s.renderOrder = 2;
      this.group.add(s);
      this.puffs.push(s);
      n++;
    }

    // --- Fog curtains: open cylinders around the player, opaque at the ground, fading upward.
    const curtain = (radius, height, alpha) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
        uniforms: { color: { value: haze.clone() }, alpha: { value: alpha }, height: { value: height } },
        vertexShader: 'varying float vY; void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 color; uniform float alpha; uniform float height; varying float vY;
          void main() {
            float t = clamp(vY / height + 0.5, 0.0, 1.0);          // 0 ground .. 1 top
            float a = alpha * pow(1.0 - t, 1.6);
            a = floor(a * 6.0 + 0.5) / 6.0;                          // stepped: banded haze, not a smooth gradient
            gl_FragColor = vec4(color, a);
            #include <colorspace_fragment>
          }`,
      });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24, 1, true), mat);
      m.position.y = height / 2 - 0.5;
      m.renderOrder = 1;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.near = curtain(16, 5, 0.22);      // a breath of haze between foreground and midground
    this.mid = curtain(34, 10, 0.55);      // midground veil
    this.far = curtain(70, 28, 1.0);       // background haze wall
  }

  update(dt) {
    const c = this.camera.position;
    for (const k of [this.near, this.mid, this.far]) k.position.set(c.x, k.position.y, c.z);
    const t = performance.now() / 1000;
    for (const s of this.puffs) {
      const u = s.userData;
      s.position.x = u.x + Math.sin(t * 0.05 * u.sp + u.ph) * 2.5;
      s.position.z = u.z + Math.cos(t * 0.04 * u.sp + u.ph) * 2;
      // Mist lives in the middle distance: puffs right around you would read as flat cards.
      s.visible = Math.hypot(s.position.x - c.x, s.position.z - c.z) > 8;
    }
  }

  /** Retint after the scene's fog colour changes (e.g. a new grade). */
  retint() {
    for (const k of [this.near, this.mid, this.far]) k.material.uniforms.color.value.copy(this.haze);
    this.mistMat.color.copy(this.haze).lerp(new THREE.Color(0xffffff), 0.12);
  }
}

/**
 * Night-lighting config for a time of day, from the palette grades (src/art/grading.js).
 * Used for ?time=dusk|night|dawn on outdoor maps.
 */
export function timeOfDayConfig(biome, time) {
  const G = GRADES[`${biome}-${time}`];
  if (!G) return null;
  return {
    moonColor: G.key, moonIntensity: G.keyIntensity, moonDir: G.keyDir,
    ambientSky: G.ambientSky, ambientGround: G.ambientGround, ambientIntensity: G.ambient,
    fogColor: G.fog, fogDensity: G.fogDensity * 0.55, skyHorizon: G.horizon, skyZenith: G.sky, moonGlow: G.horizon,
  };
}
