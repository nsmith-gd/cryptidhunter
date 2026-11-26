import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BountyBoard, STARTER_BOUNTIES, ACTIVE_COUNT } from '../src/hunt/bounties.js';
import { Camp, CAMP } from '../src/hunt/camp.js';
import { SaveService, memoryBackend } from '../src/save/saveService.js';
import { bountyLines } from '../src/hunt/bountyPanel.js';

// A board with just the ticket's bounty: "Bigfoot photo 70+".
const BIGFOOT_70 = [{ id: 'bigfoot-70', cryptid: 'bigfoot', minScore: 70, bonus: 500, title: 'A good Bigfoot photo' }];
const memCamp = (backend = memoryBackend()) => new Camp(null, new SaveService(backend));

test('starter board offers 2-3 bounties at a time', () => {
  const b = new BountyBoard();
  assert.ok(STARTER_BOUNTIES.length >= 3);
  assert.equal(b.active().length, ACTIVE_COUNT);
  assert.ok(ACTIVE_COUNT >= 2 && ACTIVE_COUNT <= 3);
});

test('a Bigfoot photo scoring 70 pays the bonus; 69 does not', () => {
  const b = new BountyBoard({ bounties: BIGFOOT_70 });
  assert.equal(b.applySale([{ subject: 'Bigfoot', score: 69 }]).bonus, 0);
  assert.equal(b.isComplete('bigfoot-70'), false);
  const r = b.applySale([{ subject: 'Bigfoot', score: 70 }]);
  assert.equal(r.bonus, 500);
  assert.equal(r.paid[0].id, 'bigfoot-70');
  assert.equal(b.isComplete('bigfoot-70'), true);
});

test('a different cryptid does not pay a Bigfoot bounty', () => {
  const b = new BountyBoard({ bounties: BIGFOOT_70 });
  assert.equal(b.applySale([{ subject: 'Mothman', score: 95 }, { cryptid: 'chupacabra', score: 99 }]).bonus, 0);
  assert.equal(b.isComplete('bigfoot-70'), false);
});

test('a bounty pays only once', () => {
  const b = new BountyBoard({ bounties: BIGFOOT_70 });
  assert.equal(b.applySale([{ subject: 'Bigfoot', score: 80 }, { subject: 'Bigfoot', score: 90 }]).bonus, 500, 'two photos, one payout');
  assert.equal(b.applySale([{ subject: 'Bigfoot', score: 99 }]).bonus, 0, 'later sale pays nothing');
});

test('a great photo claims the biggest bounty it qualifies for, one bounty per photo', () => {
  const b = new BountyBoard();   // starter: Bigfoot 40+ ($150), Bigfoot 70+ ($500), Mothman 60+ ($400)
  const r = b.applySale([{ subject: 'Bigfoot', score: 75 }]);
  assert.deepEqual(r.paid.map((p) => p.id), ['bigfoot-70']);
  assert.equal(b.isComplete('bigfoot-clear'), false, 'the smaller one stays open for another photo');
});

test('selling through base camp pays score value + bounty, and the money and claim are saved', () => {
  const backend = memoryBackend();
  const camp = memCamp(backend);
  camp.bounties = new BountyBoard({ bounties: BIGFOOT_70 });
  const sale = camp.sellPhotos([{ subject: 'Bigfoot', score: 72 }], 'Bigfoot');
  const scoreValue = Math.round(72 * CAMP.ratePerPoint * CAMP.targetBonus);
  assert.equal(sale.base, scoreValue);
  assert.equal(sale.bountyBonus, 500);
  const START = 250;   // a new career's savings (#97)
  assert.equal(camp.state.money, START + scoreValue + 500);
  // Restart: money and the claimed bounty come back from the save file.
  const saved = JSON.parse(backend.read());
  assert.equal(saved.money, START + scoreValue + 500);
  assert.deepEqual(saved.bountiesDone, ['bigfoot-70']);
  const again = memCamp(backend);
  assert.equal(again.state.money, START + scoreValue + 500);
  assert.equal(again.bounties.isComplete('bigfoot-70'), true);
  // Selling another qualifying photo after the restart: score value only, no second bonus.
  again.bounties = new BountyBoard({ bounties: BIGFOOT_70, completed: again.bounties.completedIds });
  const second = again.sellPhotos([{ subject: 'Bigfoot', score: 90 }], 'Bigfoot');
  assert.equal(second.bountyBonus, 0);
  assert.equal(JSON.parse(backend.read()).money, START + scoreValue + 500 + second.base);
});

test('a settled hunt includes bounties in its earnings; caught hunts sell nothing', () => {
  const camp = memCamp();
  const won = camp.settleHunt({ outcome: 'complete', photos: [{ subject: 'Bigfoot', score: 71 }], gearLeft: {}, target: 'Bigfoot' });
  assert.ok(won.bounties.some((b) => b.id === 'bigfoot-70'));
  assert.equal(won.earned, Math.round(71 * CAMP.ratePerPoint * CAMP.targetBonus) + won.bountyBonus);
  const lost = memCamp().settleHunt({ outcome: 'caught', photos: [{ subject: 'Bigfoot', score: 95 }], gearLeft: {}, target: 'Bigfoot' });
  assert.equal(lost.earned, 0);
  assert.deepEqual(lost.bounties, []);
});

test('board panel lists target, threshold, bonus and claimed state', () => {
  const b = new BountyBoard({ completed: ['bigfoot-clear'] });
  const text = bountyLines(b).join('\n');
  assert.match(text, /\[ \] Bigfoot photo, score 70\+  ·  bonus \$500/);
  assert.match(text, /\[x\] Bigfoot photo, score 40\+  ·  \$150  ·  CLAIMED/);
});

test('saves without any claimed bounty keep the minimal format', () => {
  const backend = memoryBackend();
  new SaveService(backend).save({ money: 5, bountiesDone: [] });
  assert.deepEqual(JSON.parse(backend.read()), { version: 1, money: 5 });
});
