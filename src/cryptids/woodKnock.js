import * as THREE from 'three';

// Wood-knock call and response (Bigfoot L1).
// Any cryptid whose profile has clues.woodKnock knocks on a tree every so often (a hollow
// "tok... tok-tok" you hear from far off, panned toward where it is). Press K to knock back
// with your knock stick: a cryptid that's listening answers with its own knocks, then walks
// closer to investigate, stopping a cautious distance short of you. Answering soon after it
// knocked always works; knocking out of the blue only sometimes gets a reply.
export const KNOCK = {
  key: 'KeyK',
  hearRange: 110,          // metres: how far a knock carries (both ways)
  answerWindow: 45,        // seconds after its own knock that it's sure to answer you
  coldAnswerChance: 0.35,  // chance it answers a knock you start yourself
  replyDelay: [1.2, 2.6],  // seconds before it knocks back
  approachTo: 22,          // it comes to about this far from where you knocked (outside its flee range)
  playerCooldown: 2.5,     // seconds between your knocks
  pullCooldown: 12,        // after answering, it won't be pulled again for this long
  scare: 6,                // fear spike when you hear it knock nearby (scaled by distance)
};

export class WoodKnocks {
  constructor({ cryptids, player, camera, fear = null, input = null, rand = Math.random }) {
    this.cryptids = cryptids;
    this.player = player;
    this.camera = camera;
    this.fear = fear;
    this.input = input;
    this.rand = rand;
    this.state = new Map();      // cryptid -> { next, lastKnock, pullCooldown }
    this.pending = [];           // scheduled replies { cryptid, at }
    this.time = 0;
    this.playerCooldown = 0;
    this.log = [];               // { t, who: 'player' | name, x, z, kind }
    this.audio = new KnockAudio();
    this.buildCaption();
    addEventListener('keydown', (e) => {
      if (e.code === KNOCK.key && !e.repeat && (!this.input || this.input.locked)) this.playerKnock();
    });
  }

  knockers() { return this.cryptids.cryptids.filter((c) => c.profile.clues?.woodKnock); }

  stateOf(c) {
    if (!this.state.has(c)) this.state.set(c, { next: this.interval(c), lastKnock: null, pullCooldown: 0 });
    return this.state.get(c);
  }

  interval(c) {
    const [lo, hi] = c.profile.clues.woodKnock.intervalSeconds;
    return lo + this.rand() * (hi - lo);
  }

  update(dt) {
    this.time += dt;
    this.playerCooldown = Math.max(0, this.playerCooldown - dt);
    for (const c of this.knockers()) {
      const s = this.stateOf(c);
      s.pullCooldown = Math.max(0, s.pullCooldown - dt);
      s.next -= dt;
      // It only knocks while calm (not while running from you or charging).
      if (s.next <= 0) {
        if (c.state === 'roam' || c.state === 'investigate') this.cryptidKnock(c, 'call');
        s.next = this.interval(c);
      }
    }
    for (const p of this.pending.filter((p) => p.at <= this.time)) {
      this.pending.splice(this.pending.indexOf(p), 1);
      this.answer(p.cryptid, p.spot);
    }
    this.updateCaption(dt);
  }

  /** The cryptid bangs on a tree where it stands. */
  cryptidKnock(c, kind = 'call') {
    const s = this.stateOf(c);
    s.lastKnock = { x: c.agent.x, z: c.agent.z, t: this.time };
    this.log.push({ t: this.time, who: c.profile.name, x: c.agent.x, z: c.agent.z, kind });
    const p = this.player.position, d = Math.hypot(c.agent.x - p.x, c.agent.z - p.z);
    if (d > KNOCK.hearRange) return;
    const count = kind === 'reply' ? 2 : 1 + Math.floor(this.rand() * 3);
    this.audio.knock({ count, distance: d, pan: this.panTo(c.agent.x, c.agent.z), heavy: true });
    this.fear?.scare(KNOCK.scare * (1 - d / KNOCK.hearRange), 'wood knock');
    this.showCaption(`${kind === 'reply' ? 'Knocks answer you' : 'A wood knock'}: ${'KNOCK '.repeat(count).trim()} (${this.describe(c.agent.x, c.agent.z, d)})`);
  }

