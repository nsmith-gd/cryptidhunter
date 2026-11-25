import * as THREE from 'three';
import { RAMPS } from './palette.js';

// Stylized pixel water (swamp). Patches the map's own water materials (keeps their painted
// texture) and adds, in keeping with the art style guide:
//  · texel-snapped ripples: the surface normal is computed on the 32-texels-per-metre world grid
//    and animated in steps, so ripples read as crisp pixel shapes and never swim or shimmer;
//  · rings from things touching the water (drips, insects), expanding and fading in pixel steps;
//  · pixelated planar reflections: the scene mirrored in the water, rendered at half the game's
//    already-low resolution and nearest-sampled, broken up by the ripples;
//  · a moonlight sheen: a posterized streak of the moon's colour along the ripple crests toward the
//    moon, and warm glints from lamps through the regular lighting;
//  · palette discipline: the result is posterized into a few value bands per channel with a 4x4
//    ordered dither only at band edges, and the base colours come from the `water` ramp.
export const PIXEL_WATER = {
  texelsPerMetre: 32,
  rippleFps: 10,              // ripple animation steps per second (painterly, stable)
  reflectionScale: 0.5,       // reflection target size relative to the game's render target
  reflectStrength: 1.0,
  distortion: 0.02,          // how much the ripples break up the reflection (in screen UV)
  sheen: 0.9,                 // moon streak brightness
  bands: 15,                  // posterize levels per channel (display gamma)
  every: 2,                   // render the reflection every N frames (ripples step at 10/s anyway)
  far: 70,                    // metres the mirror sees (the swamp haze hides everything past ~40 m)
};

const hex = (h) => new THREE.Color(h);

