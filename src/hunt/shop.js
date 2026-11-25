// Base camp shop (L1, #46): spend money on gear and permanent upgrades between hunts.
//   Gear:     consumables you take into the hunt (bait, spare batteries, trail cameras, lures).
//             Bought gear adds to what camp owns; camp still tops up to the starter kit for free.
//   Upgrades: permanent, levelled. Film (shots per hunt), zoom lens (narrower viewfinder),
//             flashlight battery (seconds of light per battery; night vision shares it).
// Upgrade levels live in camp.state.upgrades and are saved with base camp, so they carry into
// every later hunt; applyUpgrades() sets the live camera and torch from them at the start.

import { PHOTO } from './photoCamera.js';
import { FLASHLIGHT } from '../flashlight.js';

export const SHOP = Object.freeze({
  gear: {
    bait: { name: 'Bait', price: 15, note: 'Lures a cryptid in (G)' },
    spareBatteries: { name: 'Spare battery', price: 25, note: 'A full battery for the torch / goggles (R)' },
    trailCamera: { name: 'Trail camera', price: 60, note: 'Snaps whatever walks past (T)' },
    audioLure: { name: 'Audio lure', price: 40, note: 'Plays a call to draw it in (L)' },
  },
  // values[level]: level 0 is the stock gear; prices[level] is the cost of the NEXT level.
  upgrades: {
    film: { name: 'Film capacity', unit: 'shots per hunt', values: [PHOTO.filmRoll, 18, 24, 36], prices: [90, 170, 300] },
    zoom: { name: 'Zoom lens', unit: '× zoom', values: [PHOTO.raisedFov, 30, 22, 15], prices: [110, 200, 340] },
    battery: { name: 'Flashlight battery', unit: 's of light', values: [FLASHLIGHT.batteryLife, 170, 240, 330], prices: [80, 160, 280] },
  },
});

const BASE_FOV = 75;   // the naked-eye view; zoom is shown relative to it

export function upgradeLevel(camp, key) { return camp.state.upgrades?.[key] ?? 0; }
export function upgradeValue(camp, key) { const u = SHOP.upgrades[key]; return u.values[Math.min(upgradeLevel(camp, key), u.values.length - 1)]; }
export function zoomFactor(fov) { return +(Math.tan((BASE_FOV * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360)).toFixed(1); }

/** Buy one gear item. Returns { ok, reason? }. */
export function buyGear(camp, key) {
  const item = SHOP.gear[key];
  if (!item) return { ok: false, reason: 'unknown item' };
  if (camp.state.money < item.price) return { ok: false, reason: `need $${item.price}` };
  camp.state.money -= item.price;
  camp.state.gear[key] = (camp.state.gear[key] ?? 0) + 1;
  camp.save();
  return { ok: true };
}

/** Buy the next level of an upgrade. Returns { ok, reason? }. */
export function buyUpgrade(camp, key) {
  const u = SHOP.upgrades[key];
  if (!u) return { ok: false, reason: 'unknown upgrade' };
  const lvl = upgradeLevel(camp, key);
  if (lvl >= u.prices.length) return { ok: false, reason: 'maxed out' };
  if (camp.state.money < u.prices[lvl]) return { ok: false, reason: `need $${u.prices[lvl]}` };
  camp.state.money -= u.prices[lvl];
  camp.state.upgrades = { ...(camp.state.upgrades ?? {}), [key]: lvl + 1 };
  camp.save();
  return { ok: true };
}

/** Set the live camera and flashlight from the saved upgrade levels. */
export function applyUpgrades(camp, { photo, flashlight }) {
  if (photo) {
    const film = upgradeValue(camp, 'film');
    // A bigger roll bought before setting off gives you the extra frames too (nothing shot yet).
    photo.film = Math.max(0, film - (photo.filmTotal - photo.film));
    photo.filmTotal = film;
    photo.raisedFov = upgradeValue(camp, 'zoom');
    photo.renderFilm?.();
  }
  if (flashlight) flashlight.batteryLife = upgradeValue(camp, 'battery');
}

/** SHOP panel on the base-camp start screen. onChange() runs after every purchase. */
export function showShopPanel(camp, { onChange = () => {}, root = document.querySelector('#overlay > div'), canBuy = () => true } = {}) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'shop-panel';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #7a6440', background: '#2b2116cc',
    textAlign: 'left', font: '12px/1.6 monospace', color: '#f1e6c8' });
  let message = '';
  const btn = (kind, key, label, disabled) => `<button data-kind="${kind}" data-key="${key}" ${disabled ? 'disabled' : ''}
    style="margin:2px 6px 2px 0;font:12px monospace;cursor:${disabled ? 'default' : 'pointer'};padding:1px 6px;
    background:${disabled ? '#3a3226' : '#ffd88a'};color:${disabled ? '#8a7a60' : '#1a140c'};border:1px solid #7a6440">${label}</button>`;
  const render = () => {
    const money = camp.state.money;
    const ups = Object.entries(SHOP.upgrades).map(([key, u]) => {
      const lvl = upgradeLevel(camp, key), max = lvl >= u.prices.length;
      const now = key === 'zoom' ? `${zoomFactor(u.values[lvl])}${u.unit}` : `${u.values[lvl]} ${u.unit}`;
      const next = max ? '' : key === 'zoom' ? `${zoomFactor(u.values[lvl + 1])}${u.unit}` : `${u.values[lvl + 1]}`;
      const pips = '■'.repeat(lvl) + '□'.repeat(u.prices.length - lvl);
      return `<div>${btn('upgrade', key, max ? 'MAX' : `$${u.prices[lvl]}`, max || money < u.prices[lvl] || !canBuy())}
        ${u.name} <span style="color:#c8a86a">${pips}</span> ${now}${max ? '' : ` → ${next}`}</div>`;
    }).join('');
    const gear = Object.entries(SHOP.gear).map(([key, g]) =>
      `<div>${btn('gear', key, `$${g.price}`, money < g.price || !canBuy())} ${g.name} <span style="color:#a89a7a">(own ${camp.state.gear[key] ?? 0}) ${g.note}</span></div>`).join('');
    el.innerHTML = `<div>SHOP · $${money} to spend</div>
      <div style="color:#c8a86a;margin-top:4px">UPGRADES (keep forever)</div>${ups}
      <div style="color:#c8a86a;margin-top:4px">GEAR</div>${gear}
      ${message ? `<div style="color:#ffd88a;margin-top:4px">${message}</div>` : ''}`;
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();          // don't start the hunt
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const { kind, key } = b.dataset;
    const r = kind === 'gear' ? buyGear(camp, key) : buyUpgrade(camp, key);
    message = r.ok ? `Bought ${kind === 'gear' ? SHOP.gear[key].name : `${SHOP.upgrades[key].name} level ${upgradeLevel(camp, key)}`}.` : `Can't buy: ${r.reason}.`;
    render();
    if (r.ok) onChange({ kind, key });
  });
  render();
  const after = root.querySelector('#loadout-picker') ?? root.querySelector('#camp-panel');
  if (after) after.after(el); else root.prepend(el);
  return { el, render };
}
