import * as THREE from 'three';
import { PLAYER } from '../player.js';

// VR input parity and comfort (GDD 13.1, 16.2, 16.3; task #75).
//
// Parity: tracked-controller input submits the SAME intents as desktop. Every controller action
// becomes the desktop key / mouse event the game already handles (F = flashlight, E = examine,
// mouse right = raise camera ...), so one validated code path serves both and nothing can drift.
// Held actions (move, sprint, crouch) drive the same held-key state the desktop reads.
//
// Comfort: snap turn by default (45°, or 30°), optional smooth turn with an adjustable speed and
// a world-space vignette; validated teleport (range, clear path, no hazards, not out of an
// encounter) that charges the walking time and exposure; seated mode (height offset, nothing needs
// crouching), one-handed and left-handed layouts. No head bob, roll or camera shake in VR. Photo
// quality comes from the camera tool's pose (the controller), not the head.
//
// This layer does not start the XR session (that's the "Enter VR" entry point, #74). It activates
// whenever renderer.xr is presenting, reads session.inputSources each frame, and moves the player
// (position / yaw), which the VR camera rig follows.

// Controller parts, xr-standard gamepad mapping.
const BTN = { trigger: 0, grip: 1, stick: 3, a: 4, b: 5 };   // a = X on the left hand, b = Y on the left
const LONG = 0.6;          // seconds: long press
const TAP = 0.25;          // seconds: a press shorter than this is a tap

/** Desktop intents (what the game already understands). */
const KEY = (code) => ({ type: 'key', code });
const MOUSE = (button) => ({ type: 'mouse', button });
export const INTENTS = {
  flashlight: KEY('KeyF'), swapBattery: KEY('KeyR'), examine: KEY('KeyE'), journal: KEY('KeyJ'), status: KEY('Tab'),
  eat: KEY('KeyZ'), nightVision: KEY('KeyV'), knock: KEY('KeyK'), useItem: KEY('KeyQ'), driveHome: KEY('KeyH'),
  confirm: KEY('Enter'), nextSlot: { type: 'wheel', deltaY: 100 }, raiseCamera: MOUSE(2), snapPhoto: MOUSE(0),
};

/**
 * Layouts: which controller part does what. 'hold' entries are held intents (pressed while held).
 * Keys per hand: trigger, grip, stick (press), a, b; '+long' variants fire on a long press instead.
 * Stick axes: left stick moves; right stick x turns, up teleports, down toggles crouch.
 */
export const LAYOUTS = {
  twoHanded: {
    move: 'left', turn: 'right',
    left: { trigger: 'flashlight', grip: 'hold:raiseCamera', stick: 'sprint', a: 'examine', b: 'journal', 'b+long': 'status' },
    right: { trigger: 'snapOrUse', grip: 'nextSlot', stick: 'nightVision', a: 'knock', 'a+long': 'driveHome', b: 'eat', 'b+long': 'swapBattery' },
  },
  // One controller does everything: hold grip as a shift to reach the second layer.
  oneHanded: {
    move: 'main', turn: 'main+shift',
    main: { 'trigger+tap': 'snapOrUse', 'trigger+hold': 'hold:raiseCamera', stick: 'sprint', a: 'examineOrSnap', 'a+long': 'driveHome', b: 'flashlight', 'b+long': 'status' },
    shift: { 'trigger+tap': 'nextSlot', stick: 'nightVision', a: 'knock', b: 'journal', 'b+long': 'eat', 'a+long': 'swapBattery' },
  },
};
/** Every desktop action a player can take, and how it is reached in VR (see check-t75). */
export const DESKTOP_ACTIONS = ['move', 'look', 'turn', 'sprint', 'crouch', 'flashlight', 'swapBattery', 'examine', 'journal', 'status',
  'eat', 'nightVision', 'knock', 'useItem', 'nextSlot', 'raiseCamera', 'snapPhoto', 'driveHome', 'pause', 'confirm'];

export const XR_DEFAULTS = Object.freeze({
  turnMode: 'snap', snapDegrees: 45, smoothDegPerSec: 90, vignette: 0.55,
  layout: 'twoHanded', hand: 'right', seated: false, seatedOffset: 0.45,
  teleportRange: 8, teleportMin: 0.6,
});

