// S01 Nutrition (GDD 1.2, 2.2 P02, 2.8). Owns the energy reserve (0-100) and the food you carry.
// Metabolism drains it slowly, exertion and cold faster (it reads thermoregulation's snapshot;
// it never writes it). Eating absorbs over a short interval. Tutorial-forgiving: hunger is a
// modest efficiency penalty (slower stamina recovery), never starvation (GDD 1.8, 2.2).

export const NUTRITION = {
  start: 85,
  baseDrain: 100 / (30 * 60),   // a full reserve lasts ~30 min of quiet walking
  sprintMul: 2.5,               // exertion burns faster
  coldMul: 1.6,                 // at full cold deficit, metabolism is this much faster
  floor: 8,                     // tutorial floor: weak, never starving to death
  absorbTime: 8,                // seconds for a meal to be absorbed
  foods: {
    packedLunch: { name: 'Packed lunch', energy: 40 },   // A01 (L01 starter kit)
    trailSnack: { name: 'Trail snack', energy: 15 },     // A02
  },
};

export class Nutrition {
  /** food: { packedLunch: n, trailSnack: n } carried. getCold: () => 0..1 cold deficit from S02. */
  constructor({ player, food = { packedLunch: 1, trailSnack: 2 }, getCold = () => 0, start = NUTRITION.start }) {
    this.player = player;
    this.food = { ...food };
    this.getCold = getCold;
    this.energy = start;
    this.digesting = [];          // [{ left, rate }]
    this.lastAte = null;
  }

  get band() {
    const e = this.energy;
    if (e > 50) return 'fed';
    if (e > 25) return 'hungry';
    return 'very hungry';
  }

  /** 0 when fed (>50), rising to 1 at the floor (stamina recovery reads this). */
  get hungerDeficit() { return Math.max(0, Math.min(1, (50 - this.energy) / (50 - NUTRITION.floor))); }

  /** Eat the best food for the moment (biggest meal when hungry, a snack otherwise). */
  eat(kind = null) {
    const order = kind ? [kind] : (this.energy < 60 ? ['packedLunch', 'trailSnack'] : ['trailSnack', 'packedLunch']);
    const k = order.find((f) => (this.food[f] ?? 0) > 0);
    if (!k) return null;
    this.food[k]--;
    const e = NUTRITION.foods[k].energy;
    this.digesting.push({ left: e, rate: e / NUTRITION.absorbTime });
    this.lastAte = k;
    return { kind: k, name: NUTRITION.foods[k].name, energy: e };
  }

  get foodLeft() { return Object.values(this.food).reduce((a, b) => a + b, 0); }

  update(dt) {
    const mul = (this.player.sprinting ? NUTRITION.sprintMul : 1) * (1 + (NUTRITION.coldMul - 1) * this.getCold());
    this.energy -= NUTRITION.baseDrain * mul * dt;
    for (const d of this.digesting) { const a = Math.min(d.left, d.rate * dt); d.left -= a; this.energy += a; }
    this.digesting = this.digesting.filter((d) => d.left > 1e-6);
    this.energy = Math.max(NUTRITION.floor, Math.min(100, this.energy));
  }

  warnings() {
    const w = [];
    if (this.energy <= 25) w.push({ id: 'hunger', level: 2, text: `Very hungry: stamina recovers much slower${this.foodLeft ? '. Eat something (Z)' : ''}` });
    else if (this.energy <= 50) w.push({ id: 'hunger', level: 1, text: `Hungry: stamina recovers slower${this.foodLeft ? '. Eat something (Z)' : ''}` });
    return w;
  }
}
