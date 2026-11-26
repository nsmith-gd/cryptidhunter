// Minimal save file (#15): one JSON document, { "version": 1, "money": <int> }
// (+ optional "bountiesDone": [ids] once a bounty has been paid, #45).
// Room to grow (gear, upgrades, reputation, album, compendium) under new keys / versions later.
//
// The game runs in a browser, so its "user-data directory" is the page's local storage; the
// backend is pluggable so the same service writes a real JSON file on disk where a filesystem
// exists (see fileBackend.js, used by the tests and any future desktop build).
// Robustness: a missing or corrupt save loads as defaults and never throws; writes are atomic
// (written to a temp slot first, then swapped in).

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'cryptidhunter.save.json';

export function defaultSave() {
  return { version: SAVE_VERSION, money: 0 };
}

/** Coerce anything parsed from disk into a valid save (unknown/bad fields fall back to defaults). */
export function normalizeSave(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const money = Number(raw.money);
  if (Number.isFinite(money) && money >= 0) d.money = Math.floor(money);
  // Optional (#45): ids of bounties already paid. Only written once there is one.
  if (Array.isArray(raw.bountiesDone)) {
    const ids = raw.bountiesDone.filter((x) => typeof x === 'string');
    if (ids.length) d.bountiesDone = [...new Set(ids)];
  }
  // Optional (#97): the career ledger (integer cents, validated by economy/ledger.js when read).
  if (raw.ledger && typeof raw.ledger === 'object' && Array.isArray(raw.ledger.tx)) d.ledger = JSON.parse(JSON.stringify(raw.ledger));
  // Optional (#76): player settings (validated by settings/settings.js when read).
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) d.settings = JSON.parse(JSON.stringify(raw.settings));
  return d;
}

export class SaveService {
  /** @param {{ read(): string|null, write(text: string): void }} backend */
  constructor(backend = localStorageBackend()) {
    this.backend = backend;
  }

  /** Load the save; missing or corrupt -> defaults (money 0). Never throws. */
  load() {
    let text = null;
    try { text = this.backend?.read() ?? null; } catch { return defaultSave(); }
    if (text == null || text === '') return defaultSave();
    try { return normalizeSave(JSON.parse(text)); } catch { return defaultSave(); }
  }

  /** Save (merged onto defaults so the payload is always complete). Returns true on success. */
  save(data) {
    const doc = { ...normalizeSave(data), version: SAVE_VERSION };
    try { this.backend?.write(JSON.stringify(doc, null, 2)); return true; } catch { return false; }
  }
}

/** Browser backend: local storage. Writes go to a temp key first, then replace the real key. */
export function localStorageBackend(key = SAVE_KEY, storage = safeStorage()) {
  let memory = null;   // used when storage is blocked (private mode)
  return {
    read() { return storage ? storage.getItem(key) : memory; },
    write(text) {
      if (!storage) { memory = text; return; }
      storage.setItem(`${key}.tmp`, text);    // if this throws (quota), the old save is untouched
      storage.setItem(key, text);
      storage.removeItem(`${key}.tmp`);
    },
  };
}

/** In-memory backend (tests, or when nothing else is available). */
export function memoryBackend(initial = null) {
  let text = initial;
  return { read: () => text, write: (t) => { text = t; } };
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
