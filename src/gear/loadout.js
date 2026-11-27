// Inventory & loadout (L1). Before a hunt you pick up to 4 items you own for your 4 slots
// (on the start screen). In the woods: 1-4 or the mouse wheel picks the active slot, Q (or a
// left-click with the camera lowered) uses it. Each item's own hotkey still works, but only if
// it's in your loadout; anything left at camp isn't carried at all.
// Camera and flashlight are always with you and don't take a slot.
// Pack (#69): gear you don't slot can go in the pack instead of staying at camp. It's carried
// (it weighs on you) but digging it out takes a moment: press its hotkey and it swaps into the
// active slot after a short rummage. U lightens the pack: pours out a litre of water, or leaves the
// heaviest packed item on the ground (walk back over it to pick it up again).
import * as THREE from 'three';
import { computeLoad, loadSummary, packRefusal, ITEM_SPECS, WATER_MAX } from './pack.js';

export const DIG_SECONDS = 1.2;

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

// Field kit (#87): the gear lives in gear/fieldKit.js; these are its loadout entries.
const kitItem = (id, name, key, use, durable = true) => ({
  name, key,
  count: (g) => (durable ? (g.fieldKit?.carried[id] ? null : 0) : g.fieldKit?.carried[id] ?? 0),
  carry: (g, n) => { if (g.fieldKit) g.fieldKit.carried[id] = n; },
  use: (g) => !!g.fieldKit && use(g.fieldKit),
});
Object.assign(ITEMS, {
  binoculars: kitItem('binoculars', 'Binoculars', 'KeyO', (k) => k.toggleBinoculars()),
  whistle: kitItem('whistle', 'Signal whistle', 'KeyY', (k) => k.blowWhistle()),
  fieldRecorder: kitItem('fieldRecorder', 'Field recorder', 'KeyP', (k) => k.toggleRecorder()),
  bivy: kitItem('bivy', 'Emergency bivy', null, (k) => k.toggleBivy()),
  dryClothes: kitItem('dryClothes', 'Dry clothes', null, (k) => k.changeClothes(), false),
  fireKit: kitItem('fireKit', 'Fire kit', null, (k) => k.lightFire(), false),
});

export const DEFAULT_LOADOUT = ['bait', 'trailCamera', 'audioLure', 'spareBatteries'];

export class Loadout {
  /**
   * owned: { itemId: count } from base camp. slots: itemIds (up to 4). gear: live systems.
   */
  constructor({ owned, slots, pack = [], water = 2, gear, input, player = null, scene = null, getFood = () => ({}) }) {
    this.owned = owned;
    this.gear = gear;
    this.input = input;
    this.player = player;
    this.scene = scene;
    this.getFood = getFood;
    this.log = [];                 // { item, ok } every use
    this.slots = [];
    this.pack = [];
    this.water = water;
    this.active = 0;
    this.dig = null;               // { id, t } while rummaging in the pack
    this.caches = [];              // stacks left on the ground: { id, n, mesh }
    this.buildHud();
    this.setSlots(slots, pack);

    // Capture phase: runs before each item's own hotkey listener, so unslotted items are blocked.
    addEventListener('keydown', (e) => {
      if (!input.locked || e.repeat) return;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (n !== undefined) { this.select(n); return; }
      if (e.code === 'KeyQ') { this.use(); return; }
      if (e.code === 'KeyU') { this.lighten(); return; }
      const id = Object.keys(ITEMS).find((k) => ITEMS[k].key === e.code);
      if (!id) return;
      const slot = this.slots.indexOf(id);
      if (slot < 0 && this.pack.includes(id)) { e.stopImmediatePropagation(); this.startDig(id); return; }
      if (slot < 0) { e.stopImmediatePropagation(); this.flash(`${ITEMS[id].name} is back at camp`); return; }
      this.select(slot);          // the item's own listener then uses it
      this.log.push({ item: id, ok: true, via: 'hotkey' });
    }, true);
    addEventListener('wheel', (e) => {
      if (!input.locked || !e.deltaY) return;
      this.select((this.active + (e.deltaY > 0 ? 1 : -1) + this.slots.length) % this.slots.length);
    }, { passive: true });
  }

