import * as THREE from 'three';

// Placeholder camera for the greybox loop: left-click snaps a photo of whatever cryptid is
// near the crosshair and in line of sight. The real camera (#4) should replace this and call
// the same onPhoto({ subject, distance }) hook.
export const PHOTO = {
  range: 35,                                    // metres
  minCone: THREE.MathUtils.degToRad(4),         // forgiving aim near the crosshair
  cooldown: 0.8,
};

export class PhotoSnap {
  constructor({ camera, scene, input, getSubjects, onPhoto }) {
    this.camera = camera;
    this.scene = scene;
    this.getSubjects = getSubjects;   // () => [{ name, object3d, center: Vector3, radius }]
    this.onPhoto = onPhoto;
    this.cooldown = 0;
    this.raycaster = new THREE.Raycaster();
    this.enabled = true;
    addEventListener('mousedown', (e) => {
      if (e.button === 0 && input.locked) this.snap();
    });
    this.buildFeedback();
  }

  update(dt) { this.cooldown = Math.max(0, this.cooldown - dt); }

  /** Returns { subject, distance } (subject null if nothing usable was in frame). */
  snap() {
    if (!this.enabled || this.cooldown > 0) return null;
    this.cooldown = PHOTO.cooldown;
    const result = this.evaluate();
    this.flash(result);
    this.onPhoto?.(result);
    return result;
  }

  evaluate() {
    const eye = this.camera.position;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    let best = null;
    for (const s of this.getSubjects()) {
      if (!s.object3d.visible) continue;
      const to = s.center.clone().sub(eye);
      const dist = to.length();
      if (dist > PHOTO.range) continue;
      const cone = Math.max(PHOTO.minCone, Math.atan2(s.radius * 1.5, dist));
      const angle = fwd.angleTo(to);
      if (angle > cone) continue;
      if (!this.lineOfSight(eye, to, dist, s.object3d)) continue;
      if (!best || angle < best.angle) best = { subject: s.name, distance: dist, angle };
    }
    return best ? { subject: best.subject, distance: best.distance } : { subject: null, distance: 0 };
  }

  lineOfSight(eye, to, dist, target) {
    this.raycaster.set(eye, to.clone().normalize());
    this.raycaster.far = dist;
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true)) {
      if (!hit.object.isMesh || !hit.object.visible) continue;
      if (hit.object.material?.transparent) continue;         // rings, debug lines
      let o = hit.object, mine = false;
      while (o) { if (o === target) { mine = true; break; } o = o.parent; }
      if (mine) return true;
      if (o === null && hit.object.parent === this.camera) continue;
      // Ignore tiny ground decals (clues) and the floor; anything solid in front blocks the shot.
      if (hit.distance < dist - 0.8 && hit.object.geometry?.boundingSphere?.radius > 0.4) return false;
    }
    return true;
  }

  buildFeedback() {
    this.white = document.createElement('div');
    Object.assign(this.white.style, { position: 'fixed', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none', zIndex: '15' });
    this.label = document.createElement('div');
    Object.assign(this.label.style, { position: 'fixed', left: '50%', top: '62%', transform: 'translateX(-50%)', color: '#fff',
      font: '16px monospace', textShadow: '0 0 3px #000', opacity: '0', pointerEvents: 'none', zIndex: '15', transition: 'opacity 1.5s' });
    document.body.append(this.white, this.label);
  }

  flash(result) {
    this.white.style.transition = 'none';
    this.white.style.opacity = '0.85';
    this.label.style.transition = 'none';
    this.label.style.opacity = '1';
    this.label.textContent = result.subject
      ? `SNAP! Photo of ${result.subject} (${result.distance.toFixed(0)} m)`
      : 'SNAP! Nothing in the shot.';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.white.style.transition = 'opacity .35s';
      this.white.style.opacity = '0';
      this.label.style.transition = 'opacity 2.5s ease-in';
      this.label.style.opacity = '0';
    }));
  }
}
