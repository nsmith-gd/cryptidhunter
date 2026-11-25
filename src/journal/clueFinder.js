import * as THREE from 'three';

const REACH = 3.5;                         // metres from the eye
const AIM_CONE = THREE.MathUtils.degToRad(9); // how close to the crosshair a clue must be

// Lets the player examine clues: aim near one within reach and press E to log it in the journal.
export class ClueFinder {
  constructor(camera, clueSystem, journal, input) {
    this.camera = camera;
    this.clues = clueSystem;
    this.journal = journal;
    this.target = null;
    this._fwd = new THREE.Vector3();
    this._to = new THREE.Vector3();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && !e.repeat && input.locked) this.examine();
    });
  }

  /** Best unfound clue under the crosshair, or null. */
  update() {
    this.camera.updateMatrixWorld();
    const eye = this.camera.position;
    this.camera.getWorldDirection(this._fwd);
    let best = null, bestAngle = AIM_CONE;
    for (const c of this.clues.clues) {
      if (c.found) continue;
      this._to.set(c.x - eye.x, c.y + 0.03 - eye.y, c.z - eye.z);
      const d = this._to.length();
      if (d > REACH || d < 0.05) continue;
      const angle = this._fwd.angleTo(this._to);
      if (angle < bestAngle) { bestAngle = angle; best = c; }
    }
    this.target = best;
    return best;
  }

  examine() {
    const c = this.update();
    return c ? this.journal.record(c) : null;
  }
}
