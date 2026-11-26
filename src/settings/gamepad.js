import { PLAYER } from '../player.js';

// Gamepad on desktop (#76, GDD 13.1 action parity). Every button sends the SAME input the
// keyboard and mouse send (F = flashlight, right mouse = raise camera ...), so the game has one
// code path for every device. Sticks drive the held movement keys and the look.
// Standard layout (Xbox names; PlayStation in brackets):
//   left stick move · right stick look · L3 sprint · R3 wood knock
//   A [Cross] examine / confirm · B [Circle] crouch (toggle) · X [Square] flashlight · Y [Triangle] journal
//   LT hold: raise camera · RT: take photo (camera up) or use the selected item · LB / RB: previous / next item
//   D-pad: up map · down night vision · left swap battery · right eat
//   View/Back: status · hold View + A drive home · + X bandage · + Y lighten pack
//   Menu/Start: start the hunt / pause
// Works without the mouse captured: the game counts the pad as "in the game" once you press A or
// Start on the start screen.

const B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };
const DEAD = 0.22;
const LOOK_RAD_PER_SEC = 2.4;            // full right-stick deflection, at look speed 1

export const PAD_LAYOUT = [
  ['Left stick', 'Move'], ['Right stick', 'Look'], ['L3 (click left stick)', 'Sprint'], ['R3 (click right stick)', 'Wood knock'],
  ['A', 'Examine · confirm · start'], ['B', 'Crouch (toggle)'], ['X', 'Flashlight'], ['Y', 'Journal'],
  ['LT (hold)', 'Raise camera'], ['RT', 'Take photo / use item'], ['LB / RB', 'Previous / next item'],
  ['D-pad ↑ ↓ ← →', 'Map · night vision · swap battery · eat'],
  ['View', 'Status'], ['View + A / X / Y', 'Drive home / bandage / lighten pack'], ['Menu', 'Start · pause'],
];

export class GamepadControls {
  /** game: { input, player, photo, hunt, settings }, onEngage(): enter the game, onRelease(): pause. */
  constructor({ input, player, photo = null, isEnded = () => false, onEngage = () => {}, onRelease = () => {}, getPads = () => navigator.getGamepads?.() ?? [] }) {
    this.input = input;
    this.player = player;
    this.photo = photo;
    this.isEnded = isEnded;
    this.onEngage = onEngage;
    this.onRelease = onRelease;
    this.getPads = getPads;
    this.prev = [];
    this.heldKeys = new Set();
    this.crouch = false;
    this.sprintLatch = false;
    this.lookSpeed = 1;
    this.engaged = false;           // in the game via the pad (no pointer lock)
    this.connected = false;
    this.log = [];                  // { action } every intent sent
    addEventListener('gamepadconnected', () => { this.connected = true; });
    addEventListener('gamepaddisconnected', () => { this.connected = false; this.releaseAll(); });
  }

  pad() { for (const p of this.getPads()) if (p && p.connected !== false) return p; return null; }

  key(code) {
    this.log.push({ action: code });
    dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
    dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }

  mouse(button, type) {
    if (type !== 'mouseup') this.log.push({ action: `mouse${button}` });
    dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
  }

  hold(code, on) {
    if (on && !this.heldKeys.has(code)) { this.heldKeys.add(code); this.input.keys.add(code); }
    if (!on && this.heldKeys.has(code)) { this.heldKeys.delete(code); this.input.keys.delete(code); }
  }

  releaseAll() {
    for (const c of [...this.heldKeys]) this.hold(c, false);
    if (this.raising) { this.mouse(2, 'mouseup'); this.raising = false; }
  }

  engage() {
    this.engaged = true;
    this.input.locked = true;
    this.onEngage();
  }

  release() {
    this.engaged = false;
    this.releaseAll();
    this.input.locked = false;
    this.onRelease();
  }

  update(dt) {
    const p = this.pad();
    if (!p) { if (this.heldKeys.size) this.releaseAll(); return; }
    this.connected = true;
    const btn = (i) => !!(p.buttons[i]?.pressed || p.buttons[i]?.value > 0.5);
    const now = p.buttons.map((_, i) => btn(i)), before = this.prev;
    const pressed = (i) => now[i] && !before[i];
    const released = (i) => !now[i] && before[i];
    this.prev = now;

    // Start screen / paused: A or Menu enters the game.
    if (!this.input.locked) {
      if (pressed(B.a) || pressed(B.start)) this.engage();
      return;
    }
    if (pressed(B.start)) { if (this.engaged) this.release(); return; }

    // Move: left stick drives the held movement keys; L3 latches sprint until you stop.
    const ax = (i) => { const v = p.axes[i] ?? 0; return Math.abs(v) < DEAD ? 0 : v; };
    const lx = ax(0), ly = ax(1);
    this.hold('KeyW', ly < 0); this.hold('KeyS', ly > 0); this.hold('KeyA', lx < 0); this.hold('KeyD', lx > 0);
    if (pressed(B.l3)) this.sprintLatch = !this.sprintLatch;
    if (ly >= 0) this.sprintLatch = false;
    this.hold('ShiftLeft', this.sprintLatch);
    if (pressed(B.b)) this.crouch = !this.crouch;
    this.hold('KeyC', this.crouch);

    // Look: right stick, with a curve for fine aim; sent as mouse movement (so sensitivity and
    // invert apply the same way for both devices).
    const rx = ax(2), ry = ax(3);
    if (rx || ry) {
      const sens = PLAYER.mouseSens * (this.player.lookScale ?? 1);
      const k = (LOOK_RAD_PER_SEC * this.lookSpeed * dt) / sens;
      this.input.mouseDX += Math.sign(rx) * rx * rx * k;
      this.input.mouseDY += Math.sign(ry) * ry * ry * k * 0.75;
    }

    // Camera: LT held raises it; RT takes the photo when up, otherwise uses the selected item.
    if (pressed(B.lt)) { this.mouse(2, 'mousedown'); this.raising = true; }
    if (released(B.lt) && this.raising) { this.mouse(2, 'mouseup'); this.raising = false; }
    if (pressed(B.rt)) {
      if (this.photo?.wantRaised || this.photo?.raised) { this.mouse(0, 'mousedown'); this.mouse(0, 'mouseup'); }
      else this.key('KeyQ');
    }
    if (pressed(B.lb) || pressed(B.rb)) { this.log.push({ action: 'wheel' }); dispatchEvent(new WheelEvent('wheel', { deltaY: pressed(B.rb) ? 100 : -100, bubbles: true })); }

    // Buttons. View is a shift: tapped alone it opens status; held, it changes A / X / Y.
    const shift = now[B.back];
    if (shift) {
      if (pressed(B.a)) { this.key('KeyH'); this.shiftUsed = true; }
      if (pressed(B.x)) { this.key('KeyB'); this.shiftUsed = true; }
      if (pressed(B.y)) { this.key('KeyU'); this.shiftUsed = true; }
    } else {
      if (pressed(B.a)) this.key(this.isEnded() ? 'Enter' : 'KeyE');
      if (pressed(B.x)) this.key('KeyF');
      if (pressed(B.y)) this.key('KeyJ');
    }
    if (pressed(B.back)) this.shiftUsed = false;
    if (released(B.back) && !this.shiftUsed) this.key('Tab');
    if (pressed(B.r3)) this.key('KeyK');
    if (pressed(B.up)) this.key('KeyM');
    if (pressed(B.down)) this.key('KeyV');
    if (pressed(B.left)) this.key('KeyR');
    if (pressed(B.right)) this.key('KeyZ');
  }
}
