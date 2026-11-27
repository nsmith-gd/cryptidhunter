import * as THREE from 'three';
import { DECAL_OFFSET } from '../maps/terrainPainter.js';

// A Night's Hunt: briefing -> search & track -> photograph the target -> return to the van and
// choose to leave (H) -> results. A 15-minute night clock runs: at dawn the cryptid leaves the
// area (no more photos) and the before-dawn bonus is gone, but the hunt still only ends when
// you drive home from the van (director's call) or get caught.
export const HUNT = {
  dawnSeconds: 15 * 60,         // real seconds from start until dawn (11:00 PM -> 5:30 AM)
  dawnBonus: 0.25,              // drive home before dawn: photo earnings +25%
  exit: new THREE.Vector3(0, 0, 7),     // extraction point (the van parks just behind it)
  extractRadius: 4,
  giveUpAfter: 20,              // seconds before "leave without a photo" is offered
};

export class HuntLoop {
  constructor({ scene, player, journal, colliders = [], target = 'Bigfoot', onRestart = () => location.reload(), onEnd = null, onDawn = null, onStart = null, manifest = null }) {
    this.onStart = onStart;       // () => void: commit the expedition (#98) as the hunt begins
    this.manifest = manifest;     // () => manifest text for the extraction review at the van (#98)
    this.review = null;           // { outcome } while the extraction manifest is open
    this.onDawn = onDawn;         // () => void: the cryptid leaves at first light
    this.dawned = false;
    this.player = player;
    this.onEnd = onEnd;           // (outcome) => { summary, money } from base camp, shown on the end screen
    this.journal = journal;
    this.target = target;
    this.onRestart = onRestart;
    this.stage = 'briefing';      // briefing | search | extract | ended
    this.elapsed = 0;
    this.photo = null;            // best photo of the target: { subject, distance, score, source, at }
    this.photos = [];             // every photo of the target this hunt (handheld + gear)
    this.missedShots = 0;
    this.shotsTaken = 0;          // every photo you took this hunt (handheld camera), hit or miss
    this.outcome = null;          // complete | abandoned | caught
    this.inZone = false;
    this.buildVan(scene, colliders);
    this.buildHud();
    this.buildEndScreen();
    addEventListener('keydown', (e) => {
      // H at the van: drive home. With a photo that completes the hunt; without one (after a
      // little while) it abandons it. You choose when to leave - you can keep hunting for a better shot.
      // #98: the first H opens the extraction manifest review; H again commits the departure.
      if (e.code === 'KeyH' && !e.repeat) {
        const outcome = this.canLeaveWithPhoto() ? 'complete' : this.canGiveUp() ? 'abandoned' : null;
        if (!outcome) { this.explainNoLeave(); return; }
        if (this.review && this.manifest) this.end(this.review.outcome);
        else if (this.manifest) this.openReview(outcome);
        else this.end(outcome);
      }
      if (e.code === 'KeyC' && this.review) this.closeReview();
      if ((e.code === 'Space' || e.code === 'Enter') && this.stage === 'ended' && this.outcome !== 'caught') this.restart();
    });
  }

  /** H pressed but you can't drive out yet: say why instead of doing nothing (#90). */
  explainNoLeave() {
    if (this.stage !== 'search' && this.stage !== 'extract') return;
    const p = this.player.position, d = Math.hypot(p.x - HUNT.exit.x, p.z - HUNT.exit.z);
    this.notice = !this.inZone
      ? `The van is ${Math.round(d)} m away (trailhead parking): walk into the green ring to drive out.`
      : `You've only just got here: look around for ${Math.ceil(HUNT.giveUpAfter - this.elapsed)} s before heading home.`;
    this.noticeUntil = this.elapsed + 3;
    this.renderHud();
  }

  start() {
    if (this.stage !== 'briefing') return;
    this.onStart?.();
    this.stage = 'search';
  }

  // ---------- extraction manifest review (GDD 6.3) ----------
  openReview(outcome) {
    this.review = { outcome };
    if (!this.reviewEl) {
      this.reviewEl = document.createElement('div');
      this.reviewEl.id = 'extraction-review';
      Object.assign(this.reviewEl.style, { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: '15',
        padding: '14px 20px', background: 'rgba(14,18,12,0.92)', border: '1px solid #3cff7a', color: '#e8f2e0', font: '13px/1.55 monospace',
        whiteSpace: 'pre', pointerEvents: 'none' });
      document.body.appendChild(this.reviewEl);
    }
    this.reviewEl.textContent = this.manifest();
    this.reviewEl.style.display = 'block';
  }

