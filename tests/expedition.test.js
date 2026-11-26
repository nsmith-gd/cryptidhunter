import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutcome, Expedition, EXPEDITION, manifestText } from '../src/hunt/expedition.js';
import { Camp } from '../src/hunt/camp.js';
import { SaveService, memoryBackend } from '../src/save/saveService.js';

const camp = (backend = memoryBackend()) => new Camp(null, new SaveService(backend));

test('outcome classes follow GDD 6.4', () => {
  assert.equal(classifyOutcome({ huntOutcome: 'complete', targetPhoto: true }), 'successful');
  assert.equal(classifyOutcome({ huntOutcome: 'abandoned', evidence: 2 }), 'partial');
  assert.equal(classifyOutcome({ huntOutcome: 'abandoned', photos: 1 }), 'partial');
  assert.equal(classifyOutcome({ huntOutcome: 'abandoned' }), 'empty');
  assert.equal(classifyOutcome({ huntOutcome: 'emergency', targetPhoto: true }), 'emergency');
  assert.equal(classifyOutcome({ huntOutcome: 'complete', targetPhoto: true, capture: { attempted: true, delivered: false } }), 'failed-capture');
  assert.equal(classifyOutcome({ huntOutcome: 'caught', targetPhoto: true }), 'missing');
});

test('commit debits the trip once and creates one attempt ID', () => {
  const c = camp();
  const x = new Expedition({ camp: c, loadout: null, mapName: 'Pine Hollow Forest', target: 'Bigfoot' });
  assert.equal(x.committed, false);
  assert.equal(c.ledger.cash, 25000, 'planning charges nothing');
  const r = x.commit();
  assert.equal(r.ok, true);
  assert.equal(x.commit().duplicate, true);
  assert.equal(c.ledger.cash, 25000 - EXPEDITION.tripCents);
  assert.equal(c.ledger.tx.filter((t) => t.kind === 'trip').length, 1);
  assert.equal(c.state.activeAttempt, r.attemptId);
});

test('settling the hunt uses the committed attempt; emergency fees are charged once and never below zero', () => {
  const c = camp();
  const x = new Expedition({ camp: c, loadout: null, mapName: 'Pine Hollow Forest', target: 'Bigfoot' });
  x.commit();
  const h = c.settleHunt({ outcome: 'emergency', photos: [], gearLeft: {}, target: 'Bigfoot', attemptId: x.attemptId,
    charges: [{ id: 'evac', cents: EXPEDITION.emergencyCents }],
    evidence: [{ id: 1, type: 'hairSample', name: 'Hair sample', cryptid: 'Bigfoot', stage: 'extracted' }] });
  x.settled();
  assert.equal(h.outcomeClass, 'emergency');
  assert.equal(h.ledger.charges, 4000);
  assert.equal(h.ledger.expense, 2500);
  assert.equal(h.ledger.closing, 25000 - 2500 - 4000 + h.ledger.gross);
  assert.equal(c.ledger.settleAttempt(x.attemptId, {}).duplicate, true);
  // A broke player: the sponsor waives the trip, and an evacuation takes only what's there.
  const poor = camp(); poor.ledger.setCash(1000);
  const y = new Expedition({ camp: poor, loadout: null, mapName: 'Pine Hollow Forest', target: 'Bigfoot' });
  assert.equal(y.commit().charged, 0);
  const p = poor.settleHunt({ outcome: 'emergency', photos: [], gearLeft: {}, target: 'Bigfoot', attemptId: y.attemptId,
    charges: [{ id: 'evac', cents: EXPEDITION.emergencyCents }] });
  assert.equal(p.ledger.closing, 0);
  assert.equal(p.ledger.waived, 3000);
});

test('an attempt left open by closing the game is settled once as unextracted on the next start', () => {
  const backend = memoryBackend();
  const c = camp(backend);
  new Expedition({ camp: c, loadout: null, mapName: 'P', target: 'Bigfoot' }).commit();
  const cash = c.ledger.cash;
  const next = camp(backend);
  const x = new Expedition({ camp: next, loadout: null, mapName: 'P', target: 'Bigfoot' });
  assert.equal(next.ledger.cash, cash, 'no refund, no second charge');
  assert.equal(x.committed, false);
  assert.ok(Object.values(next.ledger.attempts).every((a) => a.state === 'settled'));
});

test('the extraction manifest lists what is loaded, what is left behind and warns that leaving is final', () => {
  const t = manifestText({ evidence: ['Hair sample (Bigfoot)'], photos: 3, targetPhotos: 1, target: 'Bigfoot', leftBehind: ['2 trail cameras still set out'], kg: 12.6 });
  assert.match(t, /Hair sample/);
  assert.match(t, /3 \(1 of Bigfoot\)/);
  assert.match(t, /2 trail cameras still set out/);
  assert.match(t, /final/);
});
