// Player settings (#76, GDD 13.1 accessibility): field of view, look sensitivity (mouse and
// gamepad), invert look, reduced camera shake, brightness, captions for sounds, and key remapping.
// Saved in the save file under "settings" and applied live. None of them change gameplay values:
// brightness is a display filter only (detection reads the world's real light), reduced shake only
// removes the on-screen sway (photos still blur from a shaking hand).

/** Remappable keyboard actions: id -> { name, code (default key = what the game listens for) }. */
export const ACTIONS = [
  { id: 'forward', name: 'Move forward', code: 'KeyW' },
  { id: 'back', name: 'Move back', code: 'KeyS' },
  { id: 'left', name: 'Move left', code: 'KeyA' },
  { id: 'right', name: 'Move right', code: 'KeyD' },
  { id: 'sprint', name: 'Sprint', code: 'ShiftLeft' },
  { id: 'crouch', name: 'Crouch', code: 'KeyC' },
  { id: 'flashlight', name: 'Flashlight', code: 'KeyF' },
  { id: 'examine', name: 'Examine', code: 'KeyE' },
  { id: 'journal', name: 'Journal', code: 'KeyJ' },
  { id: 'map', name: 'Map and compass', code: 'KeyM' },
  { id: 'status', name: 'Status', code: 'Tab' },
  { id: 'useItem', name: 'Use item', code: 'KeyQ' },
  { id: 'battery', name: 'Swap battery', code: 'KeyR' },
  { id: 'nightVision', name: 'Night vision', code: 'KeyV' },
  { id: 'knock', name: 'Wood knock', code: 'KeyK' },
  { id: 'bait', name: 'Bait', code: 'KeyG' },
  { id: 'trailCam', name: 'Trail camera', code: 'KeyT' },
  { id: 'lure', name: 'Audio lure', code: 'KeyL' },
  { id: 'eat', name: 'Eat', code: 'KeyZ' },
  { id: 'bandage', name: 'Bandage', code: 'KeyB' },
  { id: 'lighten', name: 'Lighten pack', code: 'KeyU' },
  { id: 'driveHome', name: 'Drive home', code: 'KeyH' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  fov: 75,                // degrees
  lookSensitivity: 1,     // x the base mouse sensitivity
  padLookSpeed: 1,        // x the base gamepad turn speed
  invertY: false,
  reducedShake: false,
  brightness: 1,          // display only
  captions: true,         // captions + direction cue for sounds
  bindings: {},           // action id -> physical key code (only the changed ones)
});

export const LIMITS = { fov: [60, 100], lookSensitivity: [0.2, 3], padLookSpeed: [0.3, 3], brightness: [0.6, 1.6] };

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** Coerce anything from the save into valid settings. */
export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, bindings: {} };
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(LIMITS)) { const v = Number(raw[k]); if (Number.isFinite(v)) s[k] = clamp(v, LIMITS[k]); }
  for (const k of ['invertY', 'reducedShake', 'captions']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  if (raw.bindings && typeof raw.bindings === 'object') {
    for (const a of ACTIONS) if (typeof raw.bindings[a.id] === 'string' && /^[A-Za-z0-9]+$/.test(raw.bindings[a.id])) s.bindings[a.id] = raw.bindings[a.id];
  }
  // Bindings must stay one key per action: drop any that collide.
  const used = new Map();
  for (const a of ACTIONS) {
    const k = s.bindings[a.id] ?? a.code;
    if (used.has(k)) delete s.bindings[a.id]; else used.set(k, a.id);
  }
  return s;
}

/** Physical key for each action. */
export function keyFor(settings, id) {
  const a = ACTIONS.find((x) => x.id === id);
  return settings.bindings[id] ?? a?.code;
}

/**
 * Bind `id` to physical `code`. If another action already uses that key, the two swap, so every
 * action always keeps exactly one key. Returns the new settings.
 */
export function rebind(settings, id, code) {
  const s = { ...settings, bindings: { ...settings.bindings } };
  const old = keyFor(s, id);
  const other = ACTIONS.find((a) => a.id !== id && keyFor(s, a.id) === code);
  s.bindings[id] = code;
  if (other) s.bindings[other.id] = old;
  for (const a of ACTIONS) if (s.bindings[a.id] === a.code) delete s.bindings[a.id];   // store only changes
  return s;
}

/**
 * Translation table, physical code -> the code the game listens for. Only keys that changed meaning
 * appear. A default key that's now used by nothing maps to null (swallowed), so a rebound action
 * isn't still reachable on its old key.
 */
export function remapTable(settings) {
  const t = new Map();
  for (const a of ACTIONS) {
    const phys = keyFor(settings, a.id);
    if (phys !== a.code) t.set(phys, a.code);
  }
  for (const a of ACTIONS) {
    if (t.has(a.code)) continue;
    if (keyFor(settings, a.id) !== a.code) t.set(a.code, null);
  }
  return t;
}

/** Human label for a key code. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', Space: 'Space', Tab: 'Tab', AltLeft: 'L-Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
}

/** Settings store: loaded from / saved into the save file; listeners re-apply on change. */
export class Settings {
  constructor(saveService) {
    this.saveService = saveService;
    this.listeners = [];
    this.values = normalizeSettings(saveService?.load()?.settings);
  }

  get(k) { return this.values[k]; }

  set(patch) {
    this.values = normalizeSettings({ ...this.values, ...patch });
    this.persist();
    for (const f of this.listeners) f(this.values);
  }

  replace(values) { this.values = normalizeSettings(values); this.persist(); for (const f of this.listeners) f(this.values); }

  persist() {
    if (!this.saveService) return;
    const doc = this.saveService.load();
    this.saveService.save({ ...doc, settings: this.values });
  }

  onChange(f) { this.listeners.push(f); f(this.values); }
}
