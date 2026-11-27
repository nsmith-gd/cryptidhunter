// S07 Hydration (GDD 1.2 S07, 2.2 P05, 2.8, 3.2 A03/A04/A07; #103). Owns the hydration
// reserve (0-100) and the water you can drink: sealed bottles (A04 safe water, the litres you
// packed), the canteen (A03, 1 L, refillable at a stream or the swamp) and purification tablets
// (A07). Same bands as nutrition: >50 comfortable, 25-50 strained, <25 impaired.
//
//   Drain    slow at rest, faster when you sprint or are warm; a full reserve lasts ~25 min.
//   Drink    I: a few big swallows (0.25 L) from a bottle first, then the canteen; it absorbs over
//            a few seconds, it is not an instant refill.
//   Refill   I while standing in a stream or swamp with a canteen that isn't full: it fills with
//            untreated water. If you carry tablets, one goes in and the water is safe after a
//            short wait; drink it before then (or without tablets) and it's unsafe.
//   Unsafe   drinking untreated water can make you ill a little later. Illness is never its own
//            damage: it is reported to S08 Health as an exposure condition (the one damage path).
//   Effect   below 50 stamina recovers slower (GDD 2.8 thirst_penalty, inside the shared 0.25
//            floor); critical sustained dehydration also goes through S08. Off in the tutorial.

export const HYDRATION = {
  start: 80,
  baseDrain: 100 / (25 * 60),   // ~25 min of quiet walking from full to empty
  sprintMul: 3,                 // exertion: sweating it out
  warmMul: 1.4,                 // by a fire / warm core
  sip: 0.25,                    // litres per drink
  perLitre: 40,                 // hydration per litre absorbed
  absorbTime: 6,                // seconds to absorb a drink
  canteenL: 1,                  // A03
  purifyTime: 30,               // seconds a tablet takes (A07 "waiting time")
  tabletsPerPack: 6,
  illness: { chance: 0.6, delay: 40, seconds: 45, rate: 0.3 },   // health/s via S08 while ill
  critical: 5,                  // below this for `criticalAfter` s (non-tutorial): S08 exposure
  criticalAfter: 60,
  criticalDrain: 0.25,
};

export class Hydration {
  /**
   * bottles: { get(): litres, set(n) } (the packed water, shared with the pack's load).
   * canteen: owns one? tablets: count. health: S08 (illness and critical dehydration). getWater(): 'dry'|'shallow'|'deep'.
   */
  constructor({ player, bottles, canteen = false, tablets = 0, health = null, getWater = () => 'dry', getWarm = () => false,
    enabled = true, lethal = true, rand = Math.random, start = HYDRATION.start }) {
    this.player = player;
    this.bottles = bottles;
    this.hasCanteen = canteen;
    this.canteen = { litres: canteen ? HYDRATION.canteenL : 0, safe: true, purifyLeft: 0 };   // you set off with it full of tap water
    this.tablets = tablets;
    this.health = health;
    this.getWater = getWater;
    this.getWarm = getWarm;
    this.enabled = enabled;
    this.lethal = lethal;
    this.rand = rand;
    this.value = start;
    this.absorbing = [];          // [{ left, rate }]
    this.illness = null;          // { incubate, left } after drinking unsafe water
    this.criticalFor = 0;
    this.log = [];                // { t, what, ... } for checks
    this.time = 0;
  }

  get band() { return this.value > 50 ? 'hydrated' : this.value > 25 ? 'thirsty' : 'dehydrated'; }

  /** 0 when hydrated (>50), rising to 1 at empty (stamina recovery reads this, GDD 2.8). */
  get thirstDeficit() { return this.enabled ? Math.max(0, Math.min(1, (50 - this.value) / 50)) : 0; }

  get drinkable() { return (this.bottles?.get() ?? 0) + this.canteen.litres; }

  /** I: fill the canteen when standing in water and it isn't full, otherwise drink. */
  act() {
    if (!this.enabled) return { ok: false, text: 'No need to drink right now' };
    const w = this.getWater();
    if (this.hasCanteen && w !== 'dry' && this.canteen.litres < HYDRATION.canteenL - 1e-6) return this.refill();
    return this.drink();
  }

