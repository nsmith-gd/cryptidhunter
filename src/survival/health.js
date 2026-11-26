// S08 Injury & medical (GDD 1.2, 2.2 P01, 2.3 D02, 2.8, 9.1, 14.1). The ONLY damage path:
// other systems submit cause-tagged injury events; this system owns health (0-100) and the list
// of conditions, applies each event once per cause within a grace window, and is the one place
// health ever changes. Health 0 is the terminal state.
//
//   Bruise:          the hit itself; no ongoing loss.
//   Bleeding wound:  keeps draining health until you bandage it (B, uses a first-aid kit).
//                    Bandaging stops the bleeding (stabilised) and restores a little health.

export const HEALTH = {
  max: 100,
  grace: 2.0,               // seconds before the same cause can injure you again
  bleedRate: { light: 0.5, heavy: 1.5 },   // health per second until bandaged
  bandageHeal: 10,          // a dressing also restores a little health
  bandageTime: 1.5,         // seconds of fumbling with the kit before it takes effect
  firstAidUses: 3,          // D01 First-aid kit x3 (GDD 3.2)
};

export class Health {
  constructor({ firstAid = HEALTH.firstAidUses, onDeath = () => {} } = {}) {
    this.value = HEALTH.max;
    this.conditions = [];          // { id, kind: 'bruise'|'bleeding'|'dressed', severity, cause, at }
    this.firstAid = firstAid;
    this.onDeath = onDeath;
    this.time = 0;
    this.graceUntil = new Map();   // cause -> sim time
    this.log = [];                 // every applied event { t, cause, damage, wound, healthAfter }
    this.bandaging = null;         // { left } while a dressing is being applied
    this.nextId = 1;
    this.dead = false;
  }

  get bleeding() { return this.conditions.filter((c) => c.kind === 'bleeding'); }

  /**
   * Submit an injury event. Returns the applied event, or null if it was absorbed by the grace
   * window for that cause (so one contact never deals damage twice).
   */
  injure({ cause, damage, wound = 'bruise', severity = 'light' }) {
    if (this.dead) return null;
    if (this.time < (this.graceUntil.get(cause) ?? -Infinity)) return null;
    this.graceUntil.set(cause, this.time + HEALTH.grace);
    this.value = Math.max(0, this.value - damage);
    this.conditions.push({ id: this.nextId++, kind: wound, severity, cause, at: this.time });
    const ev = { t: +this.time.toFixed(3), cause, damage, wound, severity, healthAfter: +this.value.toFixed(2) };
    this.log.push(ev);
    if (this.value <= 0) this.die(cause);
    return ev;
  }

  /** Start bandaging the worst bleeding wound (uses one first-aid kit). Returns false if not possible. */
  bandage() {
    if (this.dead || this.bandaging || this.firstAid <= 0 || !this.bleeding.length) return false;
    this.firstAid--;
    this.bandaging = { left: HEALTH.bandageTime };
    return true;
  }

  update(dt) {
    this.time += dt;
    if (this.dead) return;
    for (const c of this.bleeding) this.value -= HEALTH.bleedRate[c.severity] * dt;
    if (this.bandaging && (this.bandaging.left -= dt) <= 0) {
      this.bandaging = null;
      const worst = this.bleeding.sort((a, b) => HEALTH.bleedRate[b.severity] - HEALTH.bleedRate[a.severity])[0];
      if (worst) { worst.kind = 'dressed'; this.value = Math.min(HEALTH.max, this.value + HEALTH.bandageHeal); }
    }
    if (this.value <= 0) { this.value = 0; this.die(this.bleeding[0]?.cause ?? 'Your wounds'); }
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.value = 0;
    this.onDeath(cause);
  }

  get band() {
    const v = this.value;
    if (v > 70) return 'ok';
    if (v > 40) return 'hurt';
    if (v > 15) return 'badly hurt';
    return 'critical';
  }

  /** Warnings naming the cause (GDD 2.11). */
  warnings() {
    const w = [];
    const b = this.bleeding;
    if (b.length) {
      const heavy = b.some((c) => c.severity === 'heavy');
      w.push({ id: 'bleeding', level: 2, text: `${heavy ? 'Heavy bleeding' : 'Bleeding wound'} (${b[0].cause}): losing health. ${this.firstAid ? 'Bandage it (B)' : 'No first-aid left: get back to the van'}` });
    }
    if (this.bandaging) w.push({ id: 'bandaging', level: 0, text: 'Bandaging the wound…' });
    if (this.value <= 15 && !this.dead) w.push({ id: 'critical', level: 2, text: 'Critically hurt: one more hit could end the hunt' });
    return w;
  }
}
