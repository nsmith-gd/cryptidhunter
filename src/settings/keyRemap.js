import { remapTable } from './settings.js';

// Key remapping (#76). The game's systems listen for fixed key codes (F = flashlight, ...). This
// layer sits in front of all of them: a physical key the player rebound is swapped for the code
// the game listens for, before anything else sees it. Only real key presses are translated;
// inputs the gamepad and VR layers synthesise already use the game's codes.
// Install it before any other key listener so it runs first.

export class KeyRemap {
  constructor() {
    this.table = new Map();
    this.held = new Map();          // physical code -> translated code while held (for a clean keyup)
    const handle = (e) => {
      if (!e.isTrusted || this.paused?.() || (!this.table.has(e.code) && !this.held.has(e.code))) return;
      let to;
      if (e.type === 'keyup' && this.held.has(e.code)) { to = this.held.get(e.code); this.held.delete(e.code); }
      else to = this.table.get(e.code);
      if (to === undefined) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (to === null) return;                          // this key no longer does anything
      if (e.type === 'keydown') this.held.set(e.code, to);
      (e.target ?? window).dispatchEvent(new KeyboardEvent(e.type, { code: to, key: e.key, repeat: e.repeat, bubbles: true, cancelable: true,
        shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey }));
    };
    addEventListener('keydown', handle, true);
    addEventListener('keyup', handle, true);
  }

  apply(settings) { this.table = remapTable(settings); }
}
