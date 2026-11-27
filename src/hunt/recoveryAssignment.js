import * as THREE from 'three';
import { formatCAD } from '../economy/ledger.js';
import { groundAt } from '../maps/ground.js';

// Recovery assignment (#105; GDD 7.4, 9.1, 9.3). When you can't afford any viable trip (trip cost
// plus mandatory deposits), a local sponsor offers a survey instead of leaving you stuck:
//   - free: access and transport waived, no deposit;
//   - a fixed LOANER kit (it never enters your owned gear; it can't be sold or kept);
//   - log fresh wildlife sign at two distinct authored survey points (examine it, E), then drive out;
//   - a fixed $100 on delivery, whatever your dossiers say; failure pays nothing, and another
//     assignment is offered next time. Each assignment is a fresh attempt with new survey points
//     (no event reused); only one is active at a time; once a normal trip is affordable it's gone.
// Contracted fieldwork, not resale: the survey sign itself sells nothing.

export const SPONSOR = Object.freeze({
  name: 'Pine Hollow Field Naturalists',
  payCents: 10000,
  siteRadius: 7,                 // the fresh sign lies within this of the survey stake
  // Loaner kit: camera and torch are always with you; this is what the sponsor lends on top.
  loaner: { camera: 1, flashlight: 1, spareBatteries: 1 },
  // Authored survey points per map: easy-to-reach, low-contact spots off Bigfoot's beat (the
  // "no-contact route"). Each assignment uses the next two, so repeats survey new places.
  sites: {
    forest: [
      { key: 'footbridge', name: 'Footbridge creek bank', x: 41, z: 27 },
      { key: 'cabin', name: 'Old cabin clearing', x: -36, z: 74 },
      { key: 'campsite', name: 'Abandoned campsite', x: 70, z: 90 },
      { key: 'boulders', name: 'Boulder field', x: -78, z: -24 },
    ],
    test: [
      { key: 'a', name: 'North marker', x: 0, z: -14 },
      { key: 'b', name: 'East marker', x: 14, z: 0 },
      { key: 'c', name: 'West marker', x: -14, z: 0 },
    ],
  },
});

/** True when cash can't cover the cheapest viable trip (trip cost plus mandatory deposits). */
export function needsSponsor({ cash, tripCents, mandatoryCents = 0 }) {
  return cash < tripCents + mandatoryCents;
}

/** The two survey points for assignment number n on a map (rotating, never the same pair twice in a row). */
export function surveySites(mapId, n) {
  const all = SPONSOR.sites[mapId] ?? SPONSOR.sites.test;
  const a = (n * 2) % all.length, b = (n * 2 + 1) % all.length;
  return [all[a], all[b === a ? (a + 1) % all.length : b]].map((s) => ({ ...s, done: false }));
}

export class RecoveryAssignment {
  /** camp: Camp (ledger + save; state.recovery persists). */
  constructor({ camp, mapId, tripCents }) {
    this.camp = camp;
    this.mapId = mapId;
    this.tripCents = tripCents;
    this.state = (camp.state.recovery ??= { count: 0, active: null, history: [] });
    this.markers = [];
    this.closeStale();
  }

  get active() { return this.state.active; }

  /** Offered when you're broke and not already on one. Gone once a normal trip is affordable. */
  get offered() { return !this.active && needsSponsor({ cash: this.camp.ledger.cash, tripCents: this.tripCents }); }

  /** An assignment whose attempt was committed but never settled here (page closed): it failed. */
  closeStale() {
    const a = this.active;
    if (!a?.attemptId) return;
    if (this.camp.ledger.attempts?.[a.attemptId]?.state === 'settled' && !a.settled) this.finish(false, 'abandoned');
  }

  /** Take the survey: becomes the active assignment (the hunt then starts with the loaner kit). */
  accept() {
    if (!this.offered) return null;
    const n = this.state.count++;
    this.state.active = { id: `survey-${n + 1}`, n, mapId: this.mapId, sites: surveySites(this.mapId, n), attemptId: null, settled: false };
    this.camp.save();
    return this.state.active;
  }

  /** The kit you carry on the survey (replaces owned gear for this hunt). */
  loanerKit() { return { ...SPONSOR.loaner }; }

  /** Commit time: tie the assignment to the attempt. */
  bind(attemptId) { if (this.active) { this.active.attemptId = attemptId; this.camp.save(); } }