  /** Pack these items (before the hunt): slots are quick-access, pack items are carried behind them. */
  setSlots(slots, pack = this.pack) {
    this.slots = Loadout.sanitize(slots, this.owned);
    this.pack = Loadout.sanitizePack(pack, this.owned, this.slots);
    this.active = Math.min(this.active ?? 0, Math.max(0, this.slots.length - 1));
    const carried = [...this.slots, ...this.pack];
    for (const [id, item] of Object.entries(ITEMS)) item.carry(this.gear, carried.includes(id) ? (this.owned[id] ?? 0) : 0);
    this.render();
  }

  /** Pack items: owned, known, unique, not already slotted. Volume is checked by the picker. */
  static sanitizePack(pack, owned, slots) {
    const out = [];
    for (const id of pack ?? []) if (ITEMS[id] && (owned[id] ?? 0) > 0 && !slots.includes(id) && !out.includes(id)) out.push(id);
    return out;
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
    for (const id of [...this.slots, ...this.pack]) {
      const n = ITEMS[id].count(this.gear);
      if (n !== null) left[id] = n;
    }
    return left;
  }

  // --- Pack and load (#69) -----------------------------------------------------------------
  /** What you're carrying right now: quick slots, pack (gear, food, water) and worn kit. */
  get load() {
    const quick = {}, pack = { water: this.water, ...this.getFood() };
    for (const id of this.slots) quick[id] = Loadout.unitCount(id, this.gear);
    for (const id of this.pack) pack[id] = Loadout.unitCount(id, this.gear);
    return computeLoad({ quick, pack });
  }

  /** Units for mass: items without a count (goggles, knock stick) are one unit. */
  static unitCount(id, gear) { const n = ITEMS[id].count(gear); return n === null ? 1 : n; }

  startDig(id) {
    if (this.dig) return;
    if (this.player?.sprinting) { this.flash("Can't dig in your pack while running"); return; }
    this.dig = { id, t: 0 };
    this.flash(`Digging the ${ITEMS[id].name.toLowerCase()} out of your pack…`);
  }

  /** Swap a packed item into the active slot (the slot's item goes into the pack). */
  finishDig(id) {
    const i = this.slots.length < SLOTS ? this.slots.length : this.active;
    const out = this.slots[i];
    const pack = this.pack.filter((x) => x !== id);
    if (out) {
      const l = this.load;
      l.volume -= ITEM_SPECS[id]?.L * Loadout.unitCount(id, this.gear);
      const refusal = packRefusal(l, out, Loadout.unitCount(out, this.gear));
      if (refusal) { this.flash(`No room to stow the ${ITEMS[out].name.toLowerCase()}: ${refusal}`); return false; }
      pack.push(out);
    }
    const slots = [...this.slots]; slots[i] = id;
    this.slots = slots; this.pack = pack; this.active = i;
    this.log.push({ item: id, ok: true, via: 'dig' });
    this.flash(`${ITEMS[id].name} in slot ${i + 1}`);
    this.render();
    return true;
  }