export class PixelWater {
  /**
   * @param {object} o { renderer, scene, camera, height, moonDir?: Vector3, moonColor?: Color }
   */
  constructor({ renderer, scene, camera, height, moonDir = new THREE.Vector3(-0.35, 0.38, -1), moonColor = new THREE.Color(0xb4c8c0) }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.height = height;
    this.meshes = [];
    this.frame = 0;
    this.time = { value: 0 };
    this.rt = new THREE.WebGLRenderTarget(2, 2, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
    this.mirror = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.uniforms = {
      uTime: this.time,
      uReflection: { value: this.rt.texture },
      uTexMatrix: { value: this.textureMatrix },
      uMoonDir: { value: moonDir.clone().normalize() },
      uMoonColor: { value: moonColor.clone() },
      uReflectStrength: { value: PIXEL_WATER.reflectStrength },
      uDistortion: { value: PIXEL_WATER.distortion },
      uSheen: { value: PIXEL_WATER.sheen },
      uBands: { value: PIXEL_WATER.bands },
      uTexels: { value: PIXEL_WATER.texelsPerMetre },
      uFps: { value: PIXEL_WATER.rippleFps },
      uDeepTint: { value: hex(RAMPS.water[1]) },
      uShallowTint: { value: hex(RAMPS.water[3]) },
      uGlint: { value: hex(RAMPS.water[6]) },
    };
  }

  /** Patch the map's water surfaces (meshes named water-shallow / water-deep) (keeps its painted texture). */
  applyToScene(root = this.scene) {
    const seen = new Set();
    root.traverse((o) => { if (o.isMesh && /^water-(shallow|deep)$/.test(o.name) && !seen.has(o.material)) { seen.add(o.material); this.patch(o.material, /deep/.test(o.name)); } });
    root.traverse((o) => { if (o.isMesh && /^water-(shallow|deep)$/.test(o.name)) this.meshes.push(o); });
    return this.meshes.length;
  }

  patch(mat, deep) {
    mat.roughness = deep ? 0.3 : 0.38;   // glossy enough for warm lamp glints
    mat.metalness = 0.0;
    mat.color = hex(deep ? 0x8aa0a0 : 0xa8bcb4);
    mat.userData.pixelWater = true;
    const U = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U, { uDeep: { value: deep ? 1 : 0 } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uTexMatrix;\nvarying vec4 vReflCoord;\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec4 pwWorld = modelMatrix * vec4(transformed, 1.0);\nvWPos = pwWorld.xyz;\nvReflCoord = uTexMatrix * pwWorld;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime, uReflectStrength, uDistortion, uSheen, uBands, uTexels, uFps, uDeep;
uniform sampler2D uReflection;
uniform vec3 uMoonDir, uMoonColor, uDeepTint, uShallowTint, uGlint;
varying vec4 vReflCoord;
varying vec3 vWPos;
vec3 pwN;   // world-space ripple normal
float pwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Ripple height on the texel grid at time t (sum of slow swells + drifting cat's-paws + rings).
float pwHeight(vec2 p, float t) {
  // Swamp water is nearly still: long, low swells plus fine cat's-paws that catch the moon.
  float h = 0.0;
  h += sin(dot(p, vec2(0.83, 0.56)) * 1.3 + t * 0.6) * 0.12;
  h += sin(dot(p, vec2(-0.47, 0.88)) * 2.2 - t * 0.8) * 0.08;
  float paw = smoothstep(0.35, 1.0, sin(dot(p, vec2(0.3, 0.95)) * 0.45 + t * 0.25) * 0.5 + 0.5);   // wind patches
  h += sin(dot(p, vec2(0.97, -0.24)) * 9.0 + t * 2.6) * 0.06 * paw;
  h += sin(dot(p, vec2(-0.6, -0.8)) * 13.0 - t * 3.1) * 0.04 * paw;
  // Rings: one per 3 m cell, each on its own slow cycle (something touched the water).
  vec2 cell = floor(p / 3.0), c = (cell + 0.5 + (vec2(pwHash(cell), pwHash(cell + 7.3)) - 0.5) * 1.6) * 3.0;
  float ph = fract(t * 0.18 + pwHash(cell + 3.1)), r = ph * 1.6, d = length(p - c);
  h += (1.0 - ph) * 0.35 * smoothstep(0.08, 0.0, abs(d - r)) * step(0.55, pwHash(cell + 9.7));
  return h;
}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // Snap to the world texel grid and step time: crisp, stable pixel ripples.
  vec2 tp = (floor(vWPos.xz * uTexels) + 0.5) / uTexels;
  float t = floor(uTime * uFps) / uFps;
  float e = 1.0 / uTexels;
  float hx = pwHeight(tp + vec2(e, 0.0), t) - pwHeight(tp - vec2(e, 0.0), t);
  float hz = pwHeight(tp + vec2(0.0, e), t) - pwHeight(tp - vec2(0.0, e), t);
  float k = mix(1.0, 0.7, uDeep);
  pwN = normalize(vec3(-hx * k, 1.0, -hz * k) );
  normal = normalize((viewMatrix * vec4(pwN, 0.0)).xyz);
}`)
        .replace('#include <opaque_fragment>', `{
  vec3 V = normalize(cameraPosition - vWPos);
  // Pixelated reflection, broken up by the ripples (offsets snap to whole reflection texels).
  vec2 ruv = vReflCoord.xy / vReflCoord.w;
  vec2 rs = vec2(textureSize(uReflection, 0));
  ruv += floor(pwN.xz * uDistortion * rs + 0.5) / rs;
  vec3 refl = texture2D(uReflection, ruv).rgb;
  refl /= 1.0 + 2.5 * max(refl.r, max(refl.g, refl.b));   // soft-compress bright sky glow: a hint of the moon, not a blot
  // Still water is a dark mirror: strong reflection, a little stronger at grazing angles.
  float fres = 0.35 + 0.65 * pow(1.0 - clamp(dot(V, pwN), 0.0, 1.0), 3.0);
  vec3 tint = mix(uShallowTint, uDeepTint, uDeep);
  // The surface's own lighting (murk lit by your torch or a lamp) still shows under the mirror.
  outgoingLight = outgoingLight * (1.0 - 0.6 * fres) + refl * (0.9 + tint * 2.0) * clamp(fres * uReflectStrength, 0.0, 1.0);
  // Moon path: a narrow streak toward the moon, broken into glints by the cat's-paws.
  vec3 R = reflect(-V, pwN);
  float m = max(dot(R, normalize(uMoonDir)), 0.0);
  float core = pow(m, 2400.0), halo = pow(m, 500.0);
  // A small bright core, and a halo that only sparkles on texels where the cat's-paws tilt it.
  float sparkle = step(0.78, fract(sin(dot(floor(vWPos.xz * uTexels), vec2(12.9898, 78.233)) + floor(uTime * uFps)) * 43758.5453));
  float s = core > 0.5 ? 1.0 : (halo > 0.3 ? 0.55 * sparkle : 0.0);
  outgoingLight += mix(uMoonColor, uGlint, 0.5) * s * uSheen * (1.0 - 0.4 * uDeep);
}
#include <opaque_fragment>
{
  // Posterize in display gamma with a 4x4 ordered dither that only bites at band edges.
  const mat4 bayer = mat4(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0) / 16.0;
  ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
  float th = bayer[q.x][q.y] - 0.5;
  vec3 g = pow(max(gl_FragColor.rgb, 0.0), vec3(1.0 / 2.2));
  g = floor(g * uBands + 0.5 + th * 0.22) / uBands;   // dither only within ~a fifth of a band of each edge
  gl_FragColor.rgb = pow(max(g, 0.0), vec3(2.2));
}`);
    };
    mat.customProgramCacheKey = () => `pixelWater-${deep ? 1 : 0}`;
    mat.needsUpdate = true;
  }

  update(dt) { this.time.value += dt; }

  /** Render the mirrored scene into the reflection target. Call before the main render. */
  renderReflection() {
    if (!this.meshes.length) return;
    if (this.frame++ % PIXEL_WATER.every) return;
    const r = this.renderer, cam = this.camera, h = this.height;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(size.x * PIXEL_WATER.reflectionScale)), ht = Math.max(2, Math.round(size.y * PIXEL_WATER.reflectionScale));
    if (this.rt.width !== w || this.rt.height !== ht) this.rt.setSize(w, ht);
    cam.updateMatrixWorld();
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    if (camPos.y < h) return;                       // below the surface: nothing to mirror
    const normal = new THREE.Vector3(0, 1, 0), plane = new THREE.Vector3(camPos.x, h, camPos.z);
    // Mirror the camera about the water plane (as three's Reflector does).
    const rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const view = plane.clone().sub(camPos).reflect(normal).negate().add(plane);
    const target = plane.clone().sub(look).reflect(normal).negate().add(plane);
    const m = this.mirror;
    m.position.copy(view);
    m.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    m.lookAt(target);
    m.near = cam.near; m.far = Math.min(cam.far, PIXEL_WATER.far); m.fov = cam.fov; m.aspect = cam.aspect;
    m.updateMatrixWorld();
    m.updateProjectionMatrix();
    // Texture matrix: world -> reflection UV.
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
    // Oblique near plane at the water surface so nothing below it shows up in the reflection.
    const clip = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, h, 0)).applyMatrix4(m.matrixWorldInverse);
    const cp = new THREE.Vector4(clip.normal.x, clip.normal.y, clip.normal.z, clip.constant);
    const pm = m.projectionMatrix, q = new THREE.Vector4(
      (Math.sign(cp.x) + pm.elements[8]) / pm.elements[0], (Math.sign(cp.y) + pm.elements[9]) / pm.elements[5], -1, (1 + pm.elements[10]) / pm.elements[14]);
    cp.multiplyScalar(2 / cp.dot(q));
    pm.elements[2] = cp.x; pm.elements[6] = cp.y; pm.elements[10] = cp.z + 1; pm.elements[14] = cp.w;

    for (const o of this.meshes) o.visible = false;
    const prevTarget = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;                 // reuse this frame's shadow maps
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, m);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevShadow;
    for (const o of this.meshes) o.visible = true;
  }
}
