// S13 Aquatic traversal (GDD 1.2 S13, 2.3 D04, 13.1; task #139). Owns the player's traversal state in
// water and the breath reserve. Reads the surface under the player, whether they're aboard a boat,
// their dive intent (crouch while swimming) and stamina; writes only its own state. Harm goes through
// health (S08, `health.exposure('Drowning', ...)`); wetness and cold stay thermoregulation's (it reads
// `submerged` from here so going under soaks you through and chills you faster).
//
//   dry       on land (or the dock)
//   wading    shallow water: slow, soaking your legs
//   swimming  deep water at the surface: tiring (stamina), soaking, cold; no breath meter
//   under     submerged: hold your breath (D04, 0-100). Surfacing refills it. Out of breath:
//             drowning damage through health until you surface.
//   aboard    in a boat: dry, the boat moves you
//
// You go under by diving (hold crouch while swimming) or, without a flotation device, when you're
// exhausted: you slip under and kick back up a few seconds later, gasping. A PFD keeps your head up
// (it does nothing for the cold). Breath exists only while submerged: no oxygen meter on land.

export const AQUA = {
  breathMax: 100,
  breathDrain: 100 / 25,      // a calm breath-hold of ~25 s
  breathDrainExhausted: 100 / 10,   // slipping under spent: ~10 s
  breathRefill: 50,           // per second at the surface (two gasps and you're back)
  drownDamage: 6,             // health per second with no breath left
  // In deep water this owns stamina (the controller's normal regen doesn't apply while you swim):
  treadStamina: 0.01,         // per second treading water in place
  strokeStamina: 0.032,       // per second while swimming somewhere (a full bar is ~30 m of swimming)
  floatRecover: 0.05,         // per second back while spent and floating still at the surface
  slipUnder: 3,               // seconds under when you slip under exhausted, before you kick back up
  eye: { swimming: 0.3, under: -0.45, aboard: 0.75 },   // eye height over your feet in each mode (land: the controller's own)
  surfaceRecover: 0.25,       // stamina you need back before you stop slipping under
};

export class Aquatic {
  /**
   * surfaceAt(x, z, y) -> 'dry' | 'shallow' | 'deep'. health: { exposure(cause, rate, dt, active) }.
   * isAboard() -> bool. hasPfd() -> bool. trace(type, data) and notify(text) are optional.
   */
  constructor({ player, surfaceAt, health, isAboard = () => false, hasPfd = () => false, trace = () => {}, notify = () => {} }) {
    Object.assign(this, { player, surfaceAt, health, isAboard, hasPfd, trace, notify });
    this.mode = 'dry';
    this.breath = AQUA.breathMax;
    this.slipping = 0;          // seconds left of an exhausted slip under
    this.spent = false;         // ran out of stamina in deep water (until surfaceRecover is back)
    this.drowning = false;
    this.timeIn = 0;            // seconds in deep water this time
    this.log = [];              // { mode } transitions, for tests and the gym trace
  }

  get submerged() { return this.mode === 'under'; }
  /** The HUD shows breath only while you're under (GDD 13.1: contextual breath underwater). */
  get showBreath() { return this.mode === 'under'; }
  get inDeep() { return this.mode === 'swimming' || this.mode === 'under'; }

  /** Speed multiplier for the player controller in each mode. */
  speedFactor() { return { dry: 1, wading: 0.6, swimming: 0.4, under: 0.3, aboard: 0 }[this.mode] ?? 1; }

  set(mode, why) {
    this.player.eyeOverride = AQUA.eye[mode] ?? null;   // your eyes at the waterline swimming, below it under, seated in the boat
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    this.log.push({ from, to: mode, why });
    this.trace('mode', { from, to: mode, why, breath: Math.round(this.breath) });
    if (mode === 'swimming' && from !== 'under') this.notify(this.hasPfd() ? 'Deep water. Your flotation vest holds your head up; get out before the cold does.' : 'Deep water: you\'re swimming. It\'s cold and tiring; make for the shore.');
    if (mode === 'under' && why === 'exhausted') this.notify('Too tired to stay up: you slip under.');
    if (from === 'under' && mode === 'swimming') this.notify(this.breath < 30 ? 'You break the surface, gasping.' : 'You surface.');
  }

  update(dt) {
    const p = this.player.position;
    if (this.isAboard()) { this.set('aboard', 'boat'); this.refill(dt); this.drown(dt, false); this.timeIn = 0; this.slipping = 0; this.spent = false; this.lastStamina = null; return; }
    const surface = this.surfaceAt?.(p.x, p.z, p.y) ?? 'dry';
    if (surface !== 'deep') {
      this.set(surface === 'shallow' ? 'wading' : 'dry', 'surface');
      this.slipping = 0; this.spent = false; this.timeIn = 0; this.lastStamina = null;
      this.refill(dt); this.drown(dt, false);
      return;
    }
    this.timeIn += dt;
    // Deep water. Swimming costs stamina; running out (no PFD) slips you under for a few seconds.
    const pl = this.player, moving = Math.hypot(pl.velocity?.x ?? 0, pl.velocity?.z ?? 0) > 0.2;
    if (pl.stamina != null) {
      const before = Math.min(pl.stamina, this.lastStamina ?? pl.stamina);   // undo the controller's land regen
      let st = before;
      if (this.mode !== 'under') st = this.spent && !moving ? st + AQUA.floatRecover * dt : st - (moving ? AQUA.strokeStamina : AQUA.treadStamina) * dt;
      pl.stamina = Math.max(0, Math.min(1, st));
      if (pl.stamina <= 0) this.spent = true;
    }
    if (this.spent && pl.stamina >= AQUA.surfaceRecover) this.spent = false;
    const pfd = this.hasPfd();
    if (this.slipping > 0) this.slipping = Math.max(0, this.slipping - dt);
    else if (this.spent && !pfd && this.mode !== 'under') this.slipping = AQUA.slipUnder;
    const dive = !!pl.crouching && !this.spent;
    const under = this.slipping > 0 || dive;
    this.set(under ? 'under' : 'swimming', this.slipping > 0 ? 'exhausted' : dive ? 'dive' : 'surface');
    if (under) this.breath = Math.max(0, this.breath - (this.slipping > 0 ? AQUA.breathDrainExhausted : AQUA.breathDrain) * dt);
    else this.refill(dt);
    this.drown(dt, under && this.breath <= 0);
    this.lastStamina = pl.stamina;
  }

  refill(dt) { this.breath = Math.min(AQUA.breathMax, this.breath + AQUA.breathRefill * dt); if (AQUA.breathMax - this.breath < 1e-6) this.breath = AQUA.breathMax; }

  drown(dt, active) {
    if (active !== this.drowning) {
      this.drowning = active;
      this.trace(active ? 'drowning' : 'breathing', { breath: Math.round(this.breath) });
      if (active) this.notify('No air left: you\'re drowning. Surface now (let go of crouch).');
    }
    this.health?.exposure('Drowning', AQUA.drownDamage, dt, active);
  }
}
