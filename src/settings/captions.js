// Captions for sounds (#76, GDD 13.1/13.3): every meaningful sound gets a caption with a visual
// direction cue (an arrow around a ring, relative to where you're looking) and a rough distance,
// without naming an unknown source for you. Off in settings hides them all, including the knock
// captions the knock system shows itself.

export class Captions {
  constructor({ player }) {
    this.player = player;
    this.enabled = true;
    this.log = [];                  // { text, bearing, at }
    const css = document.createElement('style');
    css.textContent = `
#captions { position: fixed; left: 50%; bottom: 128px; transform: translateX(-50%); display: flex; flex-direction: column;
  align-items: center; gap: 4px; pointer-events: none; z-index: 6; }
#captions .cap { display: flex; align-items: center; gap: 8px; padding: 3px 10px; background: #000b; color: #f1e6c8;
  font: 13px monospace; border: 1px solid #665; transition: opacity .5s; }
#captions .dir { position: relative; width: 18px; height: 18px; border: 1px solid #998; border-radius: 50%; }
#captions .dir i { position: absolute; left: 50%; top: 50%; width: 0; height: 0; margin: -9px 0 0 -4px;
  border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 8px solid #ffd88a; transform-origin: 4px 9px; }`;
    document.head.append(css);
    this.el = Object.assign(document.createElement('div'), { id: 'captions' });
    document.body.append(this.el);
  }

  /** Where a sound at (x, z) is, relative to the view: bearing (rad, 0 = ahead, + = right) and words. */
  locate(x, z) {
    const p = this.player.position;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    const world = Math.atan2(dx, -dz);                        // 0 = north
    const heading = -this.player.yaw;                         // player yaw 0 looks north; right = -yaw
    let b = world - heading; b = Math.atan2(Math.sin(b), Math.cos(b));
    const side = Math.abs(b) < 0.5 ? 'ahead' : Math.abs(b) > 2.6 ? 'behind you' : b > 0 ? 'to your right' : 'to your left';
    const far = d < 15 ? 'close' : d < 50 ? 'nearby' : 'far off';
    return { bearing: b, words: `${far}, ${side}`, distance: d };
  }

  /** Show a caption. at: { x, z } to add a direction cue and distance words. */
  say(text, at = null, seconds = 4) {
    const where = at ? this.locate(at.x, at.z) : null;
    this.log.push({ text, bearing: where?.bearing ?? null, at: performance.now() });
    if (this.log.length > 40) this.log.shift();
    if (!this.enabled) return null;
    const row = document.createElement('div');
    row.className = 'cap';
    row.innerHTML = (where ? `<span class="dir"><i style="transform: rotate(${where.bearing.toFixed(3)}rad)"></i></span>` : '') +
      `<span>[${text}${where ? ` — ${where.words}` : ''}]</span>`;
    this.el.append(row);
    while (this.el.children.length > 3) this.el.firstChild.remove();
    setTimeout(() => { row.style.opacity = '0'; setTimeout(() => row.remove(), 600); }, seconds * 1000);
    return row;
  }
}
