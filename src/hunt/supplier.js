// Base-camp supplier (#88; GDD 3.1, 3.2, 3.5, 3.6, 3.8, 7.1, 7.4, 7.5).
//
// The career's gear progression: catalogue equipment you buy once and own (durable gear with an
// instance ID and a condition), or rent per trip. Gear never raises your own stats (GDD 3.1/3.8):
// each item solves one problem in the field and has a cost - price, weight, or both.
//
//   Buy      the list price, once; the item is yours (an owned asset in the ledger, condition 1).
//   Undo     until you commit to the trip, a purchase or rental can be taken back in full
//            ("all financial actions are explicit and reversible until commit", GDD 7.5).
//   Sell     owned gear back to the supplier for floor(50% x list x condition) (GDD 7.4).
//   Repair   damaged gear: ceil(35% x list x condition restored), capped at the list price.
//   Rent     high-cost gear for one trip: a fee plus a 20% refundable deposit held apart from
//            cash; the deposit comes back after the trip unless the gear is lost (GDD 3.6, 7.4).
//
// Owned and rented gear changes the next hunt through the systems that own each effect: pack
// volume and worn mass (S03 load), terrain pace (player speed), insulation (S02 thermo), the torch
// beam (S05) and the camera lens (research). Nothing else is touched.

import { cents, formatCAD } from '../economy/ledger.js';

export const CATALOGUE = Object.freeze({
  B05: { id: 'B05', name: 'Hiking boots', price: 90, kg: 1.2, replacesKg: 0.7, wear: 'feet',
    does: 'Steadier on roots, rock and mud: rough ground slows you much less.', cost: 'Heavier than your walking shoes.' },
  B07: { id: 'B07', name: 'Trail pack (30 L)', price: 70, kg: 0.95, replacesKg: 0.45, wear: 'pack',
    does: '30 L instead of your 12 L daypack: room for far more gear.', cost: 'Packing it full makes you slow.' },
  B09: { id: 'B09', name: 'Insulating midlayer', price: 55, kg: 0.5, wear: 'torso',
    does: 'Keeps your core warm on a cold night.', cost: 'Much less use once it\'s wet.' },
  C05: { id: 'C05', name: 'Headlamp', price: 45, kg: 0.1, wear: 'head',
    does: 'A wide, hands-free beam that lights the trail around you.', cost: 'Shorter throw than a focused torch.' },
  F08: { id: 'F08', name: 'Telephoto camera', price: 650, kg: 1.3, replacesKg: 0.9, wear: 'camera', rentFee: 95,
    does: 'Long lens: sharp, close-up photos of things far away.', cost: 'Heavy, and expensive to lose.' },
});

export const SUPPLIER = Object.freeze({
  bootsRoughFactor: 0.45,     // share of the rough-ground slowdown left with boots on
  midlayerInsulation: 0.35,   // added to the everyday jacket's 1.0 (wet clothing scales it down, S02)
  headlampAngleDeg: 34,       // vs the torch's 24 deg; its reach is a little shorter
  headlampRange: 0.85,
  telephotoFov: 22,           // viewfinder field of view with the long lens (deg)
});

/** The camp's supplier records: camp.state.owned [{ instanceId, id, condition, refundable }] and rentals. */
export class Supplier {
  constructor(camp) {
    this.camp = camp;
    camp.state.owned ??= [];
    camp.state.rentals ??= [];
  }

  get ledger() { return this.camp.ledger; }
  get owned() { return this.camp.state.owned.filter((o) => !o.gone); }
  get rentals() { return this.camp.state.rentals.filter((r) => !r.done); }
  owns(id) { return this.owned.some((o) => o.id === id); }
  rents(id) { return this.rentals.some((r) => r.id === id); }
  /** In use for the next hunt: owned or rented. */
  has(id) { return this.owns(id) || this.rents(id); }

  buy(id) {
    const item = CATALOGUE[id];
    if (!item) return { ok: false, reason: 'not in the catalogue' };
    if (this.owns(id)) return { ok: false, reason: 'you already own one' };
    const instanceId = this.ledger.nextId(`gear:${id}`);
    const r = this.ledger.purchase(`buy:${instanceId}`, cents(item.price), item.name);
    if (!r.ok) return { ok: false, reason: r.reason };
    this.ledger.addAsset(instanceId, cents(item.price), 1);
    this.camp.state.owned.push({ instanceId, id, condition: 1, refundable: true });
    this.camp.save();
    return { ok: true, instanceId };
  }

  /** Take back a purchase made since the last commit: full refund (GDD 7.5 reversible until commit). */
  undo(instanceId) {
    const o = this.camp.state.owned.find((x) => x.instanceId === instanceId && !x.gone);
    if (!o || !o.refundable) return { ok: false, reason: 'already taken on a trip: sell it instead' };
    const asset = this.ledger.assets[instanceId];
    this.ledger.post(`refund:${instanceId}`, 'refund', asset?.list ?? cents(CATALOGUE[o.id].price), { memo: `${CATALOGUE[o.id].name} returned unused` });
    if (asset) asset.sold = true;
    o.gone = 'returned';
    this.camp.save();
    return { ok: true };
  }

