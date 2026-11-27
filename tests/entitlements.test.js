import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyEntitlements, settleEntitlements, offer } from '../src/evidence/entitlements.js';
import { SETTLEMENT } from '../src/evidence/evidence.js';

const cfg = { ...SETTLEMENT, T: 250 };
const fp = (id, eventId, M = 0.8, grade = 3) => ({ id, type: 'footprintPhoto', species: 'Bigfoot', eventId, B: 10, M, grade });

test('offer = round half up (T x 0.01 x B x M x N x A)', () => {
  assert.equal(offer({ T: 250, B: 35, M: 1 }), 88);
  assert.equal(offer({ T: 250, B: 10, M: 0.55 }), 14);
  assert.equal(offer({ T: 250, B: 35, M: 1, A: 1.2 }), 105);
});

test('the same footprint photographed twice pays once', () => {
  const r = settleEntitlements(emptyEntitlements(), [fp('a', 'print:7'), fp('b', 'print:7')], { cfg });
  assert.deepEqual(r.lines.map((l) => [l.kind, l.value]), [['new', 20], ['duplicate', 0]]);
  assert.equal(r.total, 20);
});

test('a replay pays only new events; a better grade pays the positive increment', () => {
  const first = settleEntitlements(emptyEntitlements(), [fp('a', 'print:7', 0.55, 2)], { cfg, attemptId: 'A1' });
  const json = JSON.parse(JSON.stringify(first.ledger));                                  // plain, serialisable
  const second = settleEntitlements(json, [fp('b', 'print:7', 0.55, 2), fp('c', 'print:9', 0.55, 2), fp('d', 'print:7b', 0.8, 3)], { cfg, attemptId: 'A2' });
  assert.deepEqual(second.lines.map((l) => [l.kind, l.value, l.N]), [['duplicate', 0, 1], ['new', 7, 0.5], ['new', 5, 0.25]]);
  const third = settleEntitlements(second.ledger, [fp('e', 'print:7', 1, 4), fp('f', 'print:11', 1, 4)], { cfg });
  assert.deepEqual(third.lines.map((l) => [l.kind, l.value]), [['upgrade', 11], ['new', 6]]);   // 25 - 14; floor 0.25
});

test('different types of one event are separate entitlements; rejected entries pay nothing', () => {
  const r = settleEntitlements(emptyEntitlements(), [fp('a', 'e1'), { id: 'b', type: 'footprintCast', species: 'Bigfoot', eventId: 'e1', B: 20, M: 0.8 }, { ...fp('c', 'e2'), M: 0 }], { cfg });
  assert.deepEqual(r.lines.map((l) => [l.kind, l.value]), [['new', 20], ['new', 40], ['rejected', 0]]);
});

test('the per-attempt ceiling holds: evidence and bonuses together never exceed T', () => {
  const photos = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, type: 'creaturePhoto', species: n % 2 ? 'Bigfoot' : 'Mothman', eventId: `s${n}`, B: 35, M: 1 }));
  const r = settleEntitlements(emptyEntitlements(), photos, { cfg, bonuses: [{ id: 'dawn', memo: 'Home before dawn', value: 40 }] });
  assert.equal(r.total, 250);
  assert.ok(r.clipped > 0);
  assert.equal(r.lines.at(-1).value, 0);
  assert.ok(r.lines.some((l) => l.clip));
});

test('buyer affinity is clamped to 0.8-1.2', () => {
  const r = settleEntitlements(emptyEntitlements(), [{ ...fp('a', 'e1', 1, 4), A: 3 }], { cfg });
  assert.equal(r.lines[0].value, offer({ T: 250, B: 10, M: 1, A: 1.2 }));
});
