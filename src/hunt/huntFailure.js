import { PLAYER } from '../player.js';

// Danger & Hunt Failure (L0): when a cryptid touches the player enough times, the hunt ends
// with a "Caught" screen and the player can restart. How many touches depends on the cryptid
// (its `catchHits`, default 1): a big one grabs you on the first touch, a small one you can
// shake off a couple of times.
//
// Threats are supplied by a callback returning [{ name, x, z, y0, y1, radius, catchHits? }]:
// a vertical cylinder from y0 to y1. Systems can also call touched(name, catchHits) directly
// (e.g. a charge that connects), or caught(name) to end the hunt outright.
const HIT_GRACE = 1.5; // seconds after a survivable hit before the same cryptid can count again
export class HuntFailure {
  constructor({ player, getThreats = () => [], onRestart = () => location.reload() }) {
    this.player = player;
    this.getThreats = getThreats;
    this.onRestart = onRestart;
    this.enabled = true;
    this.isCaught = false;
    this.caughtBy = null;
    this.hits = new Map();       // name -> touches so far
    this.graceUntil = new Map(); // name -> time (s) before another touch counts
    this.buildScreen();
    this.buildHitFlash();
  }

  update() {
    if (!this.enabled || this.isCaught) return;
    const p = this.player.position;
    const top = p.y + this.player.height;
    for (const t of this.getThreats()) {
      const reach = t.radius + PLAYER.radius;
      if (Math.hypot(t.x - p.x, t.z - p.z) > reach) continue;
      if (t.y1 < p.y || t.y0 > top) continue;          // flying overhead doesn't count
      this.touched(t.name, t.catchHits ?? 1);
      if (this.isCaught) return;
    }
  }

  /** A cryptid made contact. Ends the hunt once it has touched you `catchHits` times. */
  touched(name = 'Something', catchHits = 1) {
    if (!this.enabled || this.isCaught) return;
    const now = performance.now() / 1000;
    if (now < (this.graceUntil.get(name) ?? 0)) return;
    const n = (this.hits.get(name) ?? 0) + 1;
    this.hits.set(name, n);
    if (n >= catchHits) { this.caught(name); return; }
    this.graceUntil.set(name, now + HIT_GRACE);
    const left = catchHits - n;
    this.showHit(`${name} got hold of you! You shook it off.\n${left} more and you're caught.`);
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

  buildHitFlash() {
    const f = this.hitFlash = document.createElement('div');
    Object.assign(f.style, { position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(160,0,0,0.4)', color: '#fff', font: '20px monospace', textAlign: 'center', whiteSpace: 'pre-line',
      pointerEvents: 'none', opacity: '0', zIndex: '18', textShadow: '0 0 4px #000' });
    document.body.appendChild(f);
  }

  showHit(text) {
    const f = this.hitFlash;
    f.textContent = text;
    f.style.transition = 'none';
    f.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity 1.6s ease-in'; f.style.opacity = '0'; }));
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
