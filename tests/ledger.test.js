import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, ECONOMY, cents, resaleValue, repairCost, formatCAD } from '../src/economy/ledger.js';

test('reproduces the GDD 3.7 early ledger: 250 -> 375 -> 620 -> 925', () => {
  const l = new Ledger();
  const run = [l.cash];
  const step = (r) => { assert.equal(r.ok, true); run.push(l.cash); };
  assert.equal(l.cash, 25000);
  step(l.commitAttempt('L01-a1', ECONOMY.tripCostCents.L01));
  l.settleAttempt('L01-a1', { records: [{ id: 'ev:L01-a1:1', cents: cents(150), extracted: true }] }); run.push(l.cash);
  step(l.purchase('buy:boots-canteen-compass-map', cents(130)));
  step(l.commitAttempt('L02-a1', cents(75)));
  l.settleAttempt('L02-a1', { records: [{ id: 'ev:L02-a1:1', cents: cents(450) }] }); run.push(l.cash);
  step(l.purchase('buy:tent-bag-mat-cookware', cents(245)));
  step(l.commitAttempt('L03-a1', cents(150)));
  l.settleAttempt('L03-a1', { records: [{ id: 'ev:L03-a1:1', cents: cents(700) }] }); run.push(l.cash);
  assert.deepEqual(run.map((c) => c / 100), [250, 225, 375, 245, 170, 620, 375, 225, 925]);
  assert.equal(l.audit().ok, true);
});

test('no double charge: the same purchase, trip or settlement id posts once', () => {
  const l = new Ledger();
  l.purchase('buy:bait:1', 1500); l.purchase('buy:bait:1', 1500);
  l.commitAttempt('a1', 2500); l.commitAttempt('a1', 2500);
  assert.equal(l.cash, 25000 - 1500 - 2500);
  const s1 = l.settleAttempt('a1', { records: [{ id: 'photo:a1:bigfoot', cents: 5000 }], charges: [{ id: 'evac', cents: 1000 }] });
  const s2 = l.settleAttempt('a1', { records: [{ id: 'photo:a1:bigfoot', cents: 5000 }], charges: [{ id: 'evac', cents: 1000 }] });
  assert.equal(s2.duplicate, true);
  assert.equal(s2.closing, s1.closing);
  assert.equal(l.cash, 25000 - 1500 - 2500 + 5000 - 1000);
  assert.equal(l.audit().ok, true);
});

test('an entitlement paid in one attempt pays nothing when presented again in another', () => {
  const l = new Ledger();
  l.settleAttempt('a1', { records: [{ id: 'bounty:bigfoot-clear', cents: 15000 }] });
  const s = l.settleAttempt('a2', { records: [{ id: 'bounty:bigfoot-clear', cents: 15000 }] });
  assert.equal(s.gross, 0);
  assert.equal(s.skipped[0].reason, 'already paid');
  assert.equal(l.cash, 25000 + 15000);
});

test('no payout for unextracted records', () => {
  const l = new Ledger();
  l.commitAttempt('a1', 2500);
  const caught = l.settleAttempt('a1', { extracted: false, records: [{ id: 'ev:a1:1', cents: 9000 }] });
  assert.equal(caught.gross, 0);
  const s = l.settleAttempt('a2', { records: [{ id: 'ev:a2:1', cents: 9000, extracted: false }, { id: 'ev:a2:2', cents: 3000, extracted: true }] });
  assert.equal(s.gross, 3000);
  assert.equal(l.cash, 25000 - 2500 + 3000);
});

test('spendable cash never goes negative: unaffordable charges are refused, emergency fees collected only up to cash', () => {
  const l = new Ledger({ startCents: 1000 });
  const r = l.purchase('buy:camera', 6000);
  assert.equal(r.ok, false);
  assert.equal(l.cash, 1000);
  assert.equal(l.commitAttempt('a1', 2500).ok, false);
  assert.equal(l.attempts.a1, undefined, 'a refused commit leaves no attempt behind');
  const s = l.settleAttempt('a2', { charges: [{ id: 'evac', cents: 50000 }] });
  assert.deepEqual(s.charges[0], { id: 'evac', quoted: 50000, collected: 1000, waived: 49000 });
  assert.equal(l.cash, 0);
  assert.throws(() => l.post('x', 'purchase', 12.5));   // integer cents only
});

test('deposits are 20%, held apart from cash, and returned once less capped damage', () => {
  const l = new Ledger();
  assert.equal(l.rent('boat', 10000).ok, true);
  assert.equal(l.cash, 25000 - 10000 - 2000);
  assert.equal(l.reservedCents, 2000);
  const r = l.returnDeposit('boat', 500);
  assert.deepEqual([r.refunded, r.kept], [1500, 500]);
  assert.equal(l.returnDeposit('boat', 0).duplicate, true);
  assert.equal(l.cash, 25000 - 10000 - 500);
  assert.equal(l.reservedCents, 0);
  l.rent('sled', 5000);
  assert.equal(l.returnDeposit('sled', 99999).kept, 1000, 'damage never exceeds the deposit');
});