  /** Place a survey stake and fresh sign at each site. clues: ClueSystem. */
  setUp({ scene, clues }) {
    if (!this.active) return;
    this.traces = new Map();      // clue id -> site key
    for (const s of this.active.sites) {
      // A bright flagged stake so the point can be found, and fresh deer sign beside it.
      const g = new THREE.Group();
      const stake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 1 }));
      stake.position.y = 0.55;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.01), new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0x401400, roughness: 0.6 }));
      flag.position.set(0.15, 1.02, 0);
      g.add(stake, flag);
      g.position.set(s.x, groundAt(s.x, s.z), s.z);
      g.name = `survey-stake-${s.key}`;
      scene.add(g);
      this.markers.push(g);
      for (let i = 0; i < 3; i++) {
        const c = clues.spawn('deerTrack', { cryptidId: 'deer', position: { x: s.x + 1.2 + i * 0.85, y: 0, z: s.z + 0.6 + (i % 2) * 0.12 },
          rotationY: -Math.PI / 2, origin: { x: s.x, z: s.z }, data: { survey: s.key } });
        this.traces.set(c.id, s.key);
      }
    }
  }

  /** Each frame: a site is logged once you've examined its fresh sign. Returns newly logged sites. */
  update(clues) {
    const a = this.active;
    if (!a || !this.traces) return [];
    const now = [];
    for (const c of clues.clues) {
      const key = this.traces.get(c.id);
      if (!key || !c.found) continue;
      const s = a.sites.find((x) => x.key === key);
      if (s && !s.done) { s.done = true; now.push(s); }
    }
    if (now.length) this.camp.save();
    return now;
  }

  get progress() { const s = this.active?.sites ?? []; return { done: s.filter((x) => x.done).length, total: s.length }; }

  /**
   * After the hunt is settled: pay the fixed fee if both points were logged and you drove out.
   * Returns { paid, cents, reason }. One payment per assignment (ledger id), whatever happens.
   */
  settle({ extracted }) {
    const a = this.active;
    if (!a) return null;
    const { done, total } = this.progress;
    if (extracted && done === total) {
      const r = this.camp.ledger.post(`sponsor:${a.id}`, 'payout', SPONSOR.payCents, { attemptId: a.attemptId, memo: `Sponsor survey (${SPONSOR.name})` });
      this.finish(true, 'delivered');
      return { paid: true, cents: r.duplicate ? r.tx.cents : SPONSOR.payCents, reason: `Survey delivered: ${formatCAD(SPONSOR.payCents)} from the ${SPONSOR.name}` };
    }
    const why = !extracted ? 'you didn\'t make it out' : `only ${done} of ${total} survey points logged`;
    this.finish(false, why);
    return { paid: false, cents: 0, reason: `Survey not delivered (${why}): no fee. The sponsor will offer another.` };
  }

  finish(ok, why) {
    const a = this.active;
    this.state.history.push({ id: a.id, attemptId: a.attemptId, sites: a.sites.map((s) => `${s.key}${s.done ? '✓' : ''}`), ok, why });
    if (this.state.history.length > 20) this.state.history.shift();
    this.state.active = null;
    this.camp.save();
  }

  // ---- start-screen panel and field HUD ------------------------------------------------------
  mount(root = document.querySelector('#overlay > div'), { onAccept = () => {} } = {}) {
    if (!root || (!this.offered && !this.active)) return null;
    const el = this.el = document.createElement('div');
    el.id = 'sponsor-panel';
    Object.assign(el.style, { margin: '0 auto 16px', padding: '10px 14px', border: '1px solid #ff8a3a', background: '#24160ce6',
      color: '#f6e4cc', textAlign: 'left', font: '13px/1.55 monospace' });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('button')?.dataset.act === 'accept' && this.accept()) onAccept(this.active);
    });
    root.prepend(el);
    this.render();
    return el;
  }

  render() {
    if (!this.el) return;
    const kit = 'camera, flashlight, one spare battery';
    if (this.active) {
      const sites = this.active.sites.map((s) => `${s.done ? '✓' : '·'} ${s.name}`).join('   ');
      this.el.innerHTML = `<div style="font-weight:bold;letter-spacing:1px">SPONSOR SURVEY · ${SPONSOR.name}</div>
        <div>Find the orange-flagged stakes and examine the fresh sign beside each (E):</div>
        <div style="color:#ffd0a0">${sites}</div>
        <div>Then drive out at the van. Fixed fee on delivery: <b>${formatCAD(SPONSOR.payCents)}</b>. Fail and it pays nothing.</div>
        <div style="color:#a89070">Loaner kit: ${kit}. It goes back to the sponsor: you can't sell or keep it. Your own gear stays at camp.</div>`;
      return;
    }
    this.el.innerHTML = `<div style="font-weight:bold;letter-spacing:1px">SPONSOR SURVEY OFFERED</div>
      <div>You can't cover a trip right now (${formatCAD(this.tripCents)} needed, ${formatCAD(this.camp.ledger.cash)} in hand).</div>
      <div>The ${SPONSOR.name} will pay a fixed <b>${formatCAD(SPONSOR.payCents)}</b> to log fresh wildlife sign at two survey points and come back.</div>
      <div style="color:#a89070">Free access and transport, no deposit, loaner kit (${kit}). Ordinary survival rules apply.</div>
      <button data-act="accept" style="margin-top:8px;font:bold 13px monospace;padding:5px 12px;cursor:pointer;background:#ffb070;color:#1a140c;border:1px solid #7a4420">TAKE THE SURVEY</button>`;
  }

  buildHud() {
    if (!this.active || this.hud) return;
    this.hud = Object.assign(document.createElement('div'), { id: 'survey-hud' });
    Object.assign(this.hud.style, { position: 'fixed', right: '10px', top: '34px', font: '12px monospace', color: '#ffd0a0',
      textShadow: '0 0 3px #000', pointerEvents: 'none', textAlign: 'right', whiteSpace: 'pre' });
    document.body.append(this.hud);
  }

  renderHud() {
    if (!this.hud) return;
    const a = this.active;
    const text = a ? `SURVEY ${this.progress.done}/${this.progress.total}\n${a.sites.map((s) => `${s.done ? '✓' : '·'} ${s.name}`).join('\n')}${this.progress.done === this.progress.total ? '\nAll logged: back to the van' : ''}` : '';
    if (this.hud.textContent !== text) this.hud.textContent = text;
  }
}
