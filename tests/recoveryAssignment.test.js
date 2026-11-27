import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryAssignment, SPONSOR, needsSponsor, surveySites } from '../src/hunt/recoveryAssignment.js';
import { Expedition, EXPEDITION } from '../src/hunt/expedition.js';
import { Camp } from '../src/hunt/camp.js';
import { SaveService, memoryBackend } from '../src/save/saveService.js';
import { chargeRecovery } from '../src/hunt/failureRules.js';

const broke = () => { const c = new Camp(null, new SaveService(memoryBackend())); c.state.money = 0; return c; };
const trip = EXPEDITION.tripCents;

test('offered only when no viable trip is affordable (trip cost plus deposits)', () => {
  assert.equal(needsSponsor({ cash: 2499, tripCents: 2500 }), true);
  assert.equal(needsSponsor({ cash: 2500, tripCents: 2500 }), false);
  assert.equal(needsSponsor({ cash: 2600, tripCents: 2500, mandatoryCents: 500 }), true);
  const rich = new RecoveryAssignment({ camp: new Camp(null, new SaveService(memoryBackend())), mapId: 'forest', tripCents: trip });
  assert.equal(rich.offered, false, 'a career with $250 can afford a trip: no sponsor work');
  assert.equal(new RecoveryAssignment({ camp: broke(), mapId: 'forest', tripCents: trip }).offered, true);
});

test('two distinct survey points, and the next assignment surveys new places', () => {
  const a = surveySites('forest', 0), b = surveySites('forest', 1);
  assert.notEqual(a[0].key, a[1].key);
  assert.ok(b.every((s) => !a.some((t) => t.key === s.key)), 'the next pair is all-new sites');
});

test('both points logged and driven out pays a fixed $100 once; the offer then disappears', () => {
  const c = broke();
  const r = new RecoveryAssignment({ camp: c, mapId: 'forest', tripCents: trip });
  const a = r.accept();
  assert.ok(a && r.active && !r.offered, 'one active assignment at a time');
  assert.equal(r.accept(), null);
  assert.deepEqual(r.loanerKit(), SPONSOR.loaner);
  for (const s of a.sites) s.done = true;
  const res = r.settle({ extracted: true });
  assert.equal(res.paid, true);
  assert.equal(c.ledger.cash, SPONSOR.payCents);
  assert.equal(r.active, null);
  assert.equal(r.offered, false, '$100 covers a $25 trip: sponsor work is gone');
});

test('failure pays nothing and another assignment is offered', () => {
  const c = broke();
  const r = new RecoveryAssignment({ camp: c, mapId: 'forest', tripCents: trip });
  const a = r.accept();
  a.sites[0].done = true;                                   // only one of two
  assert.equal(r.settle({ extracted: true }).paid, false);
  assert.equal(c.ledger.cash, 0);
  assert.equal(r.offered, true);
  const b = r.accept();
  assert.notEqual(b.id, a.id, 'a fresh assignment');
  assert.equal(r.settle({ extracted: false }).paid, false, 'not making it out pays nothing');
});

test('the save keeps the active assignment, and a broke player can\'t take a free trip instead', () => {
  const be = memoryBackend();
  const c = new Camp(null, new SaveService(be)); c.state.money = 0; c.save();
  const r = new RecoveryAssignment({ camp: c, mapId: 'forest', tripCents: trip });
  const x = new Expedition({ camp: c, loadout: null, mapName: 'Pine Hollow Forest', target: 'Bigfoot' });
  x.requireSponsor = () => r.offered;
  assert.equal(x.commit().ok, false, 'offered survey: no free trip');
  r.accept();
  const again = new RecoveryAssignment({ camp: c, mapId: 'forest', tripCents: trip });
  assert.equal(again.active?.id, r.active.id);
  const ok = x.commit();
  assert.equal(ok.ok, true, 'on the survey the trip itself is waived');
  assert.equal(c.ledger.cash, 0);
});

test('injury recovery charge after settlement: 5% / 10% of the trip, capped at cash, no debt', () => {
  const c = broke();
  const hurt = (value, conditions = []) => ({ value, conditions });
  assert.equal(chargeRecovery(c.ledger, hurt(60), trip, 'A1').cents, 0, 'nothing to take from $0: waived, no debt');
  c.state.money = 100;
  assert.equal(chargeRecovery(c.ledger, hurt(60), trip, 'A2').cents, Math.round(trip * 0.05));
  assert.equal(chargeRecovery(c.ledger, hurt(30), trip, 'A3').cents, Math.round(trip * 0.10));
  assert.equal(chargeRecovery(c.ledger, hurt(95), trip, 'A4'), null);
});
