import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureMachine, plausibleRecovery, CAPTURE } from '../src/capture/captureMachine.js';

const dogman = () => ({ id: 'dogman-1', species: 'dogman', mass: 140, aggression: 0.7, fear: 0.4 });
const light = (charges = 3) => ({ id: 'G03', kind: 'light capture module', charges, species: ['dogman'] });
const crate = { id: 'crate-G04', capacity: 180, mass: 60, species: ['dogman'] };
const sled = { id: 'cargo sled', capacity: 260 };
const make = (o = {}) => new CaptureMachine({ creature: { ...dogman(), ...o.creature }, module: { ...light(), ...o.module } });

test('the whole chain: free -> eligible -> committed -> secured -> contained -> staged -> delivered, once', () => {
  const m = make();
  assert.ok(m.opportunity({ kind: 'feeding at the carcass' }).ok);
  assert.ok(m.commit().ok);
  assert.ok(m.secure().ok);
  assert.ok(m.contain(crate).ok);
  assert.ok(m.stage(sled).ok);
  const d = m.deliver({ atExit: true, contractId: 'C-L10' });
  assert.ok(d.ok && d.entitlement.contractId === 'C-L10');
  assert.equal(m.deliver({ atExit: true }).ok, false);           // pays once
  assert.deepEqual(m.trace.filter((e) => e.type === 'transition').map((e) => e.to), ['eligible', 'committed', 'secured', 'contained', 'staged', 'delivered']);
  assert.ok(m.trace.every((e) => e.creature === 'dogman-1'));     // one identity throughout
});

test('one charge per commit: success spends one, a second commit is refused and spends nothing', () => {
  const m = make();
  m.opportunity();
  m.commit();
  assert.equal(m.module.charges, 2);
  assert.equal(m.commit().ok, false);
  assert.equal(m.module.charges, 2);
});

test('no opportunity, no spend: committing while free is refused; a missed opportunity costs time, not a charge', () => {
  const m = make();
  assert.equal(m.commit().ok, false);
  m.opportunity(); m.opportunityLost();
  assert.equal(m.state, 'free');
  assert.equal(m.module.charges, 3);
});

test('a failed commit spends its one charge and returns the creature to a plausible state', () => {
  const late = make();
  late.opportunity();
  const r = late.commit({ stillValid: false, aggression: 0.8, fear: 0.3 });
  assert.equal(r.ok, false); assert.equal(late.state, 'free'); assert.equal(late.module.charges, 2);
  assert.equal(r.outcome, 'hostile');                               // an able, aggressive animal turns on you
  const wrong = make({ module: { species: ['hodag'] }, creature: { aggression: 0.1, fear: 0.9 } });
  wrong.opportunity();
  const w = wrong.commit();
  assert.equal(w.outcome, 'fleeing'); assert.match(w.why, /isn't compatible/); assert.equal(wrong.module.charges, 2);
  const empty = make({ module: { charges: 0 } });
  empty.opportunity();
  assert.match(empty.commit().why, /no charges/);
  assert.equal(empty.state, 'eligible');                            // nothing happened, the window is still open
});

test('plausible recovery comes from its actual condition and temperament', () => {
  assert.equal(plausibleRecovery({ condition: 20, aggression: 1, fear: 0 }), 'recovering');
  assert.equal(plausibleRecovery({ condition: 90, aggression: 0.8, fear: 0.2 }), 'hostile');
  assert.equal(plausibleRecovery({ condition: 90, aggression: 0.2, fear: 0.8 }), 'fleeing');
});

test('containment strain: a warning below 40, escape at 0 (back to free, the charge stays spent)', () => {
  const m = make();
  m.opportunity(); m.commit(); m.secure();
  let r = null;
  for (let t = 0; t < 120 && !r; t += 0.5) r = m.tick(0.5, { resistance: 1.5 });
  assert.ok(m.trace.some((e) => e.type === 'warning' && /integrity/.test(e.what)));
  assert.equal(r.ok, false); assert.equal(m.state, 'free'); assert.equal(m.module.charges, 2);
  assert.match(r.why, /containment failed/);
});

test('condition: warning below 35; at 0 it is non-deliverable and delivery is refused', () => {
  const m = make();
  m.opportunity(); m.commit(); m.secure(); m.contain(crate); m.stage(sled);
  for (let t = 0; t < 80; t += 1) m.tick(1, { adverse: true, resistance: 0 });
  assert.ok(m.trace.some((e) => e.type === 'warning' && /condition/.test(e.what)));
  assert.equal(m.deliverable, false);
  assert.match(m.deliver({ atExit: true }).why, /non-deliverable/);
});

test('safe compatible containment stabilises condition', () => {
  const m = make();
  m.opportunity(); m.commit(); m.secure(); m.contain(crate);
  m.condition = 50;
  for (let t = 0; t < 20; t++) m.tick(1, { resistance: 0 });
  assert.ok(m.condition > 55);
});

test('crate and transport are checked: compatible species, capacity, a route', () => {
  const m = make();
  m.opportunity(); m.commit(); m.secure();
  assert.match(m.contain({ ...crate, capacity: 100 }).why, /too small/);
  assert.match(m.contain({ ...crate, species: ['hodag'] }).why, /not compatible/);
  m.contain(crate);
  assert.match(m.stage({ id: 'sled', capacity: 150 }).why, /can't take 200 kg/);
  assert.match(m.stage(sled, { ok: false, why: 'snowdrift across the track' }).why, /snowdrift/);
  assert.ok(m.stage(sled).ok);
  assert.match(m.deliver({ atExit: false }).why, /extraction point/);
});

test('emergency release is always available before delivery', () => {
  for (const steps of [['opportunity'], ['opportunity', 'commit'], ['opportunity', 'commit', 'secure'], ['opportunity', 'commit', 'secure', 'contain'], ['opportunity', 'commit', 'secure', 'contain', 'stage']]) {
    const m = make();
    for (const s of steps) s === 'contain' ? m.contain(crate) : s === 'stage' ? m.stage(sled) : m[s]();
    const r = m.release();
    assert.equal(m.state, 'free', steps.join('>')); assert.equal(r.outcome, 'fleeing');
  }
  assert.ok(CAPTURE.integrityWarn === 40 && CAPTURE.conditionWarn === 35);
});
