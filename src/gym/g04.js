import { G04 } from '../maps/gymScenes.js';

// G04 extras (#141, GDD 15.2 G04 "recover evidence versus abandon expensive gear"; "measure withdrawal
// decision and gear loss"). A trail camera case (with its footage) lies inside the defended core.
// 5 picks it up when you're beside it. At the extraction point the gym records what you did: brought
// it out (recovered), or left it behind (abandoned: its value is the gear loss).

export class G04World {
  constructor({ game, map, trace, notify = () => {} }) {
    this.g = game; this.trace = trace; this.notify = notify;
    this.cache = { ...G04.cache, state: 'left' };   // left | carried | recovered | abandoned
    this.mesh = map.cacheMesh ?? null;
    this.withdrawal = null;                         // { decision, gearLost, at } once you extract
  }

  /** Pick up the case (within 1.8 m). */
  grab() {
    const p = this.g.player.position, c = this.cache;
    if (c.state !== 'left' || Math.hypot(p.x - c.x, p.z - c.z) > 1.8) return false;
    c.state = 'carried';
    if (this.mesh) this.mesh.visible = false;
    this.trace('gear', 'recovered-case', { value: c.value, fromHome: +Math.hypot(c.x - G04.home.x, c.z - G04.home.z).toFixed(1) });
    this.notify(`Got the ${c.name} and its footage. Now get out of its ground.`);
    return true;
  }

  /** At the extraction point: record the withdrawal decision and the gear loss. */
  extract() {
    const c = this.cache, recovered = c.state === 'carried';
    c.state = recovered ? 'recovered' : 'abandoned';
    this.withdrawal = { decision: recovered ? 'recovered the gear' : 'abandoned the gear', gearLost: recovered ? 0 : c.value, health: +this.g.survival.health.value.toFixed(1) };
    this.trace('gear', 'withdrawal', this.withdrawal);
    return this.withdrawal;
  }
}
