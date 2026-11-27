import * as THREE from 'three';

// Rain (#104; GDD 1.2 S02/S10, 12.1 weather). The night is dry or raining. Rain soaks you while
// you're out in it (thermoregulation reads `exposure`); a shelter overhead (your tent, the cabin,
// the van, a bivy) keeps it off. It also wets kindling, so a fire only catches under cover.
// Turn it on with ?rain (or ?rain=0.5 for a drizzle), or a map's environment.rain.
// Visual: pixel streaks falling in a box around the camera (one draw call).

export const WEATHER = {
  wetPerSecond: 2.2,       // wetness per second in full rain, unsheltered
  streaks: 900,
  box: 18,                 // metres around the camera
  fall: 14,                // m/s
};

export class Weather {
  constructor({ scene, camera, rain = 0, sheltered = () => null }) {
    this.camera = camera;
    this.rain = rain;                  // 0 dry .. 1 heavy rain
    this.sheltered = sheltered;        // (pos) => name of the shelter over you, or null
    this.shelter = null;
    if (rain > 0) this.buildStreaks(scene);
  }

  /** 0..1: how much rain is reaching you right now. */
  exposure(pos) {
    if (this.rain <= 0) return 0;
    this.shelter = this.sheltered(pos);
    return this.shelter ? 0 : this.rain;
  }

  buildStreaks(scene) {
    const n = Math.round(WEATHER.streaks * Math.max(0.3, this.rain));
    const pos = new Float32Array(n * 6);
    this.offsets = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.offsets[i * 3] = (Math.random() - 0.5) * WEATHER.box * 2;
      this.offsets[i * 3 + 1] = Math.random() * 12;
      this.offsets[i * 3 + 2] = (Math.random() - 0.5) * WEATHER.box * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8fa6b8, transparent: true, opacity: 0.35, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.name = 'rain';
    scene.add(this.lines);
    this.n = n;
  }

  update(dt) {
    if (!this.lines) return;
    const c = this.camera.getWorldPosition(new THREE.Vector3());
    const p = this.lines.geometry.attributes.position.array, o = this.offsets, B = WEATHER.box;
    for (let i = 0; i < this.n; i++) {
      o[i * 3 + 1] -= WEATHER.fall * dt;
      if (o[i * 3 + 1] < -2) o[i * 3 + 1] += 14;
      const x = c.x + (((o[i * 3] - c.x) % (2 * B)) + 3 * B) % (2 * B) - B;   // wraps around you as you walk
      const z = c.z + (((o[i * 3 + 2] - c.z) % (2 * B)) + 3 * B) % (2 * B) - B;
      const y = Math.max(0, c.y - 2 + o[i * 3 + 1]);
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + 0.04; p[i * 6 + 4] = y + 0.5; p[i * 6 + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
