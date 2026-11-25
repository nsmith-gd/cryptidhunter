// Inventory & loadout (L1). Before a hunt you pick up to 4 items you own for your 4 slots
// (on the start screen). In the woods: 1-4 or the mouse wheel picks the active slot, Q (or a
// left-click with the camera lowered) uses it. Each item's own hotkey still works, but only if
// it's in your loadout; anything left at camp isn't carried at all.
// Camera and flashlight are always with you and don't take a slot.

export const SLOTS = 4;

/**
 * Items: id -> { name, key, count(g), carry(g, n), use(g) }. `g` holds the live gear systems:
 * { bait, trailCams, audioLures, nightVision, knocks, flashlight }.
 */
export const ITEMS = {
  bait: {
    name: 'Bait', key: 'KeyG',
    count: (g) => g.bait.carried, carry: (g, n) => { g.bait.carried = n; },
    use: (g) => !!g.bait.place(),
  },
  trailCamera: {
    name: 'Trail camera', key: 'KeyT',
    count: (g) => g.trailCams.carried, carry: (g, n) => { g.trailCams.carried = n; },
    use: (g) => !!g.trailCams.place(),
  },
  audioLure: {
    name: 'Audio lure', key: 'KeyL',
    count: (g) => g.audioLures.carried, carry: (g, n) => { g.audioLures.carried = n; },
    use: (g) => !!g.audioLures.place(),
  },
  nightVision: {
    name: 'Night vision', key: 'KeyV',
    count: () => null, carry: () => {},
    use: (g) => { g.nightVision.toggle(); return true; },
  },
  knockStick: {
    name: 'Knock stick', key: 'KeyK',
    count: () => null, carry: () => {},
    use: (g) => { const before = g.knocks.log.length; g.knocks.playerKnock(); return g.knocks.log.length > before; },
  },
  spareBatteries: {
    name: 'Spare battery', key: 'KeyR',
    count: (g) => g.flashlight.spares, carry: (g, n) => { g.flashlight.spares = n; },
    use: (g) => g.flashlight.swapBattery(),
  },
};

export const DEFAULT_LOADOUT = ['bait', 'trailCamera', 'audioLure', 'spareBatteries'];

export class Loadout {
  /**
   * owned: { itemId: count } from base camp. slots: itemIds (up to 4). gear: live systems.
   */
  constructor({ owned, slots, gear, input }) {
    this.owned = owned;
    this.gear = gear;
    this.input = input;
    this.log = [];                 // { item, ok } every use
    this.slots = [];
    this.active = 0;
    this.buildHud();
    this.setSlots(slots);

    // Capture phase: runs before each item's own hotkey listener, so unslotted items are blocked.
    addEventListener('keydown', (e) => {
      if (!input.locked || e.repeat) return;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (n !== undefined) { this.select(n); return; }
      if (e.code === 'KeyQ') { this.use(); return; }
      const id = Object.keys(ITEMS).find((k) => ITEMS[k].key === e.code);
      if (!id) return;
      const slot = this.slots.indexOf(id);
      if (slot < 0) { e.stopImmediatePropagation(); this.flash(`${ITEMS[id].name} is back at camp`); return; }
      this.select(slot);          // the item's own listener then uses it
      this.log.push({ item: id, ok: true, via: 'hotkey' });
    }, true);
    addEventListener('wheel', (e) => {
      if (!input.locked || !e.deltaY) return;
      this.select((this.active + (e.deltaY > 0 ? 1 : -1) + this.slots.length) % this.slots.length);
    }, { passive: true });
  }

  /** Pack these items (before the hunt). Carry only what's slotted; the rest stays at camp. */
  setSlots(slots) {
    this.slots = Loadout.sanitize(slots, this.owned);
    this.active = Math.min(this.active ?? 0, Math.max(0, this.slots.length - 1));
    for (const [id, item] of Object.entries(ITEMS)) item.carry(this.gear, this.slots.includes(id) ? (this.owned[id] ?? 0) : 0);
    this.render();
  }

  /** Keep only owned, known, unique items; at most 4. */
  static sanitize(slots, owned) {
    const out = [];
    for (const id of slots ?? DEFAULT_LOADOUT) if (ITEMS[id] && (owned[id] ?? 0) > 0 && !out.includes(id)) out.push(id);
    return out.slice(0, SLOTS);
  }

  get activeItem() { return this.slots[this.active] ?? null; }

  select(i) {
    if (i < 0 || i >= this.slots.length) return;
    this.active = i;
    this.render();
  }

