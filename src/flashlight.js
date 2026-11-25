import * as THREE from 'three';

// Handheld flashlight: a spotlight parented to the camera, toggled with F.
export class Flashlight {
  constructor(camera, input) {
    this.light = new THREE.SpotLight(0xfff1d6, 14, 30, THREE.MathUtils.degToRad(24), 0.45, 1.6);
    // Offset slightly right/down like a hand-held torch; aim at a point straight ahead.
    this.light.position.set(0.18, -0.15, 0);
    this.light.target.position.set(0, 0, -10);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.bias = -0.0005;
    camera.add(this.light, this.light.target);
    this.on = true;
    this.light.visible = this.on;
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat && input.locked) this.toggle();
    });
  }

  toggle() {
    this.on = !this.on;
    this.light.visible = this.on;
  }
}
