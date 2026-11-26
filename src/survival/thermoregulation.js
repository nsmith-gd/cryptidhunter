// S02 Thermoregulation (GDD 1.2, 2.2 P03, 2.3 D01, 2.8). Owns core temperature (°C) and
// wetness (0-100). Reads the world (night air, water, heat sources) and the player's activity;
// never writes anyone else's state. Tutorial-forgiving: cold impairs you, it never kills you.
//
//   Wetness: wading soaks you (deep water fast), it dries slowly in the air and quickly by a
//            fire or indoors. Wet clothing insulates far worse.
//   Core temperature drifts toward an equilibrium set by air temperature, insulation, wetness,
//            nearby heat and exertion. 36.5-37.5 comfortable; below 36.5 chilly; below 35.5 cold
//            (stamina recovers slower); it never drops below the tutorial floor.

export const THERMO = {
  target: 37.0,
  comfortLow: 36.5, coldBelow: 35.5, severeBelow: 35.0,
  floor: 34.6,              // tutorial floor: impaired, never lethal (GDD 1.8, 2.8)
  ceiling: 37.6,
  approach: 1 / 90,         // fraction of the gap to equilibrium closed per second (slow body response)
  wetShallow: 9,            // wetness per second wading
  wetDeep: 22,              // per second in deep water
  dryAir: 0.35,             // per second drying in night air
  dryWarm: 4,               // per second by a fire / indoors
  insulation: 1.0,          // everyday jacket (B01): the L01 kit
  heatRadius: 6,            // metres around a heat source that warm you
};

export class Thermoregulation {
  /**
   * airTemp: night air °C for this map. heatSources: () => [{ x, z, r?, name }] (fire, cabin, tent, van).
   * surfaceAt: (x, z, y) => 'dry' | 'shallow' | 'deep'.
   */
  constructor({ player, airTemp = 6, heatSources = () => [], surfaceAt = null, insulation = THERMO.insulation }) {
    this.player = player;
    this.airTemp = airTemp;
    this.heatSources = heatSources;
    this.surfaceAt = surfaceAt;
    this.insulation = insulation;
    this.core = THERMO.target;      // °C
    this.wetness = 0;               // 0..100
    this.nearHeat = null;           // name of the heat source warming you, if any
    this.inWater = 'dry';
  }

  /** 0 when comfortable, rising to 1 at the tutorial floor (other systems read this). */
  get coldDeficit() {
    return Math.max(0, Math.min(1, (THERMO.comfortLow - this.core) / (THERMO.comfortLow - THERMO.floor)));
  }

  get band() {
    const t = this.core;
    if (t < THERMO.severeBelow) return 'very cold';
    if (t < THERMO.coldBelow) return 'cold';
    if (t < THERMO.comfortLow) return 'chilly';
    return 'comfortable';
  }

  update(dt) {
    const p = this.player.position;
    this.inWater = this.surfaceAt?.(p.x, p.z, p.y) ?? 'dry';
    let heat = null;
    for (const h of this.heatSources()) {
      if (Math.hypot(p.x - h.x, p.z - h.z) < (h.r ?? THERMO.heatRadius)) { heat = h; break; }
    }
    this.nearHeat = heat?.name ?? null;

    // Wetness.
    if (this.inWater === 'deep') this.wetness += THERMO.wetDeep * dt;
    else if (this.inWater === 'shallow') this.wetness += THERMO.wetShallow * dt;
    else this.wetness -= (heat ? THERMO.dryWarm : THERMO.dryAir) * dt;
    this.wetness = Math.max(0, Math.min(100, this.wetness));

    // Equilibrium temperature: cold air pulls you down, insulation (worse when wet) holds it,
    // water and heat sources dominate, exertion warms you a little.
    const wetInsul = this.insulation * (1 - 0.6 * this.wetness / 100);
    const airPull = Math.max(0, 18 - this.airTemp) / 18;            // 0 on a mild night, ~0.7 at 6 °C
    let eq = THERMO.target - 0.6 * airPull / Math.max(0.25, wetInsul);   // dry on a cold night: ~36.6, still comfortable
    if (this.inWater !== 'dry') eq -= this.inWater === 'deep' ? 1.6 : 0.8;
    if (this.player.sprinting) eq += 0.4;
    if (heat) eq = Math.max(eq, THERMO.target + 0.2);
    eq = Math.max(THERMO.floor, Math.min(THERMO.ceiling, eq));
    this.core += (eq - this.core) * Math.min(1, THERMO.approach * (heat ? 3 : 1) * dt);
    this.core = Math.max(THERMO.floor, Math.min(THERMO.ceiling, this.core));
    this.equilibrium = eq;
  }

  /** Warnings that name their cause (GDD 2.11). */
  warnings() {
    const w = [];
    if (this.wetness >= 30 && !this.nearHeat) w.push({ id: 'wet', level: this.wetness >= 70 ? 2 : 1, text: 'Wet clothing: losing heat faster' });
    if (this.core < THERMO.coldBelow) w.push({ id: 'cold', level: this.core < THERMO.severeBelow ? 2 : 1,
      text: `${this.core < THERMO.severeBelow ? 'Very cold' : 'Cold'}: shivering, stamina recovers slower. Get dry and find a fire` });
    else if (this.core < THERMO.comfortLow) w.push({ id: 'chilly', level: 0, text: 'Chilly: keep moving or find warmth' });
    if (this.inWater !== 'dry') w.push({ id: 'water', level: 1, text: this.inWater === 'deep' ? 'Deep water: soaking through' : 'Wading: your boots and legs are soaking' });
    return w;
  }
}
