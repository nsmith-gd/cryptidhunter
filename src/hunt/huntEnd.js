import * as THREE from 'three';

// Post-hunt money screen (L0). Press H to head back to camp: the hunt ends, the best photo
// score is turned into money, banked in the wallet and shown with a "Hunt again" button.
//
// Photo scores come in through recordPhoto(score, subject) (0..100), or a window event
// `cryptid-photo` with detail { score, subject }, which the camera system can fire.
// Until the camera exists, a stand-in "sighting" score is tracked: how well you've seen a
// cryptid with your own eyes (closer and nearer the centre of your view = higher).
export const PAYOUT = {
  perPoint: 5,           // $ per point of the best photo score (100 pts = $500)
  sightingRange: 40,     // metres; a cryptid further than this scores nothing
  sightingCone: THREE.MathUtils.degToRad(30), // half-angle of "looking at it"
};

const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();

export class HuntEnd {
  constructor({ camera, wallet, getSubjects = () => [], canEnd = () => true, onHuntAgain = () => location.reload() }) {
    this.canEnd = canEnd;
    this.camera = camera;
    this.wallet = wallet;
    this.getSubjects = getSubjects;   // () => [{ name, x, y, z }] things worth photographing
    this.onHuntAgain = onHuntAgain;
    this.bestPhoto = null;            // { score, subject } from the camera
    this.bestSighting = null;         // stand-in when no photo was taken
    this.isOver = false;
    this.earned = 0;
    this.buildScreen();
    addEventListener('cryptid-photo', (e) => this.recordPhoto(e.detail?.score, e.detail?.subject));
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && !e.repeat && !this.isOver && this.canEnd()) this.end();
      else if (this.isOver && (e.code === 'Enter' || e.code === 'Space') && performance.now() > this.readyAt) this.onHuntAgain();
    });
  }

  recordPhoto(score, subject = 'Unknown') {
    if (!Number.isFinite(score) || this.isOver) return;
    score = THREE.MathUtils.clamp(Math.round(score), 0, 100);
    if (!this.bestPhoto || score > this.bestPhoto.score) this.bestPhoto = { score, subject };
  }

  /** The score that gets paid: best photo, or the sighting stand-in if no photo was taken. */
  get best() { return this.bestPhoto ?? this.bestSighting ?? { score: 0, subject: null }; }

  // Track the best sighting so far (only matters until photos exist).
  update() {
    if (this.isOver) return;
    this.camera.getWorldDirection(_fwd);
    const cam = this.camera.position;
    for (const s of this.getSubjects()) {
      _to.set(s.x - cam.x, s.y - cam.y, s.z - cam.z);
      const d = _to.length();
      if (d > PAYOUT.sightingRange || d < 0.01) continue;
      const angle = _fwd.angleTo(_to.divideScalar(d));
      if (angle > PAYOUT.sightingCone) continue;
      const score = Math.round(100 * (1 - d / PAYOUT.sightingRange) * (1 - 0.5 * angle / PAYOUT.sightingCone));
      if (!this.bestSighting || score > this.bestSighting.score) this.bestSighting = { score, subject: s.name };
    }
  }

  end() {
    if (this.isOver) return;
    this.isOver = true;
    const best = this.best;
    this.earned = best.score * PAYOUT.perPoint;
    this.wallet.deposit(this.earned);
    const kind = this.bestPhoto ? 'Best photo' : 'Best sighting (no photos taken)';
    this.title.textContent = `HUNT #${this.wallet.hunts} OVER`;
    this.scoreLine.textContent = best.subject ? `${kind}: ${best.subject}, ${best.score} / 100` : 'No evidence brought back.';
    this.earnedLine.textContent = `Earned  $${this.earned}`;
    this.totalLine.textContent = `Total   $${this.wallet.money}`;
    this.screen.style.display = 'flex';
    document.exitPointerLock?.();
    this.readyAt = performance.now() + 600;
  }

  buildScreen() {
    const s = this.screen = document.createElement('div');
    s.id = 'hunt-end';
    Object.assign(s.style, {
      position: 'fixed', inset: '0', display: 'none', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '12px', background: 'rgba(8,14,10,0.9)', color: '#e8e2d0',
      fontFamily: 'monospace', textAlign: 'center', zIndex: '20',
    });
    const line = (size, color = '#e8e2d0') => {
      const d = document.createElement('div');
      Object.assign(d.style, { fontSize: size, color, whiteSpace: 'pre' });
      s.appendChild(d);
      return d;
    };
    this.title = line('28px');
    this.scoreLine = line('15px', '#b8b2a0');
    this.earnedLine = line('26px', '#9fdc7a');
    this.totalLine = line('18px');
    const btn = this.button = document.createElement('button');
    btn.textContent = 'Hunt again';
    Object.assign(btn.style, { marginTop: '10px', padding: '10px 26px', font: '16px monospace', cursor: 'pointer',
      background: '#2c3a2a', color: '#e8e2d0', border: '1px solid #9fdc7a' });
    btn.addEventListener('click', () => this.onHuntAgain());
    s.appendChild(btn);
    const hint = line('11px', '#888');
    hint.textContent = 'Enter / Space also starts the next hunt';
    document.body.appendChild(s);
  }
}
