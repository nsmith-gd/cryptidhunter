// Minor terrain injuries (#129, GDD L02 "minor terrain injuries", S08). On maps that opt in
// (map.terrainInjury), running hard over steep ground can turn an ankle: a light, cause-tagged
// injury submitted to S08 Health (the one damage path), never a bleeding wound. Walking is safe;
// sprinting down or across a steep slope is the risk. One injury at most every `cooldown` seconds.
export const TERRAIN_INJURY = {
  steep: 0.35,          // slope (rise over run) above which running is risky
  ratePerSecond: 0.22,  // chance per second at a slope of 2 × steep while sprinting
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
    if (!p.sprinting || this.cooldown > 0) return null;
    const s = this.slopeAt(p.position.x, p.position.z);
    if (s < TERRAIN_INJURY.steep) return null;
    if (!this.warned) { this.warned = true; this.notify('Steep ground: running here could turn an ankle'); }
    const chance = TERRAIN_INJURY.ratePerSecond * Math.min(2, s / TERRAIN_INJURY.steep - 0.5) * dt;
    if (this.rand() >= chance) return null;
    this.cooldown = TERRAIN_INJURY.cooldown;
    const ev = this.health.injure({ cause: 'Rough ground', damage: TERRAIN_INJURY.damage, wound: 'sprain', severity: 'light' });
    if (ev) { this.count++; this.notify(`You turned your ankle on the slope (−${TERRAIN_INJURY.damage} health). Slow down on steep ground.`); }
    return ev;
  }
}
