// Shared capture state machine (#149; GDD §8.2, §8.3). Pure: no three.js, no DOM.
//
//   free -> eligible -> committed -> secured -> contained -> staged -> delivered
//
// - The creature's AI owns opportunity: it reports a clearly telegraphed, valid opening
//   (opportunity) and when it closes (opportunityLost). A missed opportunity costs time, never a
//   charge.
// - commit() is the one atomic spend: exactly one charge per commit, success or not, and only
//   from 'eligible'. The check is deterministic: the opportunity is still valid, the module is
//   compatible with the species, in working condition and has a charge. No dice.
// - secure() confirms a safe restraint at the site; contain(crate) transfers to a compatible crate
//   (capacity >= the creature's mass); stage(transport) loads it on a compatible transport; deliver()
//   pays the contract once.
// - Integrity 0-100 (warning < 40, failure at 0) and condition 0-100 (warning < 35, non-deliverable
//   at 0) tick while it's held. Integrity failure means escape. Condition failure leaves it held but
//   non-deliverable (no money for a dead or failed specimen).
// - Any failure before delivery returns the creature to 'free' in a plausible state for its
//   situation: 'recovering' (badly worn down), 'hostile' (aggressive and able) or 'fleeing'.
// - release() (emergency release) is always available before delivery and never locks an exit.
// One creature identity throughout: it never becomes an inventory item.

export const CAPTURE = Object.freeze({
  integrityWarn: 40,
  conditionWarn: 35,
  strainPerSec: { secured: 2.0, contained: 0.4, staged: 0.2 },   // integrity lost per second x resistance
  exposurePerSec: 1.5,      // condition lost per second of adverse exposure (cold, wrong containment)
  stabilizePerSec: 0.5,     // condition regained per second in safe, compatible containment
});

export const STATES = Object.freeze(['free', 'eligible', 'committed', 'secured', 'contained', 'staged', 'delivered']);

/** Where a creature plausibly goes after a failed capture, from its own condition and temperament. */
export function plausibleRecovery({ condition = 100, aggression = 0, fear = 0.5 } = {}) {
  if (condition < 35) return 'recovering';
  return aggression > fear ? 'hostile' : 'fleeing';
}

export class CaptureMachine {
  /**
   * creature: { id, species, mass, aggression, fear } (identity persists through every state).
   * module:   { id, kind, charges, condition (0-100), species: [compatible species ids] }
   */
  constructor({ creature, module, now = () => 0 }) {
    this.creature = { ...creature };
    this.module = { condition: 100, ...module };
    this.now = now;
    this.state = 'free';
    this.integrity = 100;
    this.condition = 100;
    this.deliverable = true;
    this.crate = null;
    this.transport = null;
    this.opening = null;
    this.outcome = null;        // after a failure: 'recovering' | 'fleeing' | 'hostile'
    this.delivered = null;
    this.trace = [];
    this.warned = { integrity: false, condition: false };
  }

  log(type, data = {}) { const e = { t: this.now(), type, state: this.state, creature: this.creature.id, ...data }; this.trace.push(e); return e; }
  go(state, why, data = {}) { const from = this.state; this.state = state; return this.log('transition', { from, to: state, why, ...data }); }
  refuse(why) { return { ok: false, why, state: this.state, ...this.log('refused', { why }) }; }
  get held() { return ['secured', 'contained', 'staged'].includes(this.state); }

  /** The AI reports a valid, telegraphed opening: { kind, ... }. */
  opportunity(o = {}) {
    if (this.state !== 'free') return this.refuse(`not free (${this.state})`);
    this.opening = { ...o, valid: true };
    this.go('eligible', o.kind ?? 'opening');
    return { ok: true, state: this.state };
  }

  /** The opening closed before the player committed: back to free, no charge spent. */
  opportunityLost(why = 'the opening closed') {
    if (this.state !== 'eligible') return this.refuse(`no open opportunity (${this.state})`);
    this.opening = null;
    this.go('free', why);
    return { ok: true, state: this.state, chargesLeft: this.module.charges };
  }

  /** Spend one charge. ctx: { stillValid?, condition?, aggression?, fear? } from the AI right now. */
  commit(ctx = {}) {
    if (this.state !== 'eligible') return this.refuse(this.state === 'free' ? 'no valid opportunity: nothing is spent' : `already ${this.state}`);
    if ((this.module.charges ?? 0) <= 0) return this.refuse('no charges left in the module');
    this.module.charges -= 1;                                             // atomic: spent whatever happens next
    const reasons = [];
    if (ctx.stillValid === false) reasons.push('the opportunity had closed');
    if (!(this.module.species ?? []).includes(this.creature.species)) reasons.push(`the ${this.module.kind ?? 'module'} isn't compatible with a ${this.creature.species}`);
    if ((this.module.condition ?? 100) <= 0) reasons.push('the module is broken');
    this.log('charge', { chargesLeft: this.module.charges });
    if (reasons.length) return this.fail(reasons.join('; '), ctx);
    this.opening = null;
    this.go('committed', 'commit landed');
    return { ok: true, state: this.state, chargesLeft: this.module.charges };
  }

