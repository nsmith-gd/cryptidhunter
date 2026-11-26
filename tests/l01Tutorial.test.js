// L01 Cabbagetown tutorial: layout guarantees (every seed) and the tutorial career rules (#102).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutFor, audit, OPTIONS } from '../src/l01/tunnelLayout.js';
import { TutorialCareer, freshL01, L01 } from '../src/l01/tutorialCareer.js';
import { Ledger } from '../src/economy/ledger.js';

test('every seeded layout: exit and warm alcove reachable dry, trace optional in the cold detour', () => {
  // Enumerate every combination of seeded picks (the seed only chooses among these options).
  const combos = OPTIONS.lunch.length * OPTIONS.trace.length * OPTIONS.creature.length;
  for (let i = 0; i < combos * 4; i++) {
    const seq = [((i % 2) + 0.5) / 2, (((i >> 1) % 2) + 0.5) / 2, (((i >> 2) % 2) + 0.5) / 2];
    let k = 0;
    const a = audit(layoutFor(() => seq[k++ % 3]));
    assert.ok(a.exitReachable && a.exitReachableDry, 'exit reachable without the water');
    assert.ok(a.alcoveReachableDry, 'recovery reachable without getting wet');
    assert.ok(a.lunchReachable && a.traceReachable && a.traceInDetour && a.landmarksReachable);
  }
});

test('the escape route is long enough for the 15-25 minute tutorial, but not a marathon', () => {
  const a = audit(layoutFor(() => 0.5));
  assert.ok(a.shortestEscapeM >= 300 && a.shortestEscapeM <= 600, `shortest escape ${a.shortestEscapeM} m`);
  assert.ok(a.tunnelM >= 2 * a.shortestEscapeM, 'side passages to explore');
});

const career = () => {
  const ledger = new Ledger();
  let n = 0;
  return { ledger, c: new TutorialCareer({ ledger, state: freshL01(), newId: () => `A${++n}` }) };
};

test('a new career has $250; entering the tunnels costs $25 once', () => {
  const { ledger, c } = career();
  assert.equal(ledger.cash, 25000);
  const r = c.enter();
  assert.equal(r.charged, 2500);
  assert.equal(ledger.cash, 22500);
  assert.ok(c.entranceCollapses, 'the entrance collapses on the first attempt');
});

test('tutorial death restarts the same attempt with no second entry fee', () => {
  const { ledger, c } = career();
  const first = c.enter();
  const d = c.die('hypothermia');
  assert.equal(d.tutorialRetry, true);
  const again = c.enter();
  assert.equal(again.attemptId, first.attemptId);
  assert.equal(again.charged, 0);
  assert.equal(ledger.cash, 22500);
  assert.ok(c.entranceCollapses, 'still the authored tutorial: the entrance still collapses');
});

test('escaping with no evidence clears the tutorial and unlocks the next trip', () => {
  const { ledger, c } = career();
  c.enter();
  const e = c.escape([]);
  assert.equal(e.firstClear, true);
  assert.deepEqual(c.s.unlocked, [L01.next.id]);
  assert.equal(e.settlement.gross, 0);
  assert.equal(ledger.cash, 22500);
  assert.equal(c.entranceCollapses, false, 'replays keep the entrance open');
  assert.ok(ledger.cash >= 0);
});

test('optional evidence pays once per event, even across attempts', () => {
  const { ledger, c } = career();
  c.enter();
  c.escape([{ kind: 'fur', eventId: 'tuft1' }]);
  assert.equal(ledger.cash, 22500 + 3000);
  c.enter();
  c.escape([{ kind: 'fur', eventId: 'tuft1' }]);      // the same tuft again: no second payment
  assert.equal(ledger.cash, 22500 + 3000 - 2500);
});

test('after clearing, a death settles the attempt (no free retry)', () => {
  const { c } = career();
  c.enter(); c.escape([]);
  c.enter();
  const d = c.die('hypothermia');
  assert.equal(d.tutorialRetry, false);
  assert.equal(c.s.open, null);
});
