import * as THREE from 'three';

// Handheld camera (L0 greybox). Hold right mouse to raise it: the view zooms into a
// viewfinder. Left-click while raised snaps a photo. The shot is a HIT if a cryptid is inside
// the camera's view frustum and at least part of it isn't blocked by anything solid; otherwise
// it's a MISS. Every shot is logged (console + on screen) and passed to onPhoto({ subject, distance }).
export const PHOTO = {
  range: 60,           // metres: beyond this a subject is too small/dark to count
  raisedFov: 40,       // vertical field of view through the viewfinder (degrees)
  raiseTime: 0.22,     // seconds to bring the camera up
  cooldown: 0.8,
  filmRoll: 12,        // shots per hunt (misses use film too)
  thumbWidth: 160,     // album thumbnail size (16:9)
  fullFrame: 0.45,     // a subject this tall in the frame (share of frame height) gets full marks for size
  lookBlur: 6,         // turning the view this many deg/s blurs a photo as much as 1 deg/s of fear shake       // seconds between shots (shutter + wind-on)
};

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const LOOK_WINDOW = 0.15;  // seconds of view rotation averaged for photo blur

export class PhotoCamera {
  /**
   * getSubjects: () => [{ name, object3d, center: Vector3, radius, base?: Vector3, height? }]
   *   With base + height the subject is sampled as a standing column (feet to head);
   *   otherwise as a sphere around center.
   */
  constructor({ camera, scene, input, getSubjects, onPhoto, getShake = () => 0, canvas = null, film = PHOTO.filmRoll }) {
    this.camera = camera;
    this.canvas = canvas;       // the rendered view, for album thumbnails
    this.filmTotal = film;
    this.film = film;           // shots left on the roll
    this.raisedFov = PHOTO.raisedFov;   // zoom lens (base-camp shop upgrade)
    this.getShake = getShake;   // () => degrees/second the view is shaking (fear sway)
    this.scene = scene;
    this.input = input;
    this.getSubjects = getSubjects;
    this.onPhoto = onPhoto;
    this.enabled = true;
    this.cooldown = 0;
    this.raise = 0;             // 0 = lowered, 1 = up at the eye
    this.wantRaised = false;
    this.baseFov = camera.fov;
    this.log = [];              // every shot: { result, subject, distance, visible, samples, at }
    this.lookSpeed = 0;         // smoothed degrees/second the view is turning
    this.frustum = new THREE.Frustum();
    this.raycaster = new THREE.Raycaster();

    addEventListener('mousedown', (e) => {
      if (!input.locked) return;
      if (e.button === 2) this.wantRaised = true;
      if (e.button === 0) this.snap();
    });
    addEventListener('mouseup', (e) => { if (e.button === 2) this.wantRaised = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { if (!input.locked) this.wantRaised = false; });

    this.buildBody();
    this.buildOverlay();
  }

  get raised() { return this.raise > 0.95; }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    // How fast the view is turning (degrees/second) for motion blur in photos: total rotation
    // over the last LOOK_WINDOW seconds of simulation, so it reads the same at any frame rate.
    this.camera.getWorldQuaternion(_q);
    if (this._lastQ && dt > 0) {
      const deg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(_q.dot(this._lastQ)))));
      (this._turns ??= []).push([deg, dt]);
      let span = 0, sum = 0;
      for (const [d, t] of this._turns) { sum += d; span += t; }
      while (this._turns.length > 1 && span - this._turns[0][1] >= LOOK_WINDOW) { const [d, t] = this._turns.shift(); sum -= d; span -= t; }
      this.lookSpeed = span > 0 ? sum / Math.max(span, LOOK_WINDOW) : 0;
    }
    (this._lastQ ??= new THREE.Quaternion()).copy(_q);
    const target = this.wantRaised && this.enabled ? 1 : 0;
    const step = dt / PHOTO.raiseTime;
    if (target > this.raise) this.raise = Math.min(1, this.raise + step);
    else if (target < this.raise) this.raise = Math.max(0, this.raise - step);
    const k = this.raise * this.raise * (3 - 2 * this.raise); // smoothstep
    const fov = this.baseFov + (this.raisedFov - this.baseFov) * k;
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Greybox camera body: held low-left, swings up toward the eye (then the viewfinder takes over).
    this.body.position.set(-0.2 + 0.2 * k, -0.26 + 0.18 * k, -0.42 + 0.2 * k); // left hand: the torch is in the right
    this.body.visible = k < 0.9;
    this.overlay.style.opacity = String(Math.max(0, (k - 0.6) / 0.4));
  }

  /** Take a photo (only while raised). Returns the logged entry, or null if no shot was taken. */
  snap() {
    if (!this.enabled || !this.raised || this.cooldown > 0) {
      if (this.enabled && !this.raised) { if (this.onLoweredClick) this.onLoweredClick(); else this.toast('Hold right mouse to raise the camera'); }
      return null;
    }
    if (this.film <= 0) { this.toast('Out of film', 'miss'); this.renderFilm(); return null; } // the shutter won't fire
    this.film--;
    this.cooldown = PHOTO.cooldown;
    const r = this.evaluate();
    const shake = this.getShake();
    // Camera motion: how fast the view is turning (your mouse) plus fear shake.
    const motion = shake + this.lookSpeed / PHOTO.lookBlur;
    const entry = { result: r.subject ? 'HIT' : 'MISS', ...r, shake, motion, ...photoScore(r, motion), at: performance.now() };
    entry.thumb = this.thumbnail();   // grabbed before the flash: what the lens saw
    entry.frame = this.filmTotal - this.film;
    this.log.push(entry);
    this.renderFilm();
    console.info(r.subject
      ? `[photo] HIT: ${r.subject} in frame, ${r.distance.toFixed(1)} m, ${r.visible}/${r.samples} points visible, score ${entry.score} (centred ${entry.parts?.centring} size ${entry.parts?.size} visible ${entry.parts?.visibility} steady ${entry.parts?.steadiness})`
      : `[photo] MISS: ${r.reason}`);
    this.flash(entry);
    this.onPhoto?.({ subject: r.subject, distance: r.distance, visible: r.visible, samples: r.samples, score: entry.score, source: 'handheld camera' });
    return entry;
  }

  /**
   * What a shot taken right now would capture, using the camera's current lens.
   * Returns { subject, distance, visible, samples, reason }.
   */
  evaluate() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const eye = cam.getWorldPosition(new THREE.Vector3());
    let best = null, reason = 'nothing in frame';
    for (const s of this.getSubjects()) {
      if (!s.object3d?.visible) continue;
      const dist = eye.distanceTo(s.center);
      if (dist > PHOTO.range) { if (reason === 'nothing in frame') reason = `${s.name} too far away`; continue; }
      const pts = samplePoints(s, eye);
      const inFrame = pts.filter((p) => this.frustum.containsPoint(p));
      if (!inFrame.length) continue;
      const visible = inFrame.filter((p) => this.clearLine(eye, p, s.object3d)).length;
      if (!visible) { reason = `${s.name} is in frame but blocked`; continue; }
      // Prefer the subject showing the most of itself, then the nearest.
      if (!best || visible > best.visible || (visible === best.visible && dist < best.distance)) {
        const fwd = cam.getWorldDirection(new THREE.Vector3());
        const off = THREE.MathUtils.radToDeg(fwd.angleTo(new THREE.Vector3().subVectors(s.center, eye)));
        // Size on screen: the subject's projected height as a share of the frame height.
        let lo = Infinity, hi = -Infinity;
        const ends = s.base && s.height ? [s.base, s.base.clone().setY(s.base.y + s.height)] : pts; // feet to crown
        for (const p of ends) { const y = _v.copy(p).project(cam).y; lo = Math.min(lo, y); hi = Math.max(hi, y); }
        const screenSize = Math.min(1, Math.max(0, (Math.min(hi, 1) - Math.max(lo, -1)) / 2));
        best = { subject: s.name, distance: dist, visible, samples: pts.length, offCentre: off / (cam.fov / 2), screenSize };
      }
    }
    return best ? { ...best, reason: 'in frame' } : { subject: null, distance: 0, visible: 0, samples: 0, reason };
  }

  /** Small JPEG of the current view for the album (null without a canvas). */
  thumbnail() {
    if (!this.canvas) return null;
    try {
      const w = PHOTO.thumbWidth, h = Math.round(w * this.canvas.height / this.canvas.width);
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;          // keep the pixels crisp
      g.drawImage(this.canvas, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.8);
    } catch { return null; }
  }

  renderFilm() {
    const el = this.overlay?.querySelector('.vf-film');
    if (el) { el.textContent = `film ${this.film}/${this.filmTotal}`; el.style.color = this.film <= 2 ? '#ff8a7a' : ''; }
  }

  /** True if nothing solid sits between the eye and point p (hits on the subject itself are fine). */
  clearLine(eye, p, target) {
    const to = _v.subVectors(p, eye);
    const dist = to.length();
    this.raycaster.set(eye, to.normalize());
    this.raycaster.far = dist - 0.05;
    this.raycaster.camera = this.camera;                    // sprites (debug labels) need it to be raycast at all
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true)) {
      const o = hit.object;
      if (!o.isMesh || !o.visible) continue;
      if (o.material?.transparent) continue;              // water, rings, debug lines, fading clues
      if (o.isSprite || o.material?.depthTest === false) continue; // overlays: labels, meters
      if (isPartOf(o, target) || isPartOf(o, this.camera)) continue;
      // Ground-level flat surfaces (floor, trails, decals) only block if the ray is skimming them.
      if (hit.point.y < 0.15 && hit.face && hit.face.normal.y > 0.9) continue;
      return false;
    }
    return true;
  }

  // --- presentation ------------------------------------------------------------------------
  buildBody() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.07), mat);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.3 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0.02, 0, -0.06);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0xa04030 }));
    strap.position.set(-0.07, 0.05, 0);
    g.add(body, lens, strap);
    g.name = 'photo-camera-body';
    g.traverse((m) => { m.renderOrder = 5; });
    this.camera.add(g);
    this.body = g;
  }

  buildOverlay() {
    const o = document.createElement('div');
    o.id = 'viewfinder';
    o.innerHTML = `
      <div class="vf-c tl"></div><div class="vf-c tr"></div><div class="vf-c bl"></div><div class="vf-c br"></div>
      <div class="vf-focus"></div><div class="vf-rec">● CAM</div><div class="vf-help">LMB snap · <span class="vf-film"></span></div>`;
    const css = document.createElement('style');
    css.textContent = `
#viewfinder { position: fixed; inset: 0; pointer-events: none; opacity: 0; z-index: 12;
  box-shadow: inset 0 0 0 9999px transparent, inset 0 0 120px 40px #000c; font: 12px monospace; color: #e8e4d8; }
#viewfinder .vf-c { position: absolute; width: 36px; height: 36px; border: 2px solid #e8e4d8cc; }
#viewfinder .tl { left: 8%; top: 10%; border-right: 0; border-bottom: 0; }
#viewfinder .tr { right: 8%; top: 10%; border-left: 0; border-bottom: 0; }
#viewfinder .bl { left: 8%; bottom: 10%; border-right: 0; border-top: 0; }
#viewfinder .br { right: 8%; bottom: 10%; border-left: 0; border-top: 0; }
#viewfinder .vf-focus { position: absolute; left: 50%; top: 50%; width: 46px; height: 32px; margin: -16px 0 0 -23px;
  border: 1px dashed #e8e4d899; }
#viewfinder .vf-rec { position: absolute; left: calc(8% + 46px); top: calc(10% + 6px); color: #ff6a5a; letter-spacing: 2px; }
#viewfinder .vf-help { position: absolute; right: calc(8% + 46px); top: calc(10% + 6px); color: #e8e4d8aa; }
#photo-flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 15; }
#photo-label { position: fixed; left: 50%; top: 64%; transform: translateX(-50%); padding: 4px 10px; background: #000a;
  font: 15px monospace; color: #fff; opacity: 0; pointer-events: none; z-index: 15; white-space: pre; text-align: center; }
#photo-label.hit { color: #9dff9a; } #photo-label.miss { color: #ff9a8a; }`;
    document.head.append(css);
    this.white = Object.assign(document.createElement('div'), { id: 'photo-flash' });
    this.label = Object.assign(document.createElement('div'), { id: 'photo-label' });
    document.body.append(o, this.white, this.label);
    this.overlay = o;
    this.renderFilm();
  }

  toast(text, cls = '') {
    this.label.className = cls;
    this.label.textContent = text;
    this.label.style.transition = 'none';
    this.label.style.opacity = '1';
    clearTimeout(this.labelTimer);
    this.labelTimer = setTimeout(() => { this.label.style.transition = 'opacity 1.2s'; this.label.style.opacity = '0'; }, 1800);
  }

  flash(entry) {
    this.white.style.transition = 'none';
    this.white.style.opacity = '0.85';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.white.style.transition = 'opacity .35s';
      this.white.style.opacity = '0';
    }));
    this.toast(entry.subject
      ? `HIT — ${entry.subject} (${entry.distance.toFixed(0)} m) · SCORE ${entry.score}\n` +
        `centred ${entry.parts.centring} · size ${entry.parts.size} · visible ${entry.parts.visibility} · steady ${entry.parts.steadiness}${entry.steadiness < 0.75 ? ' (blurry)' : ''}`
      : `MISS — ${entry.reason}`, entry.subject ? 'hit' : 'miss');
  }
}

