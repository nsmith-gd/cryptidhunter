// Minor terrain injuries (#129, GDD L02 "minor terrain injuries", S08). On maps that opt in
// (map.terrainInjury), running hard over steep ground can turn an ankle: a light, cause-tagged
// injury submitted to S08 Health (the one damage path), never a bleeding wound. You can't sprint on
// rough ground, but trying to (Shift held) while moving over a steep slope is the main risk; plain
// walking is a small one. One injury at most every `cooldown` seconds.
export const TERRAIN_INJURY = {
  steep: 0.35,          // slope (rise over run) above which running is risky
  ratePerSecond: 0.22,  // chance per second at a slope of 2 × steep while hurrying (Shift held)
  walkFactor: 0.15,     // walking carefully: a fraction of that
  damage: 6,
  cooldown: 25,
};

export class TerrainInjury {
  constructor({ player, health, slopeAt, notify = () => {}, rand = Math.random }) {
    this.player = player; this.health = health; this.slopeAt = slopeAt; this.notify = notify; this.rand = rand;
    this.cooldown = 0;
    this.count = 0;
    this.warned = false;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const p = this.player;
    const moving = Math.hypot(p.velocity?.x ?? 0, p.velocity?.z ?? 0) > 1;
    if (!moving || this.cooldown > 0) return null;
    const s = this.slopeAt(p.position.x, p.position.z);
    if (s < TERRAIN_INJURY.steep) return null;
    const hurrying = p.sprinting || !!p.input?.down?.('ShiftLeft', 'ShiftRight');
    if (!this.warned && hurrying) { this.warned = true; this.notify('Steep ground: rushing here could turn an ankle'); }
    const chance = TERRAIN_INJURY.ratePerSecond * (hurrying ? 1 : TERRAIN_INJURY.walkFactor) * Math.min(2, s / TERRAIN_INJURY.steep - 0.5) * dt;
    if (this.rand() >= chance) return null;
    this.cooldown = TERRAIN_INJURY.cooldown;
    const ev = this.health.injure({ cause: 'Rough ground', damage: TERRAIN_INJURY.damage, wound: 'sprain', severity: 'light' });
    if (ev) { this.count++; this.notify(`You turned your ankle on the slope (−${TERRAIN_INJURY.damage} health). Slow down on steep ground.`); }
    return ev;
  }
}