  /** Sell owned gear back: floor(50% x list x condition). */
  sell(instanceId) {
    const o = this.camp.state.owned.find((x) => x.instanceId === instanceId && !x.gone);
    if (!o) return { ok: false, reason: 'not owned' };
    if (o.refundable) return this.undo(instanceId);           // never used: a full refund beats resale
    const r = this.ledger.sell(instanceId);
    if (!r.ok) return r;
    o.gone = 'sold';
    this.camp.save();
    return { ok: true, cents: r.cents };
  }

  repair(instanceId) {
    const o = this.camp.state.owned.find((x) => x.instanceId === instanceId && !x.gone);
    if (!o) return { ok: false, reason: 'not owned' };
    const r = this.ledger.repair(instanceId, 1);
    if (!r.ok) return r;
    o.condition = this.ledger.assets[instanceId].condition;
    this.camp.save();
    return { ok: true, cents: r.cents };
  }

  /** Quote and take a one-trip rental: fee + 20% deposit (held, not spent). */
  rent(id) {
    const item = CATALOGUE[id];
    if (!item?.rentFee) return { ok: false, reason: 'not for rent' };
    if (this.has(id)) return { ok: false, reason: 'you already have one for this trip' };
    const rentalId = this.ledger.nextId(`rental:${id}`);
    const r = this.ledger.rent(rentalId, cents(item.rentFee));
    if (!r.ok) return r;
    this.camp.state.rentals.push({ rentalId, id, refundable: true });
    this.camp.save();
    return { ok: true, rentalId, deposit: r.rental.deposit };
  }

  /** Cancel a rental before you set off: fee refunded, deposit released. */
  cancelRental(rentalId) {
    const r = this.camp.state.rentals.find((x) => x.rentalId === rentalId && !x.done);
    if (!r || !r.refundable) return { ok: false, reason: 'the trip is under way' };
    const held = this.ledger.reserved[rentalId];
    this.ledger.post(`rent-refund:${rentalId}`, 'refund', held.fee, { memo: 'Rental cancelled' });
    this.ledger.returnDeposit(rentalId, 0);
    r.done = 'cancelled';
    this.camp.save();
    return { ok: true };
  }

  /** You committed to the trip: purchases and rentals are now final (and rentals belong to it). */
  commit(attemptId) {
    for (const o of this.camp.state.owned) o.refundable = false;
    for (const r of this.rentals) { r.refundable = false; r.attemptId ??= attemptId; }
    this.camp.save();
  }

  /**
   * After the trip: rented gear goes back. lost: it didn't come home (deposit kept, up to the cap).
   * Returns [{ id, refunded, kept }].
   */
  returnRentals({ lost = false } = {}) {
    const out = [];
    for (const r of this.rentals.filter((x) => !x.refundable)) {
      const held = this.ledger.reserved[r.rentalId];
      const res = this.ledger.returnDeposit(r.rentalId, lost ? held.deposit : 0);
      r.done = lost ? 'lost' : 'returned';
      out.push({ id: r.id, refunded: res.refunded ?? 0, kept: res.kept ?? 0 });
    }
    this.camp.save();
    return out;
  }

  /**
   * An ordinary death out in the field (#89, GDD 9.1): owned gear you had on you is lost. Its asset
   * value leaves the books (no cash change; buying a replacement is a later expense).
   */
  loseInUse() {
    const lost = [];
    for (const o of this.owned) {
      o.gone = 'lost in the field';
      const a = this.ledger.assets[o.instanceId];
      if (a) { a.sold = true; a.lost = true; }
      lost.push(CATALOGUE[o.id].name);
    }
    this.camp.save();
    return lost;
  }

  /** Mass added by gear in use (net of what it replaces), and the pack you carry (for S03 load). */
  kit() {
    const worn = [];
    let bag = null;
    for (const id of Object.keys(CATALOGUE)) {
      if (!this.has(id)) continue;
      const it = CATALOGUE[id];
      if (it.wear === 'pack') bag = { name: it.name, L: 30, kg: it.kg };
      else worn.push({ name: it.name, kg: +(it.kg - (it.replacesKg ?? 0)).toFixed(2) });
    }
    return { worn, bag };
  }

