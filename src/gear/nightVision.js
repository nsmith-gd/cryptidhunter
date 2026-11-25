import * as THREE from 'three';

// Night-vision goggles (Hunting Gear, L1): V toggles them. You see the dark world in amplified
// green without any visible light, but through a narrower tube, and they drain the same battery
// pack as the flashlight (faster). Cryptids can't see their infrared, so unlike the flashlight
// they don't give you away.
export const NVG = {
  fov: 50,             // degrees: narrower than the naked-eye 75
  drain: 1 / 90,       // battery per second while on (flashlight: 1/120)
  irBoost: 1.1,        // extra (invisible) infrared illumination, only seen through the goggles
  gain: 4,             // image amplification (after gamma)
};

export class NightVision {
  constructor({ renderer, scene, camera, flashlight, hemi, input, photo = null, notify = () => {} }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.flashlight = flashlight;
    this.hemi = hemi;
    this.photo = photo;
    this.notify = notify;
    this.on = false;
    this.time = 0;
    this.nakedFov = camera.fov;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: this.rt.texture }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, gain: { value: NVG.gain } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; uniform float gain; varying vec2 vUv;
        float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          l = pow(max(l, 0.0), 0.4545);                               // the render target is linear: to display gamma
          l = 1.0 - exp(-l * gain);                                   // amplify the dark, compress highlights
          vec2 px = floor(vUv * res);
          l += (rand(px + fract(time) * 91.7) - 0.5) * 0.14;          // sensor grain
          l *= 0.9 + 0.1 * step(0.5, fract(px.y * 0.5));               // scanlines
          vec2 d = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
          float mask = smoothstep(0.5, 0.44, length(d));               // the tube
          gl_FragColor = vec4(vec3(0.22, 1.0, 0.32) * clamp(l, 0.0, 1.0) * mask, 1.0);
        }`,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyV' && !e.repeat && input.locked) this.toggle();
    });
  }

  toggle(want = !this.on) {
    if (want && this.flashlight.battery <= 0) { this.notify('Night vision: battery is dead. Swap one in with R.'); return; }
    this.on = want;
    const fov = want ? NVG.fov : this.nakedFov;
    if (this.photo) this.photo.baseFov = fov;          // the camera zooms from whatever you're looking through
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt;
    if (!this.on) return;
    // A bigger battery (shop upgrade) lasts proportionally longer in the goggles too.
    const life = this.flashlight.batteryLife ? 120 / this.flashlight.batteryLife : 1;
    this.flashlight.battery = Math.max(0, this.flashlight.battery - NVG.drain * life * dt);
    if (this.flashlight.battery <= 0) { this.toggle(false); this.notify('Night vision: battery dead.'); }
  }

  /** Renders the frame through the goggles. Returns false (doing nothing) when they're off. */
  render() {
    if (!this.on) return false;
    const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y);
    this.material.uniforms.res.value.copy(size);
    this.material.uniforms.time.value = this.time;
    // Invisible infrared fill: only exists in the goggle image.
    const base = this.hemi.intensity;
    this.hemi.intensity = base + NVG.irBoost;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    this.hemi.intensity = base;
    r.render(this.quadScene, this.quadCam);
    return true;
  }
}
