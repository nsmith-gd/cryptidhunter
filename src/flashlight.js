import * as THREE from 'three';

export const FLASHLIGHT = {
  intensity: 14,
  batteryLife: 120,      // seconds of light per battery
  lowLevel: 0.15,        // below this the beam dims and flickers
  startSpares: 1,
};

// Handheld flashlight: a spotlight parented to the camera. F toggles it, R swaps in a spare battery.
export class Flashlight {
  constructor(camera, input) {
    this.light = new THREE.SpotLight(0xfff1d6, FLASHLIGHT.intensity, 30, THREE.MathUtils.degToRad(24), 0.45, 1.6);
    // Offset slightly right/down like a hand-held torch; aim at a point straight ahead.
    this.light.position.set(0.18, -0.15, 0);
    this.light.target.position.set(0, 0, -10);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.bias = -0.0005;
    camera.add(this.light, this.light.target);
    this.baseIntensity = FLASHLIGHT.intensity; // maps can scale this (dark materials outdoors)
    this.battery = 1;            // 0..1 charge of the battery in the torch
    this.spares = FLASHLIGHT.startSpares;
    this.on = true;
    this.light.visible = this.on;
    this.t = 0;
    addEventListener('keydown', (e) => {
      if (!input.locked || e.repeat) return;
      if (e.code === 'KeyF') this.toggle();
      if (e.code === 'KeyR') this.swapBattery();
    });
  }

  toggle() {
    if (!this.on && this.battery <= 0) { this.on = false; return; } // dead: clicks but nothing happens
    this.on = !this.on;
    this.light.visible = this.on;
  }

  swapBattery() {
    if (this.spares <= 0 || this.battery >= 1) return false;
    this.spares--;
    this.battery = 1;
    return true;
  }

  addSpare(n = 1) { this.spares += n; }

  update(dt) {
    this.t += dt;
    if (this.on) {
      this.battery = Math.max(0, this.battery - dt / FLASHLIGHT.batteryLife);
      if (this.battery === 0) { this.on = false; }
    }
    this.light.visible = this.on;
    // Low battery: beam dims and stutters so the player knows to swap.
    let k = 1;
    if (this.battery < FLASHLIGHT.lowLevel) {
      k = 0.35 + 0.65 * (this.battery / FLASHLIGHT.lowLevel);
      if (Math.sin(this.t * 23) * Math.sin(this.t * 7.3) > 0.85) k *= 0.25;
    }
    this.light.intensity = this.baseIntensity * k;
  }
}