test('resale = floor(0.5 x list x condition); repair = ceil(0.35 x list x restored), capped at list', () => {
  assert.equal(resaleValue(12999, 0.7), Math.floor(0.5 * 12999 * 0.7));
  assert.equal(repairCost(12999, 0.3), Math.ceil(0.35 * 12999 * 0.3));
  assert.equal(repairCost(1000, 5), 1000);
  const l = new Ledger();
  l.addAsset('boots#1', 8000, 0.5);
  const s = l.sell('boots#1');
  assert.equal(s.cents, 2000);
  assert.equal(l.sell('boots#1').duplicate, true);
  assert.equal(l.cash, 27000);
});

test('no resale arbitrage: buying then selling, or repairing then selling, never makes money', () => {
  for (const list of [999, 4500, 13001, 250000]) {
    for (const cond of [0.05, 0.33, 0.5, 0.77, 0.99]) {
      // Buy new, sell: always a loss.
      const a = new Ledger({ startCents: 1e6 });
      assert.equal(a.purchase('buy:g', list).ok, true); a.addAsset('g', list, 1); a.sell('g');
      assert.ok(a.cash < 1e6, `buy/sell ${list}`);
      // Damaged gear: compare selling as-is with repairing first.
      const asIs = new Ledger(); asIs.addAsset('g', list, cond); asIs.sell('g');
      const fixed = new Ledger(); fixed.addAsset('g', list, cond); fixed.repair('g', 1); fixed.sell('g');
      assert.ok(fixed.cash <= asIs.cash, `repair+sell ${list} @${cond}: ${fixed.cash} > ${asIs.cash}`);
    }
  }
});

test('the ledger round-trips through JSON and recomputes cash from its transactions', () => {
  const l = new Ledger();
  l.purchase('buy:bait:1', 1500); l.commitAttempt('a1', 2500); l.rent('r', 1000);
  l.settleAttempt('a1', { records: [{ id: 'ev:a1:1', cents: 4321 }] });
  const back = Ledger.fromJSON(JSON.parse(JSON.stringify(l)));
  assert.equal(back.cash, l.cash);
  assert.equal(back.settleAttempt('a1', {}).duplicate, true, 'a restarted debrief does not settle twice');
  assert.equal(back.purchase('buy:bait:1', 1500).duplicate, true);
  assert.equal(Ledger.fromJSON({ tx: [{ id: 'x', cents: -5 }] }), null, 'a save that would be negative is rejected');
  assert.equal(formatCAD(1250), '$12.50');
  assert.equal(formatCAD(25000), '$250');
});

test('100 seeded random careers keep every invariant', () => {
  let s = 97;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let career = 0; career < 100; career++) {
    const l = new Ledger();
    for (let n = 0; n < 30; n++) {
      const id = `a${n}`, roll = rand();
      if (roll < 0.3) l.purchase(l.nextId('buy'), Math.floor(rand() * 20000));
      l.commitAttempt(id, Math.floor(rand() * 10000));
      if (rand() < 0.2) l.rent(`r${n}`, Math.floor(rand() * 8000));
      const extracted = rand() < 0.7;
      const recs = [{ id: `ev:${id}`, cents: Math.floor(rand() * 30000) }, { id: `bounty:${Math.floor(rand() * 5)}`, cents: 10000 }];
      l.settleAttempt(id, { records: recs, extracted, charges: rand() < 0.1 ? [{ id: 'evac', cents: 40000 }] : [] });
      l.settleAttempt(id, { records: recs, extracted });            // retried debrief
      if (l.reserved[`r${n}`]) l.returnDeposit(`r${n}`, Math.floor(rand() * 3000));
      assert.ok(l.cash >= 0);
    }
    assert.equal(l.audit().ok, true, `career ${career}`);
  }
});

test('base camp money and the shop read from the ledger', async () => {
  const { Camp } = await import('../src/hunt/camp.js');
  const { SaveService, memoryBackend } = await import('../src/save/saveService.js');
  const { buyGear, buyUpgrade, SHOP } = await import('../src/hunt/shop.js').catch(() => ({}));
  const backend = memoryBackend();
  const camp = new Camp(null, new SaveService(backend));
  assert.equal(camp.state.money, 250, 'a new career starts with $250');
  assert.equal(camp.ledger.cash, 25000);
  if (buyGear) {
    assert.equal(buyGear(camp, 'bait').ok, true);
    assert.equal(camp.ledger.cash, 25000 - SHOP.gear.bait.price * 100);
    assert.equal(buyUpgrade(camp, 'film').ok, true);
    assert.ok(camp.ledger.has('upgrade:film:1'));
  }
  const h = camp.settleHunt({ outcome: 'complete', photos: [{ subject: 'Bigfoot', score: 50 }], gearLeft: {}, target: 'Bigfoot',
    evidence: [{ id: 1, type: 'hairSample', name: 'Hair sample', cryptid: 'Bigfoot', stage: 'extracted' }] });
  assert.equal(camp.ledger.settleAttempt(h.attemptId, {}).duplicate, true);
  const restarted = new Camp(null, new SaveService(backend));
  assert.equal(restarted.ledger.cash, camp.ledger.cash, 'the ledger survives a restart');
  assert.equal(restarted.state.money, camp.state.money);
  assert.equal(restarted.ledger.audit().ok, true);
  assert.equal(JSON.stringify(restarted.state).includes('"money"'), false, 'money is not stored twice');
});
