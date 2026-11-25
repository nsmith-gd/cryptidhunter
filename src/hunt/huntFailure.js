import { PLAYER } from '../player.js';

// Danger & Hunt Failure (L0): if any cryptid body touches the player, the hunt ends
// with a "Caught" screen and the player can restart.
//
// Threats are supplied by a callback returning [{ name, x, z, y0, y1, radius }]:
// a vertical cylinder from y0 to y1. Systems can also call caught(name) directly
// (e.g. a charge that connects).
export class HuntFailure {
  constructor({ player, getThreats = () => [], onRestart = () => location.reload() }) {
    this.player = player;
    this.getThreats = getThreats;
    this.onRestart = onRestart;
    this.enabled = true;
    this.isCaught = false;
    this.caughtBy = null;
    this.buildScreen();
  }

  update() {
    if (!this.enabled || this.isCaught) return;
    const p = this.player.position;
    const top = p.y + this.player.height;
    for (const t of this.getThreats()) {
      const reach = t.radius + PLAYER.radius;
      if (Math.hypot(t.x - p.x, t.z - p.z) > reach) continue;
      if (t.y1 < p.y || t.y0 > top) continue;          // flying overhead doesn't count
      this.caught(t.name);
      return;
    }
  }

  caught(name = 'Something') {
    if (!this.enabled || this.isCaught) return;
    this.isCaught = true;
    this.caughtBy = name;
    this.reason.textContent = `${name} got you. The hunt is over, and any unsaved evidence is lost.`;
    this.screen.style.display = 'flex';
    document.exitPointerLock?.();
    // Short delay so a held key or the click that was in flight doesn't skip the screen.
    this.readyAt = performance.now() + 600;
  }

  restart() {
    if (!this.isCaught || performance.now() < this.readyAt) return;
    this.onRestart();
  }

  buildScreen() {
    const s = this.screen = document.createElement('div');
    Object.assign(s.style, {
      position: 'fixed', inset: '0', display: 'none', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '14px', background: 'rgba(40,0,0,0.82)', color: '#eee',
      fontFamily: 'monospace', textAlign: 'center', zIndex: '20', cursor: 'pointer',
    });
    const title = Object.assign(document.createElement('div'), { textContent: 'CAUGHT' });
    Object.assign(title.style, { fontSize: '56px', letterSpacing: '8px', color: '#ff5a4a' });
    this.reason = document.createElement('div');
    this.reason.style.fontSize = '16px';
    const hint = Object.assign(document.createElement('div'), { textContent: 'Click or press Space to start a new hunt' });
    Object.assign(hint.style, { fontSize: '13px', color: '#bbb' });
    s.append(title, this.reason, hint);
    document.body.appendChild(s);
    s.addEventListener('click', () => this.restart());
    addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') this.restart(); });
  }
}