  closeReview() {
    this.review = null;
    if (this.reviewEl) this.reviewEl.style.display = 'none';
  }

  get timeLeft() { return Math.max(0, HUNT.dawnSeconds - this.elapsed); }

  canGiveUp() { return this.stage === 'search' && this.inZone && (this.elapsed >= HUNT.giveUpAfter || this.dawned); }

  /** True while it's still night (leaving now earns the before-dawn bonus). */
  get beforeDawn() { return !this.dawned; }

  canLeaveWithPhoto() { return this.stage === 'extract' && this.inZone; }

  // Hook for the camera: called with { subject, distance } for every shot taken.
  // Hook for every camera (handheld or gear): { subject, distance, score?, source? }.
  onPhoto({ subject, distance, score = null, source = 'handheld camera' }) {
    if (this.stage !== 'search' && this.stage !== 'extract') return;
    if (source === 'handheld camera') this.shotsTaken++;
    if (subject !== this.target) { if (source === 'handheld camera') this.missedShots++; return; }
    const shot = { subject, distance, score: score ?? 0, source, at: this.elapsed };
    this.photos.push(shot);
    const better = !this.photo || shot.score > this.photo.score || (shot.score === this.photo.score && distance < this.photo.distance);
    if (better) this.photo = shot;
    this.stage = 'extract';
  }

  update(dt) {
    this.beacon.visible = Math.floor(performance.now() / 600) % 2 === 0;   // hazard lights blinking
    const p = this.player.position;
    this.inZone = Math.hypot(p.x - HUNT.exit.x, p.z - HUNT.exit.z) < HUNT.extractRadius;
    if (this.review && !this.inZone) this.closeReview();   // walked away from the van: keep investigating
    if (this.stage === 'search' || this.stage === 'extract') {
      this.elapsed += dt;
      if (!this.dawned && this.elapsed >= HUNT.dawnSeconds) {
        this.dawned = true;                // first light: the cryptid leaves, the bonus is gone
        this.onDawn?.();
      }
    }
    this.renderHud();
  }

  end(outcome) {
    if (this.stage === 'ended') return;
    this.stage = 'ended';
    this.outcome = outcome;
    this.closeReview();
    this.leftBeforeDawn = !this.dawned;
    this.settlement = this.onEnd?.(outcome) ?? null;  // base camp: photos sold or lost, gear kept
    this.renderHud();                                 // clears the objective + clock
    if (outcome === 'caught') return;                 // HuntFailure shows its own screen
    document.exitPointerLock?.();
    this.readyAt = performance.now() + 600;
    this.showResults();
  }

  restart() {
    if (performance.now() < (this.readyAt ?? 0)) return;
    this.onRestart();
  }

