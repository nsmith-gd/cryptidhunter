import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Equipment, WEAR, REPAIR_KIT } from '../src/gear/condition.js';
import { Ledger } from '../src/economy/ledger.js';

const fakeCamp = () => ({ state: {}, ledger: new Ledger(), save() {} });

test('starter kit becomes persistent instances at full condition', () => {
  const camp = fakeCamp(), eq = new Equipment(camp);
  assert.equal(eq.condition('camera'), 1);
  assert.ok(camp.ledger.assets[eq.items.camera.instanceId]);
  const eq2 = new Equipment(camp);                       // same instances on the next load
  assert.equal(eq2.items.camera.instanceId, eq.items.camera.instanceId);
});

test('a dunk in water drops the camera; condition only scales low-light clarity', () => {
  const eq = new Equipment(fakeCamp());
  eq.dunk('camera');
  assert.equal(eq.condition('camera'), 1 - WEAR.cameraDunk);
  assert.ok(Math.abs(eq.cameraClarity - (1 - WEAR.lowLightPenalty * WEAR.cameraDunk)) < 1e-9);
});

test('HQ repair is one ledger charge of ceil(0.35 x list x restored); resale drops with condition', () => {
  const camp = fakeCamp(), eq = new Equipment(camp);
  const fresh = eq.quote('camera');
  eq.dunk('camera');
  const q = eq.quote('camera');
  assert.equal(q.resaleCents, Math.floor(6000 * 0.5 * 0.6));
  assert.ok(q.resaleCents < fresh.resaleCents);
  assert.equal(q.repairCents, Math.ceil(0.35 * 6000 * 0.4));
  const cash0 = camp.ledger.cash;
  const r = eq.repair('camera');
  assert.ok(r.ok);
  assert.equal(camp.ledger.cash, cash0 - q.repairCents);
  assert.equal(eq.condition('camera'), 1);
  assert.equal(camp.ledger.tx.filter((e) => e.kind === 'repair').length, 1);
  // Repaired condition resells at the repair rate: no repair-then-sell profit.
  assert.ok(eq.quote('camera').resaleCents - q.resaleCents <= q.repairCents);
});

test('field repair kit: 5 uses, +25% up to 75%, cannot fix catastrophic damage', () => {
  const eq = new Equipment(fakeCamp());
  const kit = { uses: REPAIR_KIT.uses };
  eq.dunk('camera');                                      // 0.6
  let r = eq.fieldRepair(kit);
  assert.equal(r.item, 'camera'); assert.equal(eq.condition('camera'), 0.75); assert.equal(kit.uses, 4);
  eq.wear('flashlight', 0.95, 'impact');                  // 0.05: catastrophic
  r = eq.fieldRepair(kit);
  assert.equal(r.ok, false);
  assert.match(r.reason, /too badly damaged|nothing/);
});
