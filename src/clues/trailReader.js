import { COMPASS, pointAhead, nearestIndex, clueHint, coldHint, octantOfHeading } from './trailHint.js';

const LOOKAHEAD = 15; // metres along the cryptid's route the hint points toward

const CSS = `
#trail-compass { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); padding: 3px 12px;
  background: #000a; color: #e8e4d8; font: 13px monospace; letter-spacing: 2px; pointer-events: none; }
#trail-hint { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); max-width: 70vw;
  padding: 8px 14px; background: #0c0e12d0; color: #e8e4d8; border-left: 3px solid #ffd88a;
  font: 14px/1.4 monospace; pointer-events: none; opacity: 0; transition: opacity .3s; }
#trail-hint.visible { opacity: 1; }`;

/**
 * Reading clues: when the player examines a clue (E, logged by the journal), say how
 * fresh it is and which way the cryptid went from it, using the route it actually walked.
 * Also shows a compass strip so the direction can be followed.
 */
export class TrailReader {
  constructor({ clues, clueTrails, journal, player }) {
    this.clueTrails = clueTrails;
    this.player = player;
    this.anchors = new Map(); // clue id -> { trail, point } route point when it was dropped

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.compass = Object.assign(document.createElement('div'), { id: 'trail-compass' });
    this.hint = Object.assign(document.createElement('div'), { id: 'trail-hint' });
    document.body.append(this.compass, this.hint);
    this.hintTimer = 0;
    this.lastHint = '';

    clues.on((ev, clue) => {
      if (ev === 'expire') { this.anchors.delete(clue.id); return; }
      const trail = this.trailOf(clue.cryptidId);
      // Keep the route point object itself: it survives the route buffer shifting.
      if (trail) this.anchors.set(clue.id, { trail, point: trail.path[trail.path.length - 1] });
    });
    journal.on((ev, entry) => {
      if (ev !== 'record') return;
      const clue = clues.clues.find((c) => c.id === entry.clueId);
      if (!clue) return;
      entry.hint = this.hintFor(clue);
      this.show(entry.hint);
    });
  }

  trailOf(cryptidId) {
    for (const [cryptid, trail] of this.clueTrails.trails) if (cryptid.profile.id === cryptidId) return trail;
    return null;
  }

  /** Where the route leads from this clue, or null if its cryptid is gone. */
  aheadOf(clue) {
    const a = this.anchors.get(clue.id);
    const trail = a?.trail ?? this.trailOf(clue.cryptidId);
    if (!trail || !trail.path.length) return null;
    let i = a ? trail.path.indexOf(a.point) : -1;
    if (i < 0) i = nearestIndex(trail.path, clue.origin.x, clue.origin.z);
    return pointAhead(trail.path, i, LOOKAHEAD);
  }

  hintFor(clue) {
    // GDD 4.4: ordinary animal signs are real false leads. Reading them tells you so, not where it went.
    // Ordinary sign (GDD 4.4, #99): reading it tells you what you see, not what made it.
    if (clue.type === 'deerTrack') return 'Small, neat hoof prints wandering off. Light-footed, whatever it was.';
    if (clue.type === 'foxTrack') return 'Tiny paw prints in a dead-straight line. Something small and quick.';
    if (clue.type === 'owlFeather') return 'A single soft feather. Nothing else nearby.';
    if (clue.type === 'wingDust') return 'Scales, shed where something big sat a while. Look up.';
    const ahead = this.aheadOf(clue);
    return ahead ? clueHint(clue, ahead) : coldHint(clue);
  }

  show(text, seconds = 7) {
    this.lastHint = text;
    this.hint.textContent = text;
    this.hint.classList.add('visible');
    this.hintTimer = seconds;
  }

  update(dt) {
    // Player yaw 0 looks north (-Z); turning right decreases yaw.
    const h = ((-this.player.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const text = `${COMPASS[octantOfHeading(h)].toUpperCase()}  ${Math.round((h * 180) / Math.PI) % 360}°`;
    if (this.compass.textContent !== text) this.compass.textContent = text;
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.hint.classList.remove('visible');
  }
}