  /** Confirm a safe restraint at the site. */
  secure() {
    if (this.state !== 'committed') return this.refuse(`can't secure from ${this.state}`);
    this.go('secured', 'restraint confirmed');
    return { ok: true, state: this.state };
  }

  /** Transfer to a crate: { id, capacity (kg), species: [...] }. */
  contain(crate) {
    if (this.state !== 'secured') return this.refuse(`can't contain from ${this.state}`);
    if (!crate) return this.refuse('no crate');
    if (!(crate.species ?? []).includes(this.creature.species)) return this.refuse('crate not compatible with this creature');
    if ((crate.capacity ?? 0) < (this.creature.mass ?? 0)) return this.refuse(`crate too small (${crate.capacity} kg < ${this.creature.mass} kg)`);
    this.crate = { ...crate };
    this.go('contained', `in ${crate.id}`);
    return { ok: true, state: this.state };
  }

  /** Load onto a transport: { id, capacity (kg) }, along a valid path { ok, why? }. */
  stage(transport, path = { ok: true }) {
    if (this.state !== 'contained') return this.refuse(`can't stage from ${this.state}`);
    const mass = (this.creature.mass ?? 0) + (this.crate?.mass ?? 0);
    if (!transport || (transport.capacity ?? 0) < mass) return this.refuse(`transport can't take ${mass} kg`);
    if (!path.ok) return this.refuse(`no route to the transport: ${path.why ?? 'blocked'}`);
    this.transport = { ...transport };
    this.go('staged', `on ${transport.id}`);
    return { ok: true, state: this.state };
  }

  /** Extract with the living specimen: pays the contract once. */
  deliver({ atExit = false, contractId = null } = {}) {
    if (this.state === 'delivered') return this.refuse('already delivered: the contract pays once');
    if (this.state !== 'staged') return this.refuse(`can't deliver from ${this.state}`);
    if (!atExit) return this.refuse('not at the extraction point');
    if (!this.deliverable) return this.refuse('the specimen is non-deliverable (condition failed)');
    this.delivered = { contractId, condition: Math.round(this.condition), integrity: Math.round(this.integrity) };
    this.go('delivered', 'contract verified', this.delivered);
    return { ok: true, state: this.state, entitlement: this.delivered };
  }

  /** Emergency release: always available before delivery. */
  release(why = 'emergency release') {
    if (this.state === 'delivered') return this.refuse('already delivered');
    if (this.state === 'free') return this.refuse('nothing to release');
    return this.fail(why, { condition: this.condition, aggression: 0, fear: 1 }, 'released');
  }

  /**
   * While it's held: integrity strains (x resistance, 0..2), condition drops with adverse exposure
   * and recovers slowly in safe compatible containment. Integrity 0 = escape; condition 0 = non-deliverable.
   */
  tick(dt, { resistance = 1, adverse = false, aggression, fear } = {}) {
    if (!this.held) return null;
    const C = CAPTURE;
    this.integrity = Math.max(0, this.integrity - C.strainPerSec[this.state] * resistance * dt);
    this.condition = Math.max(0, Math.min(100, this.condition + (adverse ? -C.exposurePerSec : (this.state === 'secured' ? 0 : C.stabilizePerSec)) * dt));
    if (this.integrity < C.integrityWarn && !this.warned.integrity) { this.warned.integrity = true; this.log('warning', { what: 'containment integrity low', integrity: Math.round(this.integrity) }); }
    if (this.condition < C.conditionWarn && !this.warned.condition) { this.warned.condition = true; this.log('warning', { what: 'specimen condition low', condition: Math.round(this.condition) }); }
    if (this.condition <= 0 && this.deliverable) { this.deliverable = false; this.log('nonDeliverable', { why: 'condition failed' }); }
    if (this.integrity <= 0) return this.fail('containment failed', { condition: this.condition, aggression: aggression ?? this.creature.aggression, fear: fear ?? this.creature.fear });
    return null;
  }

  /** Back to free, in a plausible state. Charges are never refunded. */
  fail(why, ctx = {}, kind = 'failed') {
    const outcome = kind === 'released' ? (ctx.condition < 35 ? 'recovering' : 'fleeing')
      : plausibleRecovery({ condition: ctx.condition ?? this.condition, aggression: ctx.aggression ?? this.creature.aggression ?? 0, fear: ctx.fear ?? this.creature.fear ?? 0.5 });
    this.outcome = outcome;
    this.opening = null; this.crate = null; this.transport = null;
    this.integrity = 100; this.warned = { integrity: false, condition: false };
    this.go('free', why, { kind, creatureNow: outcome });
    return { ok: false, why, state: this.state, outcome, chargesLeft: this.module.charges };
  }
}