  /** Use the active slot's item. Returns true if it did something. */
  use() {
    const id = this.activeItem;
    if (!id) return false;
    const item = ITEMS[id];
    const left = item.count(this.gear);
    const ok = left === 0 ? false : !!item.use(this.gear);
    this.log.push({ item: id, ok, via: 'use' });
    if (!ok) this.flash(left === 0 ? `Out of ${item.name.toLowerCase()}` : `${item.name}: can't use that now`);
    this.render();
    return ok;
  }

  /** Counts to hand back to base camp at the end of the hunt (unslotted items untouched). */
  gearLeft() {
    const left = {};
    for (const id of this.slots) {
      const n = ITEMS[id].count(this.gear);
      if (n !== null) left[id] = n;
    }
    return left;
  }

  // --- HUD: four slots along the bottom centre --------------------------------------------
  buildHud() {
    const css = document.createElement('style');
    css.textContent = `
#loadout { position: fixed; right: 8px; bottom: 44px; display: flex; gap: 4px;
  pointer-events: none; font: 11px monospace; color: #ddd; z-index: 4; }
#loadout .slot { padding: 3px 6px; background: #0009; border: 1px solid #666; text-shadow: 0 0 2px #000; white-space: nowrap; }
#loadout .slot.active { border-color: #ffd88a; background: #2b2116cc; color: #fff; }
#loadout .slot .k { color: #999; } #loadout .slot.empty { opacity: .4; }
#loadout-msg { position: fixed; right: 8px; bottom: 72px; font: 12px monospace;
  color: #ffd88a; text-shadow: 0 0 3px #000; pointer-events: none; opacity: 0; transition: opacity .6s; z-index: 4; }`;
    document.head.append(css);
    this.el = Object.assign(document.createElement('div'), { id: 'loadout' });
    this.msg = Object.assign(document.createElement('div'), { id: 'loadout-msg' });
    document.body.append(this.el, this.msg);
    this.render();
  }

  render() {
    const cells = [];
    for (let i = 0; i < SLOTS; i++) {
      const id = this.slots[i];
      if (!id) { cells.push(`<div class="slot empty"><span class="k">${i + 1}</span> —</div>`); continue; }
      const n = ITEMS[id].count(this.gear);
      const extra = id === 'nightVision' && this.gear.nightVision.on ? ' ON' : n === null ? '' : ` ×${n}`;
      cells.push(`<div class="slot${i === this.active ? ' active' : ''}"><span class="k">${i + 1}</span> ${ITEMS[id].name}${extra}</div>`);
    }
    const html = cells.join('');
    if (html !== this.lastHtml) { this.el.innerHTML = html; this.lastHtml = html; }
  }

  flash(text) {
    this.msg.textContent = text;
    this.msg.style.transition = 'none'; this.msg.style.opacity = '1';
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { this.msg.style.transition = 'opacity .6s'; this.msg.style.opacity = '0'; }, 1500);
  }
}

/**
 * Loadout picker on the start screen: click items you own to put them in / take them out of
 * your 4 slots. Calls onChange(slots) so base camp can remember it.
 */
export function showLoadoutPicker({ owned, slots, onChange, root = document.querySelector('#overlay > div') }) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'loadout-picker';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #556', background: '#10141bcc',
    textAlign: 'left', font: '12px/1.6 monospace', color: '#ddd' });
  let current = Loadout.sanitize(slots, owned);
  const render = () => {
    el.innerHTML = `<div>LOADOUT (${current.length}/${SLOTS}) — click to pack or leave at camp</div>` +
      Object.entries(ITEMS).filter(([id]) => (owned[id] ?? 0) > 0).map(([id, it]) => {
        const i = current.indexOf(id);
        const n = owned[id];
        return `<button data-id="${id}" style="margin:3px 4px 0 0;font:12px monospace;cursor:pointer;padding:2px 6px;
          background:${i >= 0 ? '#ffd88a' : '#333'};color:${i >= 0 ? '#111' : '#ccc'};border:1px solid #777">
          ${i >= 0 ? `[${i + 1}] ` : ''}${it.name}${n > 1 || id !== 'nightVision' && id !== 'knockStick' ? ` ×${n}` : ''}</button>`;
      }).join('');
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();          // don't start the hunt
    const id = e.target.closest('button')?.dataset.id;
    if (!id) return;
    if (current.includes(id)) current = current.filter((x) => x !== id);
    else if (current.length < SLOTS) current = [...current, id];
    render();
    onChange?.(current);
  });
  render();
  const camp = root.querySelector('#camp-panel');
  if (camp) camp.after(el); else root.prepend(el);
  return { el, get slots() { return current; }, refresh: () => { current = Loadout.sanitize(current, owned); render(); } };
}