  drink() {
    const b = this.bottles?.get() ?? 0;
    let src = null;
    if (b >= HYDRATION.sip - 1e-6) { this.bottles.set(+(b - HYDRATION.sip).toFixed(2)); src = 'bottle'; }
    else if (this.canteen.litres >= HYDRATION.sip - 1e-6) { this.canteen.litres = +(this.canteen.litres - HYDRATION.sip).toFixed(2); src = 'canteen'; }
    if (!src) return { ok: false, text: this.hasCanteen ? 'Out of water: fill the canteen at a stream (I)' : 'Out of water' };
    const gain = HYDRATION.sip * HYDRATION.perLitre;
    this.absorbing.push({ left: gain, rate: gain / HYDRATION.absorbTime });
    const unsafe = src === 'canteen' && !this.canteen.safe;
    if (unsafe && !this.illness && this.rand() < HYDRATION.illness.chance) this.illness = { incubate: HYDRATION.illness.delay, left: HYDRATION.illness.seconds };
    this.log.push({ t: +this.time.toFixed(1), what: 'drink', src, unsafe });
    return { ok: true, src, unsafe, text: `Drank from the ${src}${unsafe ? ' (untreated water…)' : ''}` };
  }

  refill() {
    const c = this.canteen;
    c.litres = HYDRATION.canteenL;
    c.safe = false;
    if (this.tablets > 0) { this.tablets--; this.onTablet?.(); c.purifyLeft = HYDRATION.purifyTime; }
    else c.purifyLeft = 0;
    this.log.push({ t: +this.time.toFixed(1), what: 'refill', tablet: c.purifyLeft > 0 });
    return { ok: true, text: c.purifyLeft > 0 ? `Filled the canteen and dropped in a tablet: safe to drink in ${HYDRATION.purifyTime} s`
      : 'Filled the canteen. Untreated: it could make you ill' };
  }

  update(dt) {
    this.time += dt;
    if (!this.enabled) return;
    const mul = (this.player.sprinting ? HYDRATION.sprintMul : 1) * (this.getWarm() ? HYDRATION.warmMul : 1);
    this.value -= HYDRATION.baseDrain * mul * dt;
    for (const a of this.absorbing) { const g = Math.min(a.left, a.rate * dt); a.left -= g; this.value += g; }
    this.absorbing = this.absorbing.filter((a) => a.left > 1e-6);
    this.value = Math.max(0, Math.min(100, this.value));
    const c = this.canteen;
    if (c.purifyLeft > 0 && (c.purifyLeft -= dt) <= 0) { c.purifyLeft = 0; c.safe = true; this.log.push({ t: +this.time.toFixed(1), what: 'purified' }); }
    // Illness from unsafe water: reported to S08 as an exposure condition (no separate damage).
    const ill = this.illness;
    if (ill) {
      if (ill.incubate > 0) ill.incubate -= dt;
      else { this.health?.exposure('Unsafe water', HYDRATION.illness.rate, dt, true); if ((ill.left -= dt) <= 0) { this.health?.exposure('Unsafe water', 0, dt, false); this.illness = null; } }
    }
    // Critical sustained dehydration: also only through S08 (ordinary expeditions).
    this.criticalFor = this.value < HYDRATION.critical ? this.criticalFor + dt : 0;
    if (this.lethal) this.health?.exposure('Dehydration', HYDRATION.criticalDrain, dt, this.criticalFor > HYDRATION.criticalAfter);
  }

  get ill() { return !!this.illness && this.illness.incubate <= 0; }

  /** Warnings naming the cause (GDD 2.11). */
  warnings() {
    if (!this.enabled) return [];
    const w = [];
    const fix = this.drinkable >= HYDRATION.sip ? ' Drink (I)' : this.hasCanteen ? ' Fill the canteen at a stream (I)' : '';
    if (this.value <= 25) w.push({ id: 'thirst', level: 2, text: `Dehydrated: stamina recovers much slower.${fix}` });
    else if (this.value <= 50) w.push({ id: 'thirst', level: 1, text: `Thirsty: stamina recovers slower.${fix}` });
    if (this.ill) w.push({ id: 'illness', level: 2, text: 'Sick from untreated water: losing health until it passes' });
    if (this.canteen.purifyLeft > 0) w.push({ id: 'purifying', level: 0, text: `Canteen purifying: safe in ${Math.ceil(this.canteen.purifyLeft)} s` });
    return w;
  }
}
