// Base-camp supplier (#88): buy / undo until commit / sell / repair / rent, and the gear's effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/economy/ledger.js';
import { Supplier, CATALOGUE, SUPPLIER } from '../src/hunt/supplier.js';
import { computeLoad, setKit, PACKS } from '../src/gear/pack.js';

const camp = (cash = 25000) => { const ledger = new Ledger({ startCents: cash }); return { ledger, state: {}, save() {} }; };

test('buying gear debits its list price once and makes it yours (an owned asset)', () => {
  const c = camp(), s = new Supplier(c);
  const r = s.buy('B05');
  assert.ok(r.ok);
  assert.equal(c.ledger.cash, 25000 - 9000);
  assert.ok(s.owns('B05') && c.ledger.assets[r.instanceId].condition === 1);
  assert.equal(s.buy('B05').ok, false, 'one pair is enough');
  assert.equal(new Supplier(camp(1000)).buy('F08').ok, false, 'refused when you can\'t afford it');
});

test('purchases are reversible until you commit to the trip, then final', () => {
  const c = camp(), s = new Supplier(c);
  const { instanceId } = s.buy('B09');
  assert.ok(s.undo(instanceId).ok);
  assert.equal(c.ledger.cash, 25000);
  assert.equal(s.owns('B09'), false);
  const again = s.buy('B09');
  s.commit('A1');
  assert.equal(s.undo(again.instanceId).ok, false);
  assert.ok(s.owns('B09'));
});

test('selling used gear pays floor(50% x list x condition); repairs cost ceil(35% x list x restored)', () => {
  const c = camp(), s = new Supplier(c);
  const { instanceId } = s.buy('B05'); s.commit('A1');
  c.ledger.assets[instanceId].condition = 0.6; c.state.owned[0].condition = 0.6;
  const rep = s.repair(instanceId);
  assert.equal(rep.cents, Math.ceil(0.35 * 9000 * 0.4));
  const before = c.ledger.cash, sale = s.sell(instanceId);
  assert.ok(sale.ok && c.ledger.cash - before === sale.cents);
  assert.ok(sale.cents <= rep.cents + Math.floor(0.5 * 9000 * 0.6), 'no repair-then-sell profit');
  assert.equal(s.owns('B05'), false);
});

test('renting: fee spent, 20% deposit held; deposit back after the trip, kept if the gear is lost', () => {
  const c = camp(), s = new Supplier(c);
  const r = s.rent('F08');
  assert.ok(r.ok && r.deposit === 1900);
  assert.equal(c.ledger.cash, 25000 - 9500 - 1900);
  assert.equal(c.ledger.reservedCents, 1900);
  s.commit('A1');
  assert.deepEqual(s.returnRentals().map((x) => x.refunded), [1900]);
  assert.equal(c.ledger.cash, 25000 - 9500);
  const c2 = camp(), s2 = new Supplier(c2);
  s2.rent('F08'); s2.commit('A1');
  assert.deepEqual(s2.returnRentals({ lost: true }).map((x) => x.kept), [1900]);
  const c3 = camp(), s3 = new Supplier(c3);
  const r3 = s3.rent('F08');
  assert.ok(s3.cancelRental(r3.rentalId).ok);
  assert.equal(c3.ledger.cash, 25000, 'cancelled before setting off: fee and deposit back');
});

test('gear works through the systems it affects, with its weight; no stat boosts', () => {
  const c = camp(200000), s = new Supplier(c);
  for (const id of Object.keys(CATALOGUE)) s.buy(id);
  const player = { speedAt: () => 0.6 }, thermo = { insulation: 1 }, flashlight = { light: { angle: 0.42, distance: 30, penumbra: 0.45 } }, photo = { raisedFov: 40 };
  s.apply({ player, thermo, flashlight, photo, setKit });
  assert.ok(Math.abs(player.speedAt(0, 0) - (1 - 0.4 * SUPPLIER.bootsRoughFactor)) < 1e-9, 'boots: rough ground slows you less');
  assert.equal(thermo.insulation, 1 + SUPPLIER.midlayerInsulation);
  assert.ok(flashlight.light.angle > 0.42 && flashlight.light.distance < 30, 'headlamp: wider, shorter');
  assert.equal(photo.raisedFov, SUPPLIER.telephotoFov);
  const load = computeLoad({});
  assert.equal(load.capacity, 30, 'the trail pack holds 30 L');
  setKit({});
  const bare = computeLoad({});
  assert.equal(bare.capacity, PACKS.daypack.L);
  assert.ok(load.worn - bare.worn > 1.4, `and the gear has weight (+${(load.worn - bare.worn).toFixed(2)} kg)`);
});
