import * as THREE from 'three';

// Night lighting baseline for outdoor maps (L1): cool moonlight with soft shadows, a blue night
// ambient, haze that's lighter than the trees (so near shapes read as silhouettes against it),
// and a sky that glows toward the moon on the horizon. The flashlight is still needed for detail
// (tracks, faces), but trails and landmark shapes are readable without it.
export const NIGHT_DEFAULTS = Object.freeze({
  moonColor: 0x9db4e8,
  moonIntensity: 0.9,
  moonDir: [0.25, 0.42, -1],       // toward the moon from the ground (here: low in the north)
  ambientSky: 0x34476a,
  ambientGround: 0x0b100c,
  ambientIntensity: 0.75,
  fogColor: 0x162231,
  fogDensity: 0.02,
  skyHorizon: 0x1e2c40,            // matches the haze so the far forest melts into the sky
  skyZenith: 0x04060b,
  moonGlow: 0x5a6f96,
  shadowSize: 70,                  // metres of moon shadow around the player
  flashlightBoost: 2.5,            // the torch must still clearly beat the moon on dark forest materials
});

export class NightLighting {
  constructor({ scene, camera, hemi, moon, flashlight = null, config = {} }) {
    const c = this.cfg = { ...NIGHT_DEFAULTS, ...config };
    this.scene = scene;
    this.camera = camera;
    this.moon = moon;
    this.moonDir = new THREE.Vector3(...c.moonDir).normalize();

    hemi.color.set(c.ambientSky);
    hemi.groundColor.set(c.ambientGround);
    hemi.intensity = c.ambientIntensity;

    moon.color.set(c.moonColor);
    moon.intensity = c.moonIntensity;
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    const s = c.shadowSize / 2;
    Object.assign(moon.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 220 });
    moon.shadow.bias = -0.0008;
    moon.shadow.normalBias = 0.04;
    // The moon's shadows come from things that don't move (trees, rocks, buildings), so the
    // shadow map is only re-rendered when the player has moved a few metres (or every 2 s).
    moon.shadow.autoUpdate = false;
    moon.shadow.needsUpdate = true;
    this.shadowAt = null;
    this.shadowAge = 0;
    scene.add(moon.target);

    if (flashlight) flashlight.baseIntensity *= c.flashlightBoost;
    scene.fog = new THREE.FogExp2(c.fogColor, c.fogDensity);
    scene.background = new THREE.Color(c.fogColor);
    this.sky = this.buildSky();
    scene.add(this.sky);

  }

  buildSky() {
    const c = this.cfg;
    const g = new THREE.Group();
    g.name = 'night-sky';
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(180, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          horizon: { value: new THREE.Color(c.skyHorizon) },
          zenith: { value: new THREE.Color(c.skyZenith) },
          glow: { value: new THREE.Color(c.moonGlow) },
          moonDir: { value: this.moonDir },
        },
        vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 horizon, zenith, glow, moonDir; varying vec3 vDir;
          void main() {
            float h = max(vDir.y, 0.0);
            vec3 col = mix(horizon, zenith, pow(h, 0.45));
            float m = max(dot(vDir, moonDir), 0.0);
            col += glow * (pow(m, 6.0) * 0.55 + pow(m, 60.0) * 0.6);   // haze glow around the moon
            col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.9997, m); // the moon disc
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -10;
    // Sparse stars, brighter toward the zenith; hidden near the horizon by the haze colour.
    const n = 500, pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < n; i++) {
      const y = 0.2 + rnd() * 0.8, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 170, y * 170, Math.sin(a) * r * 170], i * 3);
    }
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ color: 0xaab8d8, size: 1.2, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.7 }));
    stars.renderOrder = -9;
    g.add(dome, stars);
    return g;
  }

  /** Keep the sky centred on the camera and the moon's shadow box around the player. */
  update(focus, dt = 0) {
    this.sky.position.copy(this.camera.position);
    this.shadowAge += dt;
    const moved = !this.shadowAt || Math.hypot(focus.x - this.shadowAt.x, focus.z - this.shadowAt.z) > 4;
    if (!moved && this.shadowAge < 2) return;
    // Re-centre the shadow box on the player, snapped to a grid so the shadows don't swim.
    const snap = 2, fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    const s = this.moonDir;
    this.moon.target.position.set(fx, 0, fz);
    this.moon.position.set(fx + s.x * 100, s.y * 100, fz + s.z * 100);
    this.moon.target.updateMatrixWorld();
    this.moon.shadow.needsUpdate = true;
    this.shadowAt = { x: focus.x, z: focus.z };
    this.shadowAge = 0;
  }
}