  /** U: pour out a litre of water, else leave the heaviest packed item on the ground. */
  lighten() {
    if (this.water > 0) { this.water--; this.flash(`Poured out 1 L of water (${this.water} L left)`); this.log.push({ item: 'water', ok: true, via: 'drop' }); this.render(); return 'water'; }
    const heaviest = [...this.pack].sort((a, b) => (ITEM_SPECS[b]?.kg ?? 0) * Loadout.unitCount(b, this.gear) - (ITEM_SPECS[a]?.kg ?? 0) * Loadout.unitCount(a, this.gear))[0];
    if (!heaviest) { this.flash('Nothing in your pack to leave behind'); return null; }
    const n = ITEMS[heaviest].count(this.gear);
    ITEMS[heaviest].carry(this.gear, 0);
    this.pack = this.pack.filter((x) => x !== heaviest);
    const cache = { id: heaviest, n, mesh: null, x: this.player?.position.x ?? 0, z: this.player?.position.z ?? 0, armed: false };
    if (this.scene) {
      cache.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.24), new THREE.MeshStandardMaterial({ color: 0x4a4636, roughness: 0.9 }));
      cache.mesh.position.set(cache.x, 0.1, cache.z); cache.mesh.name = 'pack-cache';
      this.scene.add(cache.mesh);
    }
    this.caches.push(cache);
    this.log.push({ item: heaviest, ok: true, via: 'drop' });
    this.flash(`Left the ${ITEMS[heaviest].name.toLowerCase()} here. Walk back over it to pick it up`);
    this.render();
    return heaviest;
  }

  /** Every frame: rummaging, picking caches back up, and the load's effect on the player. */
  update(dt) {
    if (this.dig) {
      this.dig.t += dt;
      if (this.player?.sprinting) { this.dig = null; this.flash('Stopped digging in your pack'); }
      else if (this.dig.t >= DIG_SECONDS) { const id = this.dig.id; this.dig = null; this.finishDig(id); }
    }
    const p = this.player?.position;
    if (p) for (const c of [...this.caches]) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d > 2) c.armed = true;                       // walk away first, so dropping doesn't re-grab it
      if (!c.armed || d > 1.1) continue;
      const refusal = packRefusal(this.load, c.id, c.n ?? 1);
      if (refusal) { if (!c.warned) { this.flash(`Can't pick up the ${ITEMS[c.id].name.toLowerCase()}: ${refusal}`); c.warned = true; } continue; }
      ITEMS[c.id].carry(this.gear, c.n ?? 0);
      this.pack.push(c.id);
      if (c.mesh) this.scene.remove(c.mesh);
      this.caches.splice(this.caches.indexOf(c), 1);
      this.flash(`Picked the ${ITEMS[c.id].name.toLowerCase()} back up`);
      this.render();
    }
    const l = this.load;
    if (this.player) { this.player.loadSpeed = l.speedScale; this.player.loadFactor = l.loadFactor; }
    this.renderLoad(l);
  }

  renderLoad(l = this.load) {
    const dig = this.dig ? ` · digging ${Math.round((this.dig.t / DIG_SECONDS) * 100)}%` : '';
    const text = loadSummary(l).replace(' · speed', '\nspeed') + dig + (this.pack.length ? `\npack: ${this.pack.map((id) => ITEMS[id].name).join(', ')} (hotkey digs out)` : '') + ' · U lightens';
    if (text !== this.lastLoad) {
      this.lastLoad = text;
      this.loadEl.textContent = text;
      this.loadEl.style.color = { light: '#bbb', moderate: '#ddd', heavy: '#ffd88a', overloaded: '#ff8a7a' }[l.band];
    }
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
#loadout-load { position: fixed; right: 8px; bottom: 68px; font: 10px monospace; text-align: right; white-space: pre;
  text-shadow: 0 0 2px #000; pointer-events: none; z-index: 4; }
#loadout-msg { position: fixed; right: 8px; bottom: 112px; font: 12px monospace;
  color: #ffd88a; text-shadow: 0 0 3px #000; pointer-events: none; opacity: 0; transition: opacity .6s; z-index: 4; }`;
    document.head.append(css);
    this.el = Object.assign(document.createElement('div'), { id: 'loadout' });
    this.msg = Object.assign(document.createElement('div'), { id: 'loadout-msg' });
    this.loadEl = Object.assign(document.createElement('div'), { id: 'loadout-load' });
    document.body.append(this.el, this.msg, this.loadEl);
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
 * Loadout picker on the start screen: click an item you own to cycle it between a quick slot,
 * the pack and camp; set how much water to take. Shows the pack volume and the load ratio with
 * its effect on speed and stamina. Calls onChange({ slots, pack, water }) so base camp remembers it.
 */
export function showLoadoutPicker({ owned, slots, pack = [], water = 2, getFood = () => ({}), onChange, root = document.querySelector('#overlay > div') }) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'loadout-picker';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #556', background: '#10141bcc',
    textAlign: 'left', font: '12px/1.6 monospace', color: '#ddd' });
  let cur = { slots: Loadout.sanitize(slots, owned), pack: [], water };
  cur.pack = Loadout.sanitizePack(pack, owned, cur.slots);
  const units = (id) => (id === 'nightVision' || id === 'knockStick' ? 1 : owned[id] ?? 0);
  const loadOf = (c) => {
    const quick = {}, p = { water: c.water, ...getFood() };
    for (const id of c.slots) quick[id] = units(id);
    for (const id of c.pack) p[id] = units(id);
    return computeLoad({ quick, pack: p });
  };
  let note = '';
  const btn = (attrs, label, on) => `<button ${attrs} style="margin:3px 4px 0 0;font:12px monospace;cursor:pointer;padding:2px 6px;
    background:${on === 'slot' ? '#ffd88a' : on === 'pack' ? '#8ab8ff' : '#333'};color:${on ? '#111' : '#ccc'};border:1px solid #777">${label}</button>`;
  const render = () => {
    const l = loadOf(cur);
    const bar = (f, w = 20) => '█'.repeat(Math.round(Math.min(1, f) * w)).padEnd(w, '·');
    el.innerHTML = `<div>LOADOUT: click to cycle <b style="color:#ffd88a">quick slot</b> (${cur.slots.length}/${SLOTS}) → <b style="color:#8ab8ff">pack</b> → camp</div>` +
      Object.entries(ITEMS).filter(([id]) => (owned[id] ?? 0) > 0).map(([id, it]) => {
        const i = cur.slots.indexOf(id), inPack = cur.pack.includes(id);
        const n = owned[id];
        const tag = i >= 0 ? `[${i + 1}] ` : inPack ? '[pack] ' : '';
        return btn(`data-id="${id}"`, `${tag}${it.name}${id !== 'nightVision' && id !== 'knockStick' ? ` ×${n}` : ''}`, i >= 0 ? 'slot' : inPack ? 'pack' : null);
      }).join('') +
      `<div style="margin-top:4px">Water ${btn('data-water="-1"', '−')}${cur.water} L${btn('data-water="1"', '+')}` +
      `<span style="color:#999"> food: ${Object.entries(getFood()).filter(([, n]) => n > 0).map(([k, n]) => `${k === 'packedLunch' ? 'lunch' : 'snack'} ×${n}`).join(', ') || 'none'}</span></div>` +
      `<div>PACK  ${bar(l.volume / l.capacity)} ${l.volume.toFixed(1)}/${l.capacity} L</div>` +
      `<div style="color:${{ light: '#bbb', moderate: '#ddd', heavy: '#ffd88a', overloaded: '#ff8a7a' }[l.band]}">LOAD  ${bar(l.ratio)} ${Math.round(l.ratio * 100)}% · ${l.total.toFixed(1)} kg · ${l.band}` +
      `${l.speedScale < 1 ? ` · walk/run −${Math.round((1 - l.speedScale) * 100)}% · stamina ×${l.loadFactor.toFixed(2)}` : ' · no penalty'}</div>` +
      (note ? `<div style="color:#ff8a7a">${note}</div>` : '');
  };
  const fits = (next) => { const l = loadOf(next); return l.volume <= l.capacity + 1e-9 ? null : `Pack is full (${l.capacity} L)`; };
  el.addEventListener('click', (e) => {
    e.stopPropagation();          // don't start the hunt
    const b = e.target.closest('button');
    if (!b) return;
    note = '';
    let next = { ...cur };
    if (b.dataset.water) next.water = Math.max(0, Math.min(WATER_MAX, cur.water + +b.dataset.water));
    else {
      const id = b.dataset.id;
      if (cur.slots.includes(id)) { next.slots = cur.slots.filter((x) => x !== id); next.pack = [...cur.pack, id]; }
      else if (cur.pack.includes(id)) next.pack = cur.pack.filter((x) => x !== id);
      else if (cur.slots.length < SLOTS) next.slots = [...cur.slots, id];
      else next.pack = [...cur.pack, id];
      const why = fits(next);
      if (why && cur.slots.includes(id)) { next.pack = cur.pack; note = `${why}: ${ITEMS[id].name} left at camp`; }
      else if (why) { note = why; next = cur; }
    }
    if (b.dataset.water && fits(next)) { note = fits(next); next = cur; }
    cur = next;
    render();
    onChange?.({ ...cur });
  });
  render();
  const camp = root.querySelector('#camp-panel');
  if (camp) camp.after(el); else root.prepend(el);
  return { el, get slots() { return cur.slots; }, get state() { return { ...cur }; },
    refresh: () => { cur.slots = Loadout.sanitize(cur.slots, owned); cur.pack = Loadout.sanitizePack(cur.pack, owned, cur.slots); render(); } };
}
