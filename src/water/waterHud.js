// Water HUD (#139): the boat readout while aboard, a prompt beside the boat, and the breath bar,
// which appears only while you're under (GDD 2.3 D04, 13.1: contextual breath underwater). Going
// under also tints the view a murky green-blue. Text and a bar, never colour alone.

export class WaterHud {
  constructor() {
    const el = this.el = document.createElement('div');
    el.id = 'water-hud';
    Object.assign(el.style, { position: 'fixed', left: '50%', bottom: '86px', transform: 'translateX(-50%)', zIndex: 6, pointerEvents: 'none',
      font: '13px/1.45 monospace', color: '#e8eef0', textAlign: 'center', textShadow: '0 1px 2px #000', minWidth: '260px' });
    el.innerHTML = '<div id="water-boat"></div><div id="water-prompt"></div>'
      + '<div id="water-breath" style="display:none;margin-top:6px"><div style="letter-spacing:2px">AIR</div>'
      + '<div style="width:220px;height:10px;border:1px solid #cfe8f0;margin:2px auto;background:#0a1a24"><div id="water-breath-bar" style="height:100%;background:#cfe8f0"></div></div></div>';
    const tint = this.tint = document.createElement('div');
    tint.id = 'underwater-tint';
    Object.assign(tint.style, { position: 'fixed', inset: '0', background: 'radial-gradient(ellipse at center, rgba(20,70,80,0.45), rgba(4,20,28,0.85))', zIndex: 4, pointerEvents: 'none', display: 'none' });
    document.body.append(tint, el);
    this.boatEl = el.querySelector('#water-boat'); this.promptEl = el.querySelector('#water-prompt');
    this.breathEl = el.querySelector('#water-breath'); this.barEl = el.querySelector('#water-breath-bar');
  }

  render({ boat, aquatic, player, nearBoat }) {
    const under = aquatic.showBreath;
    this.breathEl.style.display = under ? 'block' : 'none';
    this.tint.style.display = under ? 'block' : 'none';
    if (under) {
      const b = aquatic.breath / 100;
      this.barEl.style.width = `${Math.round(b * 100)}%`;
      this.barEl.style.background = b < 0.3 ? '#ff8a6a' : '#cfe8f0';
    }
    if (boat.aboard) {
      const heel = Math.min(1, boat.heel ?? boat.tilt), bars = Math.round(heel * 8);
      this.boatEl.innerHTML = `BOAT · engine ${boat.engine ? 'running' : 'off (Space)'} · fuel ${Math.round(boat.tank.fuel * 100)}% · ${Math.abs(boat.speed).toFixed(1)} m/s<br>`
        + `heel <span style="color:${heel > 0.7 ? '#ff8a6a' : '#cfe8f0'}">${'▮'.repeat(bars)}${'▯'.repeat(8 - bars)}</span>${heel > 0.7 ? ' EASE OFF!' : ''}`;
    } else this.boatEl.textContent = '';
    let prompt = '';
    if (boat.capsized && nearBoat) prompt = `Hold E to right the boat${boat.righting > 0 ? ` (${Math.round(boat.righting / 2.5 * 100)}%)` : ''}`;
    else if (nearBoat) prompt = 'E: climb into the boat';
    else if (boat.aboard) prompt = 'E: get out';
    if (aquatic.mode === 'swimming') prompt = (prompt ? `${prompt}  ·  ` : '') + (aquatic.spent ? 'Exhausted: float still to get your strength back' : `SWIMMING · stamina ${Math.round((player.stamina ?? 1) * 100)}% · crouch to dive`);
    if (under) prompt = aquatic.drowning ? 'NO AIR: surface now! (let go of crouch)' : aquatic.slipping > 0 ? 'Slipping under: kick for the surface' : 'Under water: let go of crouch to surface';
    this.promptEl.textContent = prompt;
  }
}