  /** You knock with your stick. Listening cryptids may answer and come closer. */
  playerKnock() {
    if (this.playerCooldown > 0) return false;
    this.playerCooldown = KNOCK.playerCooldown;
    const p = this.player.position;
    const spot = { x: p.x, z: p.z };
    this.log.push({ t: this.time, who: 'player', x: p.x, z: p.z, kind: 'player' });
    this.audio.knock({ count: 2, distance: 1, pan: 0, heavy: false });
    this.showCaption('You knock: KNOCK KNOCK');
    for (const c of this.knockers()) {
      const s = this.stateOf(c);
      const d = Math.hypot(c.agent.x - p.x, c.agent.z - p.z);
      if (d > KNOCK.hearRange || s.pullCooldown > 0) continue;
      if (!(c.state === 'roam' || c.state === 'investigate')) continue;
      const recent = s.lastKnock && this.time - s.lastKnock.t <= KNOCK.answerWindow;
      if (!recent && this.rand() > KNOCK.coldAnswerChance) continue;
      const [lo, hi] = KNOCK.replyDelay;
      this.pending.push({ cryptid: c, spot, at: this.time + lo + this.rand() * (hi - lo) });
      s.pullCooldown = KNOCK.pullCooldown;
    }
    return true;
  }

  // Knock back, then head toward where you knocked, stopping short of you.
  answer(c, spot) {
    if (!(c.state === 'roam' || c.state === 'investigate')) return;
    this.cryptidKnock(c, 'reply');
    const dx = c.agent.x - spot.x, dz = c.agent.z - spot.z, d = Math.hypot(dx, dz) || 1;
    if (d <= KNOCK.approachTo) return;   // already close: it just answers
    const goal = { x: spot.x + (dx / d) * KNOCK.approachTo, z: spot.z + (dz / d) * KNOCK.approachTo };
    if (c.enterInvestigateNoise) c.enterInvestigateNoise(goal, 'answered your knock');
  }

  panTo(x, z) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();
    const to = new THREE.Vector3(x - this.camera.position.x, 0, z - this.camera.position.z).normalize();
    return THREE.MathUtils.clamp(right.dot(to), -1, 1);
  }

  describe(x, z, d) {
    const p = this.player.position;
    const a = Math.atan2(x - p.x, -(z - p.z));   // 0 = north (-z), clockwise
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const dir = dirs[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
    const far = d < 25 ? 'close' : d < 60 ? 'not far' : 'far off';
    return `${far}, to the ${dir}`;
  }

  buildCaption() {
    const el = this.caption = document.createElement('div');
    Object.assign(el.style, { position: 'fixed', top: '44px', left: '50%', transform: 'translateX(-50%)', font: '13px monospace',
      color: '#e8dcc0', textShadow: '0 0 3px #000', pointerEvents: 'none', opacity: '0', transition: 'opacity .4s', whiteSpace: 'nowrap' });
    document.body.appendChild(el);
    this.captionLeft = 0;
  }

  showCaption(text) { this.caption.textContent = text; this.caption.style.opacity = '1'; this.captionLeft = 4; }

  updateCaption(dt) {
    if (this.captionLeft <= 0) return;
    this.captionLeft -= dt;
    if (this.captionLeft <= 0) this.caption.style.opacity = '0';
  }
}

// Synthesised knock: a hollow wooden "tok" (filtered noise click + low body resonance),
// quieter and duller with distance, panned left/right toward the source.
export class KnockAudio {
  constructor() {
    this.ctx = null;
    const unlock = () => { this.ensure(); this.ctx?.resume?.(); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch { this.ctx = null; }
    return this.ctx;
  }

  knock(opts) {
    const ctx = this.ensure();
    if (!ctx) return;
    scheduleKnocks(ctx, ctx.destination, ctx.currentTime + 0.02, opts);
  }
}

/** Schedule `count` knocks into `dest` (works with live and offline audio contexts). */
export function scheduleKnocks(ctx, dest, t0, { count = 2, distance = 1, pan = 0, heavy = true }) {
  const gain = Math.min(1, 6 / Math.max(6, distance)) * (heavy ? 1 : 0.6);
  const cutoff = 3200 * Math.max(0.15, 1 - distance / 150);     // far knocks lose their crack
  const out = ctx.createGain();
  out.gain.value = gain;
  let node = out;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); node = p; }
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
  lp.connect(out);
  node.connect(dest);
  const gap = heavy ? 0.55 : 0.32;
  for (let i = 0; i < count; i++) {
    const t = t0 + i * gap * (0.9 + Math.random() * 0.2);
    // Body: a short, falling low tone (the trunk resonating).
    const osc = ctx.createOscillator(), og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 150 : 260, t);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 70 : 140, t + 0.18);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + (heavy ? 0.35 : 0.2));
    osc.connect(og).connect(lp);
    osc.start(t); osc.stop(t + 0.4);
    // Crack: a burst of band-passed noise (the strike).
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let k = 0; k < len; k++) data[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 4);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = heavy ? 900 : 1500; bp.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = heavy ? 0.7 : 0.5;
    src.connect(bp).connect(ng).connect(lp);
    src.start(t);
  }
}

WoodKnocks.scheduleKnocks = scheduleKnocks;   // for tools that render the sounds offline
