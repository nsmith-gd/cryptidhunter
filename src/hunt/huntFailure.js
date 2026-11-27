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
  constructor({ player, getThreats = () => [], onRestart = () => location.reload(), health = null }) {
    this.player = player;
    this.health = health;        // S08 (#72): when set, a contact is an injury event, and only health 0 ends the hunt
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

  update(dt = 1 / 60) {
    this.time = (this.time ?? 0) + dt;
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
    if (this.health) return this.injured(name, contactInjury(catchHits));
    const now = this.time ?? 0;              // simulation seconds (#66: no wall clock in the sim)
    if (now < (this.graceUntil.get(name) ?? 0)) return;
    const n = (this.hits.get(name) ?? 0) + 1;
    this.hits.set(name, n);
    if (n >= catchHits) { this.caught(name); return; }
    this.graceUntil.set(name, now + HIT_GRACE);
    const left = catchHits - n;
    this.showHit(`${name} got hold of you! You shook it off.\n${left} more and you're caught.`);
  }

  /** A contact through the health system: wound you, and end the hunt only if health hits 0. */
  injured(name, injury) {
    const ev = this.health.injure({ cause: name, ...injury });
    if (!ev || this.health.dead) return ev;   // absorbed by the grace window, or it killed you (onDeath -> caught)
    const wound = ev.wound === 'bleeding' ? `${ev.severity === 'heavy' ? 'Heavy bleeding' : 'Bleeding wound'}: bandage it (B)` : 'Bruised';
    this.showHit(`${name} struck you! −${ev.damage} health\n${wound}`);
    return ev;
  }

  caught(name = 'Something') {
    if (!this.enabled || this.isCaught) return;
    this.isCaught = true;
    this.caughtBy = name;
    // Name the way you died (GDD 9.1: creature, an untreated wound, critical cold all end it the same way).
    const cold = name === 'Hypothermia', bled = name === 'Your wounds';
    if (this.title) this.title.textContent = cold ? 'FROZEN' : bled ? 'BLED OUT' : 'CAUGHT';
    this.reason.textContent = cold ? 'You collapsed from the cold: hypothermia. You didn\'t make it out, and the hunt is over.'
      : this.health ? `${bled ? `You bled out${this.health.woundCause ? ` from the wound ${this.health.woundCause} gave you` : ''}` : `${name} got you`}. You didn't make it out, and the hunt is over.`
      : `${name} got you. The hunt is over, and any unsaved evidence is lost.`;
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
      justifyContent: 'safe center', overflowY: 'auto', gap: '14px', background: 'rgba(40,0,0,0.82)', color: '#eee',
      fontFamily: 'monospace', textAlign: 'center', zIndex: '20', cursor: 'pointer',
    });
    const title = Object.assign(document.createElement('div'), { textContent: 'CAUGHT' });
    this.title = title;
    Object.assign(title.style, { fontSize: '56px', letterSpacing: '8px', color: '#ff5a4a' });
    this.reason = document.createElement('div');
    // Keep the line breaks: the death report lists what was lost and what you keep (#89).
    Object.assign(this.reason.style, { fontSize: '15px', whiteSpace: 'pre-line', maxWidth: '760px', lineHeight: '1.5' });
    const hint = Object.assign(document.createElement('div'), { textContent: 'Click or press Space to start a new hunt' });
    Object.assign(hint.style, { fontSize: '13px', color: '#bbb' });
    s.append(title, this.reason, hint);
    document.body.appendChild(s);
    s.addEventListener('click', () => this.restart());
    addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') this.restart(); });
  }
}

/**
 * The injury a cryptid's contact deals, from how tough it is (its catchHits): something that
 * used to take you in one grab now leaves you badly hurt and bleeding heavily; smaller ones wound
 * lightly. Two big hits, or untreated bleeding, still end the hunt.
 */
export function contactInjury(catchHits = 1) {
  if (catchHits <= 1) return { damage: 60, wound: 'bleeding', severity: 'heavy' };
  if (catchHits === 2) return { damage: 40, wound: 'bleeding', severity: 'light' };
  return { damage: 30, wound: 'bleeding', severity: 'light' };
}
