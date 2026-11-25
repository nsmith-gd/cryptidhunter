import * as THREE from 'three';

// A Night's Hunt (L0 greybox): briefing -> search & track -> photograph the target ->
// return to the van before dawn -> results. Caught (HuntFailure) and dawn end it early.
export const HUNT = {
  dawnSeconds: 7 * 60,          // real seconds from start until dawn
  exit: new THREE.Vector3(0, 0, 7),     // extraction point (the van parks just behind it)
  extractRadius: 4,
  giveUpAfter: 20,              // seconds before "leave without a photo" is offered
};

export class HuntLoop {
  constructor({ scene, player, journal, colliders = [], target = 'Bigfoot', onRestart = () => location.reload() }) {
    this.player = player;
    this.journal = journal;
    this.target = target;
    this.onRestart = onRestart;
    this.stage = 'briefing';      // briefing | search | extract | ended
    this.elapsed = 0;
    this.photo = null;            // best photo of the target: { subject, distance, score, source, at }
    this.photos = [];             // every photo of the target this hunt (handheld + gear)
    this.missedShots = 0;
    this.outcome = null;          // complete | abandoned | dawn | caught
    this.inZone = false;
    this.buildVan(scene, colliders);
    this.buildHud();
    this.buildEndScreen();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && !e.repeat && this.canGiveUp()) this.end('abandoned');
      if ((e.code === 'Space' || e.code === 'Enter') && this.stage === 'ended' && this.outcome !== 'caught') this.restart();
    });
  }

  start() {
    if (this.stage !== 'briefing') return;
    this.stage = 'search';
  }

  get timeLeft() { return Math.max(0, HUNT.dawnSeconds - this.elapsed); }

  canGiveUp() { return this.stage === 'search' && this.inZone && this.elapsed >= HUNT.giveUpAfter; }

  // Hook for the camera: called with { subject, distance } for every shot taken.
  // Hook for every camera (handheld or gear): { subject, distance, score?, source? }.
  onPhoto({ subject, distance, score = null, source = 'handheld camera' }) {
    if (this.stage !== 'search' && this.stage !== 'extract') return;
    if (subject !== this.target) { if (source === 'handheld camera') this.missedShots++; return; }
    const shot = { subject, distance, score: score ?? 0, source, at: this.elapsed };
    this.photos.push(shot);
    const better = !this.photo || shot.score > this.photo.score || (shot.score === this.photo.score && distance < this.photo.distance);
    if (better) this.photo = shot;
    this.stage = 'extract';
  }

  update(dt) {
    this.beacon.material.opacity = 0.35 + 0.2 * Math.sin(performance.now() / 300);
    const p = this.player.position;
    this.inZone = Math.hypot(p.x - HUNT.exit.x, p.z - HUNT.exit.z) < HUNT.extractRadius;
    if (this.stage === 'search' || this.stage === 'extract') {
      this.elapsed += dt;
      if (this.stage === 'extract' && this.inZone) this.end('complete');
      else if (this.elapsed >= HUNT.dawnSeconds) this.end('dawn');
    }
    this.renderHud();
  }

  end(outcome) {
    if (this.stage === 'ended') return;
    this.stage = 'ended';
    this.outcome = outcome;
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
  // hunt) and a tall pulsing green beacon you can see from anywhere.
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
    // Green pulsing beacon: visible from anywhere so you can find your way back.
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 30, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3cff7a, transparent: true, opacity: 0.4, depthWrite: false, fog: false }),
    );
    this.beacon.position.set(1.6, 15, 0);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(HUNT.extractRadius - 0.12, HUNT.extractRadius, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3cff7a, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    ring.position.y = 0.03;
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
    const dVan = Math.hypot(p.x - HUNT.exit.x, p.z - HUNT.exit.z);
    switch (this.stage) {
      case 'briefing': return '';
      case 'search': {
        const n = this.journal?.entries.length ?? 0;
        const lines = [`OBJECTIVE: Photograph ${this.target}`,
          n === 0 ? 'Search for tracks with your flashlight. Aim at one and press E to examine it.'
            : `Clues logged: ${n}. Follow the trail; when you see ${this.target}, hold right mouse to raise your camera and left-click to snap.`];
        if (this.canGiveUp()) lines.push('[H] Head home without a photo');
        return lines.join('\n');
      }
      case 'extract':
        return `GOT THE SHOT! Return to the van (green light) before dawn — ${dVan.toFixed(0)} m`;
      case 'ended': return '';
    }
    return '';
  }

  renderHud() {
    this.hud.textContent = this.objectiveText();
    if (this.stage === 'briefing' || this.stage === 'ended') { this.clock.textContent = ''; return; }
    const t = this.timeLeft;
    // In-world clock: 11:00 PM start, dawn at 5:30 AM.
    const night = 6.5 * 60; // minutes of in-world night
    const mins = 23 * 60 + (this.elapsed / HUNT.dawnSeconds) * night;
    const h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
    const h12 = ((h + 11) % 12) + 1;
    this.clock.textContent = `${h12}:${String(m).padStart(2, '0')} ${h >= 12 && h < 24 ? 'PM' : 'AM'}  ·  dawn in ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    this.clock.style.color = t < 60 ? '#ffb070' : '#cfd8ff';
  }

  buildEndScreen() {
    const s = this.screen = document.createElement('div');
    Object.assign(s.style, { position: 'fixed', inset: '0', display: 'none', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '12px', background: 'rgba(6,10,16,0.9)', color: '#eee', fontFamily: 'monospace',
      textAlign: 'center', zIndex: '20', cursor: 'pointer', whiteSpace: 'pre', lineHeight: '1.6' });
    this.endTitle = document.createElement('div');
    Object.assign(this.endTitle.style, { fontSize: '44px', letterSpacing: '6px' });
    this.endBody = document.createElement('div');
    this.endBody.style.fontSize = '15px';
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
      dawn: ['DAWN BROKE', '#ffb070'],
    };
    const [title, color] = titles[this.outcome];
    this.endTitle.textContent = title;
    this.endTitle.style.color = color;
    const t = Math.floor(this.elapsed);
    const v = this.journal?.verdict?.();
    const lines = [];
    if (this.outcome === 'dawn') lines.push(`The sun came up before you made it back to the van.${this.photo ? '\nThe photo never left the woods.' : ''}`);
    if (this.outcome === 'abandoned') lines.push('You drove home empty-handed.');
    const best = this.photo && this.outcome === 'complete' ? this.photo : null;
    lines.push('', `Best photo of ${this.target}:  ${best ? `score ${best.score} (${best.source}, ${best.distance.toFixed(0)} m)` : 'none'}`);
    if (best && this.photos.length > 1) lines.push(`Photos of ${this.target} taken:  ${this.photos.length}`);
    lines.push(`Clues logged:  ${this.journal?.entries.length ?? 0}`);
    if (v?.likely) lines.push(`Journal verdict:  ${v.likely.name}`);
    lines.push(`Time out:  ${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`);
    this.endBody.textContent = lines.join('\n');
    this.screen.style.display = 'flex';
  }
}