export class XRControls {
  /**
   * renderer: THREE.WebGLRenderer (xr). camera: the player camera (vignette parent).
   * game: { player, input, colliders, map, cryptids, survival, fear, hunt, photo }.
   */
  constructor({ renderer, camera, scene, game, settings = {} }) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.g = game;
    this.s = { ...XR_DEFAULTS, ...settings };
    this.held = new Map();         // `${hand}:${part}` -> { t, fired, intent }
    this.heldKeys = new Set();     // desktop codes we are holding down
    this.turnArmed = true;
    this.teleportAim = null;       // { valid, reason, target }
    this.crouchOn = false;
    this.log = [];                 // every intent sent: { action, via }
    this.active = false;
    this.buildVignette();
    this.buildTeleportMarker();
    // Photo quality uses the camera tool's pose: a viewfinder camera on the dominant controller.
    this.toolCamera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 200);
    this.toolCamera.name = 'xr-camera-tool';
    if (renderer?.xr) {
      renderer.xr.addEventListener('sessionstart', () => this.setActive(true));
      renderer.xr.addEventListener('sessionend', () => this.setActive(false));
    }
  }

  setActive(on) {
    this.active = on;
    const { input, fear, photo } = this.g;
    if (on) {
      input.locked = true;                         // controllers act like the captured desktop mouse
      if (fear) { this.savedSway = fear.screenSway; fear.screenSway = 0; }   // no camera shake in VR
      if (photo) photo.toolCamera = this.toolCamera;
      // Safe pause on tracking loss / headset removal (no penalty): open the status screen.
      const session = this.renderer?.xr?.getSession?.();
      session?.addEventListener('visibilitychange', () => { if (session.visibilityState !== 'visible') this.pause(); });
    } else {
      this.releaseAll();
      if (fear && this.savedSway !== undefined) fear.screenSway = this.savedSway;
      if (photo) photo.toolCamera = null;
    }
  }

  pause() {
    // #74's PauseState owns the safe pause when present (no penalty, resumes on return); else the status screen.
    if (this.g.pauseState) this.g.pauseState.pause('tracking', 'Paused — tracking lost. Put the headset back on to resume.', true);
    else if (this.g.statusScreen && !this.g.statusScreen.open) this.g.statusScreen.toggle(true);
    this.log.push({ action: 'pause', via: 'tracking lost' });
  }

  // ---- intents ------------------------------------------------------------------------------
  send(action, via) {
    if (action === 'examineOrSnap') action = this.g.photo?.wantRaised || this.g.photo?.raised ? 'snapPhoto' : 'examine';
    if (action === 'snapOrUse') action = this.g.photo?.wantRaised || this.g.photo?.raised ? 'snapPhoto' : this.g.hunt?.stage === 'ended' ? 'confirm' : 'useItem';
    const it = INTENTS[action];
    this.log.push({ action, via });
    if (!it) return;
    if (it.type === 'key') {
      dispatchEvent(new KeyboardEvent('keydown', { code: it.code, bubbles: true, cancelable: true }));
      dispatchEvent(new KeyboardEvent('keyup', { code: it.code, bubbles: true }));
    } else if (it.type === 'mouse') {
      dispatchEvent(new MouseEvent('mousedown', { button: it.button, bubbles: true }));
      dispatchEvent(new MouseEvent('mouseup', { button: it.button, bubbles: true }));
    } else if (it.type === 'wheel') dispatchEvent(new WheelEvent('wheel', { deltaY: it.deltaY, bubbles: true }));
  }

  setHeld(action, on, via) {
    const it = INTENTS[action];
    if (it?.type === 'mouse') {
      dispatchEvent(new MouseEvent(on ? 'mousedown' : 'mouseup', { button: it.button, bubbles: true }));
      if (on) this.log.push({ action, via });
    }
  }

  holdKey(code, on) {
    const keys = this.g.input.keys;
    if (on && !this.heldKeys.has(code)) { this.heldKeys.add(code); keys.add(code); }
    if (!on && this.heldKeys.has(code)) { this.heldKeys.delete(code); keys.delete(code); }
  }

  releaseAll() {
    for (const c of [...this.heldKeys]) this.holdKey(c, false);
    for (const [, h] of this.held) if (h.holdAction) this.setHeld(h.holdAction, false);
    this.held.clear();
  }

  // ---- per frame ---------------------------------------------------------------------------
  /**
   * sources: XRInputSource-like [{ handedness, gamepad: { buttons: [{ pressed, value }], axes: [] },
   *   object?: Object3D (controller pose) }]. Defaults to the live session's input sources.
   */
  update(dt, sources = null) {
    if (!this.active) { this.vignette.visible = false; return; }
    sources ??= this.sourcesOverride?.() ?? this.liveSources();   // override: emulated controllers (tests)
    const dom = this.s.hand;
    const L = LAYOUTS[this.s.layout];
    const byHand = Object.fromEntries(sources.map((s) => [s.handedness, s]));
    const main = byHand[dom];
    let turning = false;

    // Left-handed players: mirror the two-handed layout.
    const handOf = (role) => (role === 'left' ? (dom === 'right' ? 'left' : 'right') : role === 'right' ? dom : dom);

    if (this.s.layout === 'twoHanded') {
      const moveSrc = byHand[handOf('left')], turnSrc = byHand[handOf('right')];
      this.applyMove(moveSrc);
      turning = this.applyTurnStick(turnSrc, dt, true);
      for (const [role, map] of [['left', L.left], ['right', L.right]]) this.applyButtons(byHand[handOf(role)], map, `${role}`, dt);
    } else {
      const shift = !!main?.gamepad?.buttons[BTN.grip]?.pressed;
      if (shift) { this.applyMove(null); turning = this.applyTurnStick(main, dt, true); }
      else { this.applyMove(main); this.applyTurnStick(null, dt, false); }
      this.applyButtons(main, shift ? L.shift : L.main, shift ? 'shift' : 'main', dt, shift ? 'shift' : 'main');
    }

    // Comfort vignette during smooth turning (and while aiming a teleport).
    const want = (turning && this.s.turnMode === 'smooth') || !!this.teleportAim;
    this.vignette.visible = want && this.s.vignette > 0;
    this.vignette.material.uniforms.uStrength.value = this.s.vignette;

    // Seated play: lift the view so standing height is reached sitting down; nothing needs a crouch.
    this.heightOffset = this.s.seated ? this.s.seatedOffset : 0;

    // Tool pose: the viewfinder camera follows the dominant controller.
    const ctrl = main?.object ?? this.controllerObject(dom);
    if (ctrl && this.toolCamera.parent !== ctrl) ctrl.add(this.toolCamera);
    this.toolCamera.fov = this.g.photo?.raisedFov ?? 40;
    this.toolCamera.updateProjectionMatrix();
  }

  liveSources() {
    const session = this.renderer?.xr?.getSession?.();
    if (!session) return [];
    return [...session.inputSources].filter((s) => s.gamepad).map((s, i) => ({ handedness: s.handedness, gamepad: s.gamepad, object: this.renderer.xr.getControllerGrip(i) }));
  }

  controllerObject(hand) { return this.renderer?.xr ? this.renderer.xr.getControllerGrip(hand === 'right' ? 1 : 0) : null; }

  applyMove(src) {
    const ax = src?.gamepad?.axes ?? [];
    const x = ax[2] ?? 0, y = ax[3] ?? 0, dz = 0.35;
    this.holdKey('KeyW', y < -dz); this.holdKey('KeyS', y > dz);
    this.holdKey('KeyA', x < -dz); this.holdKey('KeyD', x > dz);
    const sprintToggle = this.sprintOn && (Math.hypot(x, y) > dz);
    if (!sprintToggle) this.sprintOn = false;
    this.holdKey('ShiftLeft', !!this.sprintOn);
    this.holdKey('ControlLeft', this.crouchOn && !this.s.seated);
  }

  /** Right stick: x turns (snap or smooth), push up and hold to aim a teleport, pull down to crouch. */
  applyTurnStick(src, dt, enabled) {
    const ax = enabled ? src?.gamepad?.axes ?? [] : [];
    const x = ax[2] ?? 0, y = ax[3] ?? 0;
    let turning = false;
    if (this.s.turnMode === 'snap') {
      if (Math.abs(x) > 0.75 && this.turnArmed) { this.turnBy(-Math.sign(x) * THREE.MathUtils.degToRad(this.s.snapDegrees)); this.turnArmed = false; this.log.push({ action: 'turn', via: 'snap' }); }
      if (Math.abs(x) < 0.3) this.turnArmed = true;
    } else if (Math.abs(x) > 0.2) {
      this.turnBy(-x * THREE.MathUtils.degToRad(this.s.smoothDegPerSec) * dt);
      turning = true;
      if (!this.loggedSmooth) { this.log.push({ action: 'turn', via: 'smooth' }); this.loggedSmooth = true; }
    }
    // Teleport: push up past 0.75 to aim, release to go.
    if (y < -0.75 && Math.abs(x) < 0.5) this.teleportAim = this.aimTeleport(src);
    else if (this.teleportAim) { const aim = this.teleportAim; this.teleportAim = null; if (aim.valid) this.teleport(aim.target); this.showMarker(null); }
    // Crouch toggle: pull down and release.
    if (y > 0.75 && !this.crouchArmed) { this.crouchArmed = true; this.crouchOn = !this.crouchOn; this.log.push({ action: 'crouch', via: 'stick down' }); }
    if (y < 0.3) this.crouchArmed = false;
    return turning;
  }

  turnBy(rad) { this.g.player.yaw += rad; }

  applyButtons(src, map, prefix, dt, layerName = null) {
    if (!src?.gamepad) return;
    const parts = ['trigger', 'grip', 'stick', 'a', 'b'];
    for (const part of parts) {
      const pressed = !!src.gamepad.buttons[BTN[part]]?.pressed;
      const key = `${src.handedness}:${part}`;
      let h = this.held.get(key);
      // In one-handed mode the grip is the shift key, not an action.
      if (layerName && part === 'grip') continue;
      const holdAction = (map[part] ?? map[`${part}+hold`] ?? '').startsWith('hold:') ? (map[part] ?? map[`${part}+hold`]).slice(5) : null;
      if (pressed && !h) {
        h = { t: 0, fired: false, holdAction: null };
        this.held.set(key, h);
        if (map[part] && !holdAction && !map[`${part}+long`] && !map[`${part}+tap`]) { this.fire(map[part], `${prefix} ${part}`); h.fired = true; }
        if (holdAction && map[part]) { this.setHeld(holdAction, true, `${prefix} ${part} (hold)`); h.holdAction = holdAction; }
      } else if (pressed && h) {
        h.t += dt;
        if (!h.fired && map[`${part}+long`] && h.t >= LONG) { this.fire(map[`${part}+long`], `${prefix} ${part} (long)`); h.fired = true; }
        if (!h.holdAction && map[`${part}+hold`] && h.t >= TAP) { this.setHeld(holdAction, true, `${prefix} ${part} (hold)`); h.holdAction = holdAction; h.fired = true; }
      } else if (!pressed && h) {
        if (h.holdAction) this.setHeld(h.holdAction, false);
        else if (!h.fired) {
          if (map[`${part}+tap`] && h.t < TAP) this.fire(map[`${part}+tap`], `${prefix} ${part} (tap)`);
          else if (map[part]) this.fire(map[part], `${prefix} ${part}`);
        }
        this.held.delete(key);
      }
    }
  }

  fire(action, via) {
    if (action === 'sprint') { this.sprintOn = !this.sprintOn; this.log.push({ action: 'sprint', via }); return; }
    this.send(action, via);
  }

  // ---- teleport ------------------------------------------------------------------------------
  /** Aim along the controller's forward, flattened, at the configured range. */
  aimTeleport(src) {
    const p = this.g.player.position;
    const ctrl = src?.object ?? this.controllerObject(this.s.hand);
    let dir;
    if (ctrl) { ctrl.updateMatrixWorld(); dir = new THREE.Vector3(0, 0, -1).applyQuaternion(ctrl.getWorldQuaternion(new THREE.Quaternion())); }
    else dir = new THREE.Vector3(-Math.sin(this.g.player.yaw), 0, -Math.cos(this.g.player.yaw));
    dir.y = 0; dir.normalize();
    const dist = src?.teleportDistance ?? this.s.teleportRange * 0.75;
    const target = new THREE.Vector3(p.x + dir.x * dist, 0, p.z + dir.z * dist);
    const v = this.validateTeleport(target);
    this.showMarker(target, v);
    return { ...v, target };
  }

  /** Is a teleport to `target` allowed? Returns { valid, reason }. Same rules as walking there. */
  validateTeleport(target) {
    const { player, colliders, map, cryptids } = this.g;
    const p = player.position, d = Math.hypot(target.x - p.x, target.z - p.z);
    if (d > this.s.teleportRange + 1e-6) return { valid: false, reason: 'Too far' };
    if (d < this.s.teleportMin) return { valid: false, reason: 'Too close' };
    const threat = cryptids?.cryptids?.find((c) => ['aggress', 'warn', 'charge'].includes(c.state) && Math.hypot(c.agent.x - p.x, c.agent.z - p.z) < 25);
    if (threat) return { valid: false, reason: `Can't teleport during an encounter (${threat.profile.name} nearby)` };
    const steps = Math.ceil(d / 0.25);
    const box = new THREE.Box3();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = p.x + (target.x - p.x) * t, z = p.z + (target.z - p.z) * t;
      if (map?.surfaceAt?.(x, z, 0) === 'deep') return { valid: false, reason: 'Deep water in the way' };
      box.min.set(x - PLAYER.radius, 0.36, z - PLAYER.radius); box.max.set(x + PLAYER.radius, PLAYER.standHeight, z + PLAYER.radius);
      if (colliders.some((c) => c.intersectsBox(box))) return { valid: false, reason: i === steps ? 'Blocked' : 'Path blocked' };
    }
    return { valid: true, reason: 'Clear', distance: d };
  }

  /** Move there, charging the time and exposure of walking it (GDD 16.2). */
  teleport(target) {
    const { player, survival, hunt, fear } = this.g;
    const p = player.position, d = Math.hypot(target.x - p.x, target.z - p.z);
    const seconds = d / PLAYER.walkSpeed;
    player.position.set(target.x, p.y, target.z);
    player.velocity.set(0, 0, 0);
    survival?.update(seconds);                       // cold, wet, hunger accrue as if you walked
    fear?.update(seconds);
    if (hunt) hunt.elapsed = (hunt.elapsed ?? 0) + seconds;   // the night clock moves on too
    this.log.push({ action: 'teleport', via: 'right stick', distance: +d.toFixed(2), seconds: +seconds.toFixed(2) });
    return seconds;
  }

  // ---- visuals -------------------------------------------------------------------------------
  buildVignette() {
    const geo = new THREE.PlaneGeometry(0.6, 0.6);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uStrength: { value: XR_DEFAULTS.vignette } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uStrength; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0; float a = smoothstep(0.22, 0.7, r) * uStrength; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    });
    this.vignette = new THREE.Mesh(geo, mat);
    this.vignette.position.set(0, 0, -0.15);
    this.vignette.renderOrder = 999;
    this.vignette.visible = false;
    this.vignette.name = 'xr-comfort-vignette';
    this.camera.add(this.vignette);
  }

  buildTeleportMarker() {
    const g = new THREE.Group();
    g.name = 'xr-teleport-marker';
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8fd07a, transparent: true, opacity: 0.8, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.35, 24).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.02;
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const tex = new THREE.CanvasTexture(c);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    label.scale.set(1.6, 0.3, 1); label.position.y = 1.2;
    g.add(ring, label);
    g.visible = false;
    this.marker = { g, ring, ringMat, label, canvas: c, tex };
    this.scene?.add(g);
  }

  /** Show where a teleport would land, green if allowed, red with the reason in words if not. */
  showMarker(target, v = null) {
    const m = this.marker;
    if (!target) { m.g.visible = false; return; }
    m.g.visible = true;
    m.g.position.set(target.x, 0, target.z);
    m.ringMat.color.set(v.valid ? 0x8fd07a : 0xd0604d);
    const g = m.canvas.getContext('2d');
    g.clearRect(0, 0, 256, 48); g.fillStyle = '#000a'; g.fillRect(0, 0, 256, 48);
    g.font = '18px monospace'; g.fillStyle = '#f1e6c8'; g.textAlign = 'center';
    g.fillText(v.valid ? 'Teleport here' : v.reason, 128, 30, 248);
    m.tex.needsUpdate = true;
  }
}