  /**
   * Put the gear to work for the next hunt. Each effect goes to the system that owns it.
   * targets: { player, thermo, flashlight, photo, setKit }.
   */
  apply({ player, thermo, flashlight, photo, setKit }) {
    setKit?.(this.kit());
    if (player && this.has('B05') && !player.__boots) {
      const base = player.speedAt;
      player.speedAt = (x, z, y) => { const s = base ? base(x, z, y) : 1; return s < 1 ? 1 - (1 - s) * SUPPLIER.bootsRoughFactor : s; };
      player.__boots = true;
    }
    if (thermo && this.has('B09')) thermo.insulation = Math.max(thermo.insulation, 1 + SUPPLIER.midlayerInsulation);
    if (flashlight && this.has('C05') && !flashlight.__headlamp) {
      const L = flashlight.light;
      L.angle = Math.max(L.angle, SUPPLIER.headlampAngleDeg * Math.PI / 180);
      L.distance *= SUPPLIER.headlampRange;
      L.penumbra = Math.max(L.penumbra, 0.6);
      flashlight.__headlamp = true;
    }
    if (photo && this.has('F08')) photo.raisedFov = Math.min(photo.raisedFov, SUPPLIER.telephotoFov);
  }
}

/** SUPPLIER panel on the base-camp start screen: buy / undo / sell / repair / rent. */
export function showSupplierPanel(supplier, { onChange = () => {}, root = document.querySelector('#overlay > div'), canTrade = () => true } = {}) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'supplier-panel';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #5d6a48', background: '#1d2416cc',
    textAlign: 'left', font: '12px/1.6 monospace', color: '#e6efd8' });
  let message = '';
  const b = (act, arg, label, disabled = false) => `<button data-act="${act}" data-arg="${arg}" ${disabled ? 'disabled' : ''}
    style="margin:0 6px 0 0;font:12px monospace;cursor:${disabled ? 'default' : 'pointer'};padding:1px 6px">${label}</button>`;
  const render = () => {
    const L = supplier.ledger, cash = L.cash, open = canTrade();
    const rows = Object.values(CATALOGUE).map((it) => {
      const mine = supplier.owned.find((o) => o.id === it.id), rented = supplier.rentals.find((r) => r.id === it.id);
      let actions, status = '';
      if (mine) {
        const resale = Math.floor(0.5 * cents(it.price) * mine.condition);
        actions = (mine.refundable ? b('undo', mine.instanceId, `Undo (refund ${formatCAD(cents(it.price))})`, !open) : b('sell', mine.instanceId, `Sell ${formatCAD(resale)}`, !open)) +
          (mine.condition < 1 ? b('repair', mine.instanceId, `Repair ${formatCAD(Math.min(cents(it.price), Math.ceil(0.35 * cents(it.price) * (1 - mine.condition))))}`, !open) : '') +
          '';
        status = `owned${mine.condition < 1 ? `, condition ${Math.round(mine.condition * 100)}%` : ''}`;
      } else if (rented) {
        actions = rented.refundable ? b('cancel', rented.rentalId, 'Cancel rental', !open) : '';
        status = 'rented for this trip';
      } else {
        actions = b('buy', it.id, `Buy ${formatCAD(cents(it.price))}`, !open || cash < cents(it.price)) +
          (it.rentFee ? b('rent', it.id, `Rent ${formatCAD(cents(it.rentFee))} + ${formatCAD(Math.round(cents(it.rentFee) * 0.2))} deposit`, !open || cash < Math.round(cents(it.rentFee) * 1.2)) : '');
      }
      return `<div style="margin-top:5px">${actions}<b>${it.id} ${it.name}</b> · ${it.kg} kg${status ? ` · <span style="color:#9fc28a">${status}</span>` : ''}<br><span style="color:#b8c4a6">${it.does} ${it.cost}</span></div>`;
    }).join('');
    el.innerHTML = `<b>SUPPLIER</b> · cash ${formatCAD(cash)}${L.reservedCents ? ` · deposits held ${formatCAD(L.reservedCents)}` : ''}` +
      `<br><span style="color:#b8c4a6">Gear you buy is yours for every trip after this; you can undo a purchase until you commit to the trip, or sell gear back later for half its value.</span>${rows}` +
      (message ? `<div style="color:#ffd88a;margin-top:4px">${message}</div>` : '');
  };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button[data-act]');
    if (!t || t.disabled) return;
    e.stopPropagation();
    const { act, arg } = t.dataset;
    const r = supplier[{ buy: 'buy', undo: 'undo', sell: 'sell', repair: 'repair', rent: 'rent', cancel: 'cancelRental' }[act]](arg);
    const name = CATALOGUE[arg]?.name ?? CATALOGUE[(supplier.camp.state.owned.find((o) => o.instanceId === arg) ?? supplier.camp.state.rentals.find((x) => x.rentalId === arg))?.id]?.name ?? 'gear';
    message = r.ok ? ({ buy: `Bought: ${name}. It's in your kit for this hunt.`, undo: `Returned the ${name}: full refund.`, sell: `Sold the ${name} for ${formatCAD(r.cents)}.`,
      repair: `Repaired the ${name} for ${formatCAD(r.cents)}.`, rent: `Rented: ${name} for this trip (deposit ${formatCAD(r.deposit)} held).`, cancel: `Rental cancelled: fee and deposit back.` })[act] : `Can't: ${r.reason}`;
    render();
    onChange({ act, arg, ok: r.ok });
  });
  root.append(el);
  render();
  return { el, render };
}
