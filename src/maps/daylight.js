import * as THREE from 'three';
import { timeOfDayConfig } from './atmosphere.js';

// Daylight trip (#129, Oro-Medonte): the outdoor lighting rig (maps/nightLighting.js) starts on an
// afternoon grade and eases through the palette's dusk grade to night as the trip clock runs out.
// After the deadline it keeps darkening for a few minutes into full night: the way back gets hard
// to read, which is the point (GDD L02: "darkness, terrain, thirst").
//   progress 0 -> 0.7   afternoon, the sun slowly lowering and warming
//   0.7 -> 1.0          dusk (warm low sun, violet shadow)
//   1.0 -> 1.0 + after  night falls
export class DaylightCycle {
  constructor({ night, hemi, scene, day, after = 180 }) {
    this.night = night; this.hemi = hemi; this.scene = scene; this.after = after;
    this.stops = [
      [0, day], [0.7, { ...day, ...timeOfDayConfig('forest', 'dusk'), fogDensity: 0.016 }], [1, timeOfDayConfig('forest', 'dusk')],
      [1 + after / 1e9, timeOfDayConfig('forest', 'night')],   // placeholder: replaced per-update by `afterFrac`
    ];
    this.night3 = timeOfDayConfig('forest', 'night');
    this.c = { a: new THREE.Color(), b: new THREE.Color() };
    this.progress = 0;
  }

  /** elapsed / limit (0..1 and beyond), and seconds since the limit when past it. */
  update(progress, pastSeconds = 0) {
    this.progress = progress;
    let a, b, k;
    if (progress < 0.7) { a = this.stops[0][1]; b = this.stops[1][1]; k = progress / 0.7; }
    else if (progress < 1) { a = this.stops[1][1]; b = this.stops[2][1]; k = (progress - 0.7) / 0.3; }
    else { a = this.stops[2][1]; b = this.night3; k = Math.min(1, pastSeconds / this.after); }
    this.apply(a, b, k);
  }

  apply(A, B, k) {
    const col = (x, y) => this.c.a.set(x).lerp(this.c.b.set(y), k);
    const num = (x, y) => x + (y - x) * k;
    const n = this.night, moon = n.moon;
    this.hemi.color.copy(col(A.ambientSky, B.ambientSky));
    this.hemi.groundColor.copy(col(A.ambientGround, B.ambientGround));
    this.hemi.intensity = num(A.ambientIntensity, B.ambientIntensity);
    moon.color.copy(col(A.moonColor, B.moonColor));
    moon.intensity = num(A.moonIntensity, B.moonIntensity);
    const da = new THREE.Vector3(...A.moonDir).normalize(), db = new THREE.Vector3(...B.moonDir).normalize();
    n.moonDir.copy(da.lerp(db, k).normalize());
    if (this.scene.fog) { this.scene.fog.color.copy(col(A.fogColor, B.fogColor)); this.scene.fog.density = num(A.fogDensity, B.fogDensity); }
    this.scene.background?.copy?.(this.scene.fog.color);
    const u = n.sky.children[0]?.material?.uniforms;
    if (u) { u.horizon.value.copy(col(A.skyHorizon, B.skyHorizon)); u.zenith.value.copy(col(A.skyZenith, B.skyZenith)); u.glow.value.copy(col(A.moonGlow, B.moonGlow)); }
    const stars = n.sky.children[1];
    if (stars) stars.material.opacity = 0.7 * Math.max(0, (this.progress - 0.95) * 4);
    n.shadowAge = 99;   // re-aim the sun's shadow at the next update
  }
}
