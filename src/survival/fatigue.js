// S09 Sleep & fatigue (GDD 1.2, 2.2 P06, 2.8; task #104). Owns fatigue: sleep debt, 0-100, low is
// good. It builds with time awake and faster with sustained exertion; only sleep at a valid camp
// brings it down (short rests can't replace sleep). It never writes anyone else's state: the player
// reads `penalty` to cap stamina capacity (GDD 2.8: base × max(0.50, 1 − fatigue − injury)).
//   below 40 comfortable · 40–70 tired (strained) · above 70 exhausted (impaired)

export const FATIGUE = {
  start: 30,              // you arrive after a working day
  awake: 0.05,            // per second awake (~3 per minute)
  exertion: 0.25,         // extra per second while sprinting
  load: 0.04,             // extra per second per unit of load ratio while moving
  sleep: 1.0,             // per second of good sleep (quality 1); poorer sleep recovers less
  strained: 40, impaired: 70,
  maxPenalty: 0.5,        // at 100 fatigue the stamina cap reaches the 0.50 floor
};

export class Fatigue {
  constructor({ player, start = FATIGUE.start } = {}) {
    this.player = player;
    this.value = start;
    this.asleep = false;
    this.quality = 0;       // 0..1 sleep quality while asleep (set by the field camp)
  }

  get band() { return this.value > FATIGUE.impaired ? 'exhausted' : this.value >= FATIGUE.strained ? 'tired' : 'rested'; }

  /** Stamina-capacity penalty (0 .. 0.5): nothing while comfortable, rising past the strained line. */
  get penalty() { return Math.max(0, Math.min(1, (this.value - FATIGUE.strained) / (100 - FATIGUE.strained))) * FATIGUE.maxPenalty; }

  update(dt) {
    if (this.asleep) {
      this.value -= FATIGUE.sleep * this.quality * dt;
    } else {
      const p = this.player;
      const moving = Math.hypot(p?.velocity?.x ?? 0, p?.velocity?.z ?? 0) > 0.3;
      this.value += (FATIGUE.awake + (p?.sprinting ? FATIGUE.exertion : 0) + (moving ? FATIGUE.load * Math.max(0, (p.loadFactor ?? 1) - 1) * 10 : 0)) * dt;
    }
    this.value = Math.max(0, Math.min(100, this.value));
  }

  warnings() {
    if (this.value > FATIGUE.impaired) return [{ id: 'fatigue', level: 2, text: 'Exhausted: drowsy, stamina capped. Sleep in a tent at camp' }];
    if (this.value >= FATIGUE.strained) return [{ id: 'fatigue', level: 1, text: 'Tired: stamina capped lower. Sleep in a tent at camp' }];
    return [];
  }
}