/**
 * Photo score (0-100) from four things, each also reported 0-100 in `parts`:
 *   centring   — how close to the middle of the frame the cryptid is
 *   size       — how tall it is in the frame (a full-frame subject scores 100); without a measured
 *                screen size (e.g. a fixed trail camera) it falls back to distance
 *   visibility — how much of it isn't hidden behind trees, rocks, walls
 *   steadiness — how still the camera was (turning the view and fear shake blur the shot)
 * score = visibility × steadiness × (35% centring + 65% size)
 */
export function photoScore(r, motionDegPerSec = 0) {
  const steadiness = Math.max(0.1, Math.min(1, 1 - motionDegPerSec / 8));
  if (!r.subject) return { score: 0, steadiness, parts: null };
  const centring = 1 - Math.min(1, r.offCentre ?? 0);
  const size = r.screenSize != null ? Math.min(1, r.screenSize / PHOTO.fullFrame)
    : Math.max(0.2, Math.min(1, 1 - (r.distance - 8) / 50));
  const visibility = r.visible / r.samples;
  const score = Math.round(100 * visibility * steadiness * (0.35 * centring + 0.65 * size));
  const pct = (v) => Math.round(v * 100);
  return { score, steadiness, parts: { centring: pct(centring), size: pct(size), visibility: pct(visibility), steadiness: pct(steadiness) } };
}

// Points on the subject to test: a standing column (feet, knees, chest, head, shoulders)
// or a sphere (centre plus four points on its rim, square to the view).
export function samplePoints(s, eye) {
  const right = new THREE.Vector3().subVectors(s.center, eye).setY(0).normalize();
  right.set(-right.z, 0, right.x);
  if (s.base && s.height) {
    const at = (h, side = 0) => s.base.clone().add(new THREE.Vector3(right.x * side, h, right.z * side));
    const r = s.radius * 0.8, H = s.height;
    return [at(H * 0.25), at(H * 0.5), at(H * 0.75), at(H * 0.93), at(H * 0.7, r), at(H * 0.7, -r)];
  }
  const r = s.radius * 0.8;
  return [s.center.clone(), s.center.clone().addScaledVector(right, r), s.center.clone().addScaledVector(right, -r),
    s.center.clone().add(new THREE.Vector3(0, r, 0)), s.center.clone().add(new THREE.Vector3(0, -r, 0))];
}

export function isPartOf(o, root) {
  for (; o; o = o.parent) if (o === root) return true;
  return false;
}