  // ---------- world ----------
  // The extraction van: parked just behind the exit point, with a green ring (walk in to end the
  // hunt). No beacon over the trees (#70): finding your way back is the task. Its amber hazard
  // lights blink, which you only see once you're close (the fog swallows them).
  buildVan(scene, colliders) {
    const g = new THREE.Group();
    const paint = (c, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.75, 4.9), paint(0x5a5f58));       // boxy panel van
    body.position.y = 0.4 + 1.75 / 2;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.85, 0.7), paint(0x4f544e));    // short bonnet
    nose.position.set(0, 0.4 + 0.42, -2.8);
    const glass = new THREE.MeshStandardMaterial({ color: 0x0d1620, roughness: 0.2, emissive: 0x05080c });
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.05), glass);
    windscreen.position.set(0, 1.75, -2.46);
    for (const sx of [-1.01, 1.01]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 1.0), glass);
      w.position.set(sx, 1.75, -1.85);
      g.add(w);
    }
    const tyre = paint(0x111111, 1);
    for (const [x, z] of [[-0.9, -1.8], [0.9, -1.8], [-0.9, 1.6], [0.9, 1.6]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10).rotateZ(Math.PI / 2), tyre);
      t.position.set(x, 0.38, z);
      g.add(t);
    }
    // Lights so it reads in the dark: warm headlights forward, red tail lights back.
    const head = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    const tail = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    for (const x of [-0.7, 0.7]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.05), head);
      h.position.set(x, 0.95, -3.16);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.05), tail);
      t.position.set(x * 1.25, 1.1, 2.46);
      g.add(h, t);
    }
    for (const m of [body, nose]) { m.castShadow = m.receiveShadow = true; }
    this.beacon = new THREE.Group();
    this.beacon.name = 'hazard-lights';
    const amber = new THREE.MeshBasicMaterial({ color: 0xffa020 });
    for (const x of [-0.98, 0.98]) for (const z of [-3.12, 2.46]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), amber);
      h.position.set(x, z < 0 ? 0.95 : 1.4, z);
      this.beacon.add(h);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(HUNT.extractRadius - 0.12, HUNT.extractRadius, 48).rotateX(-Math.PI / 2),
      // Ground marker: decal tier (#61), drawn over the terrain by depth bias, not a lift.
      new THREE.MeshBasicMaterial({ color: 0x3cff7a, transparent: true, opacity: 0.5, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: DECAL_OFFSET.factor, polygonOffsetUnits: DECAL_OFFSET.units }),
    );
    ring.position.y = 0.01;
    g.add(body, nose, windscreen, this.beacon, ring);
    // Van sits just behind the exit point (nose toward it); the ring is centred on the point itself.
    g.position.copy(HUNT.exit);
    g.position.z += 4.2;
    ring.position.z = -4.2;
    g.name = 'extraction-van';
    scene.add(g);
    this.van = g;
    g.updateMatrixWorld(true);
    colliders.push(new THREE.Box3().setFromObject(body), new THREE.Box3().setFromObject(nose));
  }

  // ---------- HUD ----------
  buildHud() {
    const box = this.hud = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', top: '60px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', maxWidth: '440px',
      font: '13px monospace', color: '#e8e8e8', textShadow: '0 0 3px #000', pointerEvents: 'none', whiteSpace: 'pre-line', lineHeight: '1.5' });
    document.body.appendChild(box);
    this.clock = document.createElement('div');
    Object.assign(this.clock.style, { position: 'fixed', top: '8px', right: '10px', font: '13px monospace', color: '#cfd8ff',
      textShadow: '0 0 3px #000', pointerEvents: 'none' });
    document.body.appendChild(this.clock);
  }

  objectiveText() {
    const p = this.player.position;
    switch (this.stage) {
      case 'briefing': return '';
      case 'search': {
        const n = this.journal?.entries.length ?? 0;
        const lines = [`OBJECTIVE: Photograph ${this.target}`,
          n === 0 ? 'Search for tracks with your flashlight. Aim at one and press E to examine it.'
            : `Clues logged: ${n}. Follow the trail; when you see ${this.target}, hold right mouse to raise your camera and left-click to snap.`];
        if (this.dawned) lines[1] = `Dawn: ${this.target} has left the area. Head back to the van and drive home.`;
        if (this.canGiveUp()) lines.push('[H] Head home without a photo');
        return lines.join('\n');
      }
      case 'extract': {
        // No score in the field (#85, GDD 4.3/4.4): film is only judged once it's developed at home.
        const best = '';
        return this.inZone
          ? `At the van with your photo${best}.\n[H] Drive home and end the hunt — or keep hunting for a better shot.`
          : this.dawned
            ? `Dawn: ${this.target} is gone. Bring your photo${best} back to the van at the trailhead parking and press H.\nFind the way with your map and compass (M) and the trail signs.`
            : `GOT THE SHOT${best}! Back to the van at the trailhead parking before dawn for a +${Math.round(HUNT.dawnBonus * 100)}% bonus.\nFind the way with your map and compass (M) and the trail signs, then press H at the van.`;
      }
      case 'ended': return '';
    }
    return '';
  }

  renderHud() {
    const notice = (this.stage === 'search' || this.stage === 'extract') && this.notice && this.elapsed < (this.noticeUntil ?? 0) ? `\n${this.notice}` : '';
    this.hud.textContent = this.objectiveText() + notice;
    if (this.stage === 'briefing' || this.stage === 'ended') { this.clock.textContent = ''; return; }
    const t = this.timeLeft;
    // In-world clock: 11:00 PM start, dawn at 5:30 AM.
    const night = 6.5 * 60; // minutes of in-world night
    const mins = 23 * 60 + (this.elapsed / HUNT.dawnSeconds) * night;
    const h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
    const h12 = ((h + 11) % 12) + 1;
    if (this.dawned) {
      this.clock.textContent = '5:30 AM  ·  DAWN: the trail has gone cold';
      this.clock.style.color = '#ffb070';
      return;
    }
    this.clock.textContent = `${h12}:${String(m).padStart(2, '0')} ${h >= 12 && h < 24 ? 'PM' : 'AM'}  ·  dawn in ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    this.clock.style.color = t < 60 ? '#ffb070' : t < 180 ? '#ffd9a0' : '#cfd8ff';
  }

  buildEndScreen() {
    const s = this.screen = document.createElement('div');
    Object.assign(s.style, { position: 'fixed', inset: '0', display: 'none', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '12px', background: 'rgba(6,10,16,0.9)', color: '#eee', fontFamily: 'monospace',
      textAlign: 'center', zIndex: '20', cursor: 'pointer', whiteSpace: 'pre', lineHeight: '1.6' });
    this.endTitle = document.createElement('div');
    Object.assign(this.endTitle.style, { fontSize: '44px', letterSpacing: '6px' });
    this.endBody = document.createElement('div');
    Object.assign(this.endBody.style, { fontSize: '15px', textAlign: 'left' });
    const hint = Object.assign(document.createElement('div'), { textContent: 'Click or press Space to start a new hunt' });
    Object.assign(hint.style, { fontSize: '13px', color: '#aaa', marginTop: '10px' });
    s.append(this.endTitle, this.endBody, hint);
    s.addEventListener('click', () => this.restart());
    document.body.appendChild(s);
  }

  showResults() {
    const titles = {
      complete: ['HUNT COMPLETE', '#7dff9e'],
      abandoned: ['HUNT ABANDONED', '#ffd27a'],
      emergency: ['EVACUATED', '#ff9c7a'],
    };
    const [title, color] = titles[this.outcome];
    this.endTitle.textContent = title;
    this.endTitle.style.color = color;
    // Two columns so everything fits on a small screen: photos on the left, clues + money right.
    const [head, photos, rest] = this.resultsText().split('\n\n§\n');
    const col = (text) => Object.assign(document.createElement('div'), { textContent: text });
    const cols = document.createElement('div');
    Object.assign(cols.style, { display: 'flex', gap: '48px', alignItems: 'flex-start', marginTop: '10px' });
    cols.append(col(photos), col(rest));
    const h = col(head); h.style.textAlign = 'center';
    this.endBody.replaceChildren(h, cols);
    if (this.album) this.endBody.append(this.album(this.outcome));   // every shot on the roll (#51)
    this.screen.style.display = 'flex';
  }

  /** The results summary. Every number comes from this hunt's records and base camp's settlement. */
  resultsText() {
    const pad = (label, value) => `${label.padEnd(22, ' ')}${value}`;
    const r = this.results();
    const lines = [];
    if (this.outcome === 'complete') lines.push(this.leftBeforeDawn ? `You made it home before dawn: +${Math.round(HUNT.dawnBonus * 100)}% bonus on your photos.` : 'You drove home after dawn: no before-dawn bonus.');
    if (this.outcome === 'abandoned') lines.push(r.photosOfTarget || r.evidence.length ? 'You drove home early.' : 'You drove home empty-handed.');
    if (this.outcome === 'emergency') lines.push('A ranger evacuated you. What you carried came with you.');
    if (r.debrief) lines.push(`Outcome: ${r.debrief.label}`);
    lines.push('', '§', 'PHOTOS');
    lines.push(pad('Taken', `${r.shotsTaken}${r.gearShots ? ` (+${r.gearShots} from trail cams)` : ''}`));
    lines.push(pad(`Of ${this.target}`, String(r.photosOfTarget)));
    for (const p of r.list) lines.push(`  ${p.best ? '★' : '·'} score ${String(p.score).padStart(3)}  ${p.source}, ${p.distance} m`);
    lines.push(pad('Best score', r.bestScore == null ? 'none' : `${r.bestScore} / 100`));
    lines.push('', '§', 'CLUES');
    lines.push(pad('Found', `${r.clues}${r.clueTypes ? `  (${r.clueTypes})` : ''}`));
    if (r.verdict) lines.push(pad('Journal verdict', r.verdict));
    if (r.evidence.length) {   // physical evidence sold at base camp (#73)
      lines.push('', 'EVIDENCE');
      for (const e of r.evidence) lines.push(`  ${e.name} (${e.cryptid})${e.novelty < 1 ? ', repeat' : ''}: $${e.value}`);
    }
    lines.push('', 'MONEY · BASE CAMP');
    if (r.money) {
      lines.push(pad('Photos sold', `$${r.money.photoValue}`));
      if (r.money.evidenceValue) lines.push(pad('Evidence sold', `$${r.money.evidenceValue}`));
      if (this.outcome === 'complete') lines.push(pad('Before-dawn bonus', `$${r.money.bonus}`));
      lines.push(pad('Earned this hunt', `$${r.money.earned}`));
      lines.push(pad('Total money', `$${r.money.total}`));
    }
    if (r.debrief) {   // #98 debrief, straight from the ledger settlement (GDD 7.5)
      const d = r.debrief, $ = (c) => `${c < 0 ? '-' : ''}$${Math.abs(c) % 100 ? (Math.abs(c) / 100).toFixed(2) : Math.abs(c) / 100}`;
      lines.push('', `DEBRIEF · attempt ${d.attemptId}`);
      lines.push(pad('Gross revenue', $(d.gross)));
      lines.push(pad('Bonus', $(d.bonus)));
      lines.push(pad('Expenses (trip)', $(-d.expense)));
      if (d.charges || d.waived) lines.push(pad('Emergency charges', `${$(-d.charges)}${d.waived ? ` (${$(d.waived)} waived)` : ''}`));
      lines.push(pad('Losses', d.losses.length ? d.losses.join(', ') : 'none'));
      // Between-trip recovery (#89, GDD 9.3): coming home hurt costs a visible share of the trip.
      const rec = this.recovery;
      if (rec) lines.push(pad('Injury recovery', `${$(-rec.cents)} (${rec.severity} injury${rec.cents < rec.quoted ? `, ${$(rec.quoted - rec.cents)} waived` : ''})`));
      lines.push(pad('Closing cash', $(d.closing - (rec?.cents ?? 0))));
    }
    // Research dossier (#101): milestones from this trip's field notes, and the career total.
    const res = this.settlement?.entry?.research;
    if (res) {
      const NAMES = { located: 'Located', documented: 'Documented', characterized: 'Characterized', confirmed: 'Confirmed', tagged: 'Tagged', captured: 'Captured' };
      lines.push('', 'RESEARCH');
      for (const n of res.newly) lines.push(pad(`${n.species} ${NAMES[n.milestone]}`, `+${n.credibility} credibility`));
      if (!res.newly.length) lines.push(pad('New milestones', res.ignored.length ? 'none (ambiguous record)' : 'none'));
      lines.push(pad('Career credibility', `${res.credibility}`));
    }
    lines.push('', pad('Time out', `${Math.floor(r.seconds / 60)}m ${String(r.seconds % 60).padStart(2, '0')}s`));
    return lines.join('\n');
  }

  /** Structured results (also used by the automated check). */
  results() {
    const s = this.settlement?.entry ?? null;
    const sorted = [...this.photos].sort((a, b) => b.score - a.score || a.distance - b.distance);
    const counts = {};
    for (const e of this.journal?.entries ?? []) counts[e.label] = (counts[e.label] ?? 0) + 1;
    const v = this.journal?.verdict?.();
    return {
      shotsTaken: this.shotsTaken,
      gearShots: this.photos.filter((p) => p.source !== 'handheld camera').length,
      photosOfTarget: this.photos.length,
      list: sorted.slice(0, 6).map((p, i) => ({ score: p.score, source: p.source, distance: Math.round(p.distance), best: i === 0 })),
      bestScore: this.photo ? this.photo.score : null,
      clues: this.journal?.entries.length ?? 0,
      clueTypes: Object.entries(counts).map(([k, n]) => `${k} ×${n}`).join(', '),
      verdict: v?.likely?.name ?? null,
      evidence: s?.evidenceSold ?? [],
      money: s ? { photoValue: s.earned - (s.bonus ?? 0) - (s.evidenceSold ?? []).reduce((a, e) => a + e.value, 0),
        evidenceValue: (s.evidenceSold ?? []).reduce((a, e) => a + e.value, 0), bonus: s.bonus ?? 0, earned: s.earned, total: s.moneyAfter } : null,
      seconds: Math.floor(this.elapsed),
      debrief: s?.ledger ? { ...s.ledger, attemptId: s.attemptId, outcomeClass: s.outcomeClass, label: this.outcomeLabels?.[s.outcomeClass] ?? s.outcomeClass,
        losses: s.leftBehind ?? [] } : null,
    };
  }

}
