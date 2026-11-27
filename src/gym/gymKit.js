import { hash32 } from '../core/rng.js';
import { ContourProxy, TerritoryProxy, ScentProxy } from './proxies.js';
import { G05World } from './g05.js';
import { G04World } from './g04.js';
import { G07World } from './g07.js';
import { G06World } from './g06.js';
import { G09World } from './g09.js';

// Gym harness for G02–G04 (GDD 14.2, 15.1–15.3, 17.5; task #108).
//   Fixture     every load rebuilds the gym from scratch with its fixed seed (GYM_SEEDS, or ?seed=),
//               fixed reserves and a fixed kit. Reset = reload the same URL: the same fixture again.
//   Event trace every system decision worth reviewing, stamped with the sim tick (deterministic):
//               proxy decisions, health events, clues found, evidence taken, sleep, zone entries,
//               condition changes. `digest` hashes it so two replays can be compared exactly.
//   Debug HUD   gym, seed, tick, live readouts, the trace tail, the pass criteria and links to every
//               gym (G00 G02 G03 G04). Buttons: Reset, Run script, Blind.
//   Blind mode  ?blind (or the button): hides the debug answers (proxy states and positions, the
//               territory rings, the contour line, which trace is ordinary, the trace tail), leaving
//               only the tasks, so a tester plays it as a player would.
//   Criteria    each { id, text, status: 'pass' | 'fail' | 'not_evaluated', detail }. Human-tester
//               criteria ("4/5 testers can…") are always not_evaluated by the script.

export const GYM_TASKS = {
  G02: ['Walk the same route with the 5 kg and the 20 kg pack: compare stamina', 'Sprint, then walk', 'Eat when hungry',
    'Wade the crossing, then dry off and warm up at the shelter', 'Take the authored fall injury and bandage it (B)', 'Rest at the shelter with several deficits at once'],
  G03: ['Find fresh tracks and follow them toward the den or feeding area', 'Photograph or collect something without seeing the creature',
    'Tell the ordinary-animal trace from the real one', 'Pitch the tent at camp A or B and sleep', 'Head back to the trailhead'],
  G05: ['Board the boat at the dock (E), engine (5), drive out to the sonar buoy', 'Ping the sonar (6) by the buoy and copy its data (7)',
    'Run the battery flat: sonar and GPS go off, torch and paper map still work', 'Charge it at the generator (8) on the shore',
    'Go over the side in deep water (E away from the dock): breath and cold, then reach the shallows and the hut', 'Leave by the dry exit on foot, no boat needed'],
  G06: ['Cover the three corridors with overlapping cameras (A, B, C)', 'Remove one camera (5/6/7) and watch the alarm', 'Let the power fail (8) or recharge it (9)',
    'Sleep in the tent with full coverage', 'Find the blind spot behind the rock; move camera D past it (0)', 'Dogman mode (&proxy=dogman): walk the same route twice, then change it'],
  G09: ['Cross the river at the ford', 'Take supplies from the base cache (it never restocks)', 'Walk to the stones; 5 brings up the warning',
    'Walk away and leave by the trailhead (ordinary extraction)', 'Or choose Go on (G), then try to get home'],
  G07: ['Commit a module with no opening: nothing is spent', 'Wait for it to feed at the anchor; commit the wrong (heavy) module, then the light one (5 / Shift+5)',
    'Secure it and crate it (6)', 'Switch the generator off (0): watch integrity fall, then repair the crate (7)', 'Block the cargo route (L), try to stage (9); clear it and stage',
    'Haul the sled to the truck and deliver (9)', 'Release one (8) and walk out the foot path with your evidence'],
  G04: ['Approach the claw-marked stumps and heed the warning', 'Ignore the warning, then retreat', 'Break line of sight at hide A or B',
    'Bleed (fixed injury), notice the scent follower, bandage (B) and lose it', 'Recover the camera case in the core (5) or abandon it', 'Reach the extraction point by the safe edge route'],
};

export class GymHarness {
  constructor({ game, map, seed, blind = false }) {
    this.g = game; this.map = map; this.id = map.gym; this.seed = seed;
    this.events = []; this.tick = 0; this.time = 0;
    this.criteria = [];
    this.debugObjects = [];
    this.proxies = [];
    this.zones = new Map();
    const trace = (system, type, data = {}) => this.trace(system, type, data);
    const debug = (o) => this.debugObjects.push(o);
    const notify = (m) => game.photo?.toast?.(m);
    if (this.id === 'G03') this.proxies.push(new ContourProxy({ scene: game.scene, clues: game.clues, trace, debug }));
    if (this.id === 'G04') {
      const which = new URLSearchParams(location.search).get('proxy') ?? 'both';
      if (which !== 'scent') this.proxies.push(this.territory = new TerritoryProxy({ scene: game.scene, trace, debug, notify, captions: game.captions }));
      if (which !== 'territory') this.proxies.push(this.scentProxy = new ScentProxy({ scene: game.scene, scent: game.scent, trace }));
      this.world = new G04World({ game, map, trace, notify });   // the gear cache and the withdrawal record (#141)
      addEventListener('keydown', (e) => { if (!e.repeat && game.input.locked && e.code === 'Digit5') this.world.grab(); });
    }
    if (this.id === 'G05') {
      this.world = new G05World({ game, map, trace, storm: new URLSearchParams(location.search).has('storm'), notify });
      this.proxies.push(this.world.proxy);
      this.world.proxy.mesh.name = 'gym-proxy-mugwump'; debug(this.world.proxy.mesh);
      const keys = { Digit5: () => this.world.setEngine(!this.world.boat.engine), Digit6: () => this.world.ping(), Digit7: () => this.world.copyBuoy(),
        Digit8: () => this.world.runGenerator(!this.world.generator.running), KeyE: () => (this.world.boat.aboard ? this.world.leave() : this.world.board()) };
      addEventListener('keydown', (e) => { if (!e.repeat && game.input.locked && keys[e.code]) keys[e.code](); });
    }
    if (this.id === 'G06') {
      this.world = new G06World({ game, map, trace, notify, mode: new URLSearchParams(location.search).get('proxy') === 'dogman' ? 'dogman' : 'hidebehind' });
      this.proxies.push(this.world.proxy);
      debug(this.world.proxy.mesh);
      const keys = { Digit5: () => this.world.toggleCam('A'), Digit6: () => this.world.toggleCam('B'), Digit7: () => this.world.toggleCam('C'),
        Digit8: () => this.world.setHub(!this.world.hub.on), Digit9: () => this.world.recharge(), Digit0: () => this.world.moveD(this.world.cams[3].x !== -26) };
      addEventListener('keydown', (e) => { if (!e.repeat && game.input.locked && keys[e.code]) keys[e.code](e); });
    }
    if (this.id === 'G09') {
      this.world = new G09World({ game, map, trace, notify });
      this.proxies.push(this.world.proxy);
      debug(this.world.proxy.mesh);
      const keys = { Digit5: () => this.world.commitStep(), Digit6: () => this.world.take('food'), Digit7: () => this.world.take('batteries'), KeyH: () => { this.world.leaving = true; } };
      addEventListener('keydown', (e) => { if (!e.repeat && game.input.locked && keys[e.code]) keys[e.code](e); });
    }
    if (this.id === 'G07') {
      this.world = new G07World({ game, map, trace, notify });
      this.proxies.push(this.world.proxy);
      debug(this.world.proxy.mesh);
      const keys = { Digit5: (e) => this.world.commit(e.shiftKey ? 'heavy' : 'light'), Digit6: () => this.world.secureAndCrate(), Digit7: () => this.world.repair(),
        Digit8: () => this.world.release(), Digit9: () => this.world.stageOrDeliver(), Digit0: () => this.world.setGenerator(!this.world.generator.running),
        KeyL: () => this.world.setRouteBlocked(!this.world.routeBlocked) };
      addEventListener('keydown', (e) => { if (!e.repeat && game.input.locked && keys[e.code]) keys[e.code](e); });
    }
    this.fixture();
    this.watch();
    this.buildHud();
    this.setBlind(blind);
  }

  /** The fixed starting state: reserves, kit, injuries (G04 starts hurt and bleeding). */
  fixture() {
    const g = this.g, s = g.survival;
    if (g.huntFailure) g.huntFailure.enabled = this.id === 'G04';     // only G04 can end in a "caught"
    s.nutrition.energy = 80; s.thermo.core = 37; s.thermo.wetness = 0; s.fatigue && (s.fatigue.value = 20);
    if (s.hydration) s.hydration.value = 80;
    g.player.stamina = 1;
    if (this.id === 'G03') { g.fieldKit.carried.tent = 1; g.fieldKit.carried.fireKit = 2; }
    if (this.id === 'G04') {
      s.health.value = 70;
      s.health.injure({ cause: 'gym fixture: torn arm', damage: 0, wound: 'bleeding', severity: 'light' });
    }
    // The G03 false trace: a short line of ordinary deer prints by the west loop.
    if (this.id === 'G03') {
      const f = this.map.landmarks.falseTrace;
      this.falseTrace = [];
      for (let i = 0; i < 8; i++) this.falseTrace.push(g.clues.spawn('deerTrack', { cryptidId: 'deer', position: { x: f.x + i * 0.9, y: 0, z: f.z - i * 0.4 },
        rotationY: -1.1, origin: { x: f.x, z: f.z }, data: { source: { origin: 'ordinary', species: 'deer' } } }));
    }
  }

  trace(system, type, data = {}) {
    this.events.push({ i: this.events.length, tick: this.tick, system, type, data });
  }

  /** Poll owned state each step and trace changes (no system is modified to report). */
  watch() {
    const g = this.g;
    this.seen = { health: g.survival.health.log.length, journal: g.journal.entries.length, evidence: g.evidence.items.length,
      sleep: g.fieldCamp?.sleepLog.length ?? 0, band: g.survival.thermo.band, wet: 0, winded: false, bleeding: g.survival.health.bleeding.length };
  }

  poll() {
    const g = this.g, w = this.seen, s = g.survival, p = g.player.position;
    for (; w.health < s.health.log.length; w.health++) { const e = s.health.log[w.health]; this.trace('health', 'event', { cause: e.cause, damage: e.damage, wound: e.wound, after: e.healthAfter }); }
    for (; w.journal < g.journal.entries.length; w.journal++) { const e = g.journal.entries[w.journal]; this.trace('clues', 'examined', { clue: e.clueId, type: e.type }); }
    for (; w.evidence < g.evidence.items.length; w.evidence++) { const e = g.evidence.items[w.evidence]; this.trace('evidence', 'collected', { item: e.id, type: e.type, clue: e.clueId }); }
    for (; w.sleep < (g.fieldCamp?.sleepLog.length ?? 0); w.sleep++) { const e = g.fieldCamp.sleepLog[w.sleep]; this.trace('camp', 'slept', { fatigue: [e.fatigueBefore, e.fatigueAfter], woke: e.woke }); }
    if (s.thermo.band !== w.band) { this.trace('thermo', 'band', { from: w.band, to: s.thermo.band }); w.band = s.thermo.band; }
    const wetBand = s.thermo.wetness >= 70 ? 2 : s.thermo.wetness >= 30 ? 1 : 0;
    if (wetBand !== w.wet) { this.trace('thermo', 'wetness', { band: ['dry', 'wet', 'soaked'][wetBand] }); w.wet = wetBand; }
    if (g.player.exhausted !== w.winded) { this.trace('exertion', g.player.exhausted ? 'winded' : 'recovered', {}); w.winded = g.player.exhausted; }
    const bleed = s.health.bleeding.length;
    if (bleed !== w.bleeding) { this.trace('health', bleed ? 'bleeding' : 'bleeding-stopped', {}); w.bleeding = bleed; }
    for (const [name, l] of Object.entries(this.map.landmarks ?? {})) {
      const inside = Math.hypot(p.x - l.x, p.z - l.z) < 3.5;
      if (inside && !this.zones.get(name)) this.trace('player', 'reached', { place: name });
      this.zones.set(name, inside);
    }
  }

  /** One sim step (called from the game's simulate). */
  update(dt) {
    this.tick++; this.time += dt;
    const g = this.g;
    for (const p of this.proxies) p.update?.(dt, { player: g.player, health: g.survival.health });
    this.world?.update?.(dt);
    this.poll();
  }

  /** Hash of the trace and the final state: equal digests = the same run. */
  get digest() {
    const g = this.g, p = g.player.position;
    const w = this.world;
    const state = { tick: this.tick, p: [p.x, p.z].map((v) => +v.toFixed(3)),
      ...(w && this.id === 'G04' ? { cache: w.cache.state } : {}),   // G04's camera case (#141)
      ...(w?.cache && this.id !== 'G04' ? { phase: w.phase, outcome: w.outcome, cache: { ...w.cache }, mimic: w.mimicry.length } : {}),
      ...(w?.hb ? { hb: [w.hb.x, w.hb.z].map((v) => +v.toFixed(3)), hub: +w.hub.charge.toFixed(3), dog: w.dogman ? [w.dogman.position.x, w.dogman.position.z].map((v) => +v.toFixed(3)) : null } : {}),
      ...(w?.machine ? { capture: w.state, integrity: +w.machine.integrity.toFixed(3), condition: +w.machine.condition.toFixed(3), charges: [w.modules.light.charges, w.modules.heavy.charges] } : {}),
      ...(w?.boat ? { fuel: +w.boat.fuel.toFixed(4), charge: +w.power.charge.toFixed(3), breath: +w.breath.value.toFixed(3), boat: [w.boat.x, w.boat.z].map((v) => +v.toFixed(3)) } : {}), health: +g.survival.health.value.toFixed(3),
      energy: +g.survival.nutrition.energy.toFixed(3), core: +g.survival.thermo.core.toFixed(3), wet: +g.survival.thermo.wetness.toFixed(3),
      proxies: this.proxies.map((x) => [(x.pos ?? x).x, (x.pos ?? x).z].map((v) => +v.toFixed(3))) };
    return (hash32(JSON.stringify({ events: this.events, state })) >>> 0).toString(16);
  }

  setCriteria(list) { this.criteria = list; this.render(); }

  setBlind(on) {
    this.blind = on;
    for (const o of this.debugObjects) o.visible = !on;
    for (const c of this.falseTrace ?? []) if (c.object) c.object.userData.debugTag = !on;
    this.render();
  }

  reset() { location.reload(); }

  /** G05 readouts: fuel, battery and what it powers, breath, buoy data (not answers: you'd know these). */
  worldHud() {
    if (this.id === 'G04') {   // the gear cache and the withdrawal record (#141)
      const c = this.world.cache, wd = this.world.withdrawal;
      return `<div style="margin-top:4px">${c.name} ($${c.value}): <b>${c.state}</b>${wd ? ` · withdrawal: ${wd.decision}, gear lost $${wd.gearLost}` : ''}</div><div style="color:#8fa89a">5 pick up the case (beside it) · B bandage</div>`;
    }
    const w = this.world, d = w.deviceStatus(), b = w.boat;
    return `<div style="margin-top:4px">${w.storm ? 'STORM' : 'calm'} · boat ${b.aboard ? 'aboard' : 'at ' + b.x.toFixed(0) + ',' + b.z.toFixed(0)} · engine ${b.engine ? 'ON' : 'off'} · fuel ${Math.round(b.fuel * 100)}%</div>
      <div>battery ${Math.round(w.power.charge)}% · ${Object.entries(d).map(([k, v]) => `${k} ${v ? 'ok' : 'OFF'}`).join(' · ')}</div>
      <div>generator ${w.generator.running ? 'running' : 'off'} (fuel ${Math.round(w.generator.fuel * 100)}%) · breath ${Math.round(w.breath.value)} s · buoy data ${w.buoy.readings.length} (copied ${w.buoy.copied.length})</div>
      <div style="color:#8fa89a">E board/leave · 5 engine · 6 sonar · 7 copy buoy · 8 generator</div>`;
  }

  /** G09 readouts: phase, cache, what changed, what was heard. */
  finaleHud() {
    const w = this.world;
    return `<div style="margin-top:4px">finale: <b>${w.phase}</b>${w.outcome ? ' · ' + w.outcome : ''} · cache food ${w.cache.food} · batteries ${w.cache.batteries} · fuel ${w.cache.fuel}</div>
      <div>${w.changed.length ? 'changed: ' + w.changed.join(', ') : 'landmarks as they were'} · heard ${w.mimicry.length} false call${w.mimicry.length === 1 ? '' : 's'}</div>
      <div style="color:#8fa89a">5 at the stones: the warning (G go on, T turn back) · 6 take food · 7 take batteries · H at the trailhead to leave</div>`;
  }

  /** G06 readouts: cameras (live / dark / removed), hub, alarm, and the proxy's progress (debug). */
  securityHud() {
    const w = this.world;
    return `<div style="margin-top:4px">cameras: ${w.cams.map((c) => `${c.id} ${c.removed ? 'removed' : w.camLive(c) ? 'live' : 'dark'}`).join(' · ')} · hub ${w.hub.on ? 'on' : 'OFF'} ${Math.round(w.hub.charge)}%</div>
      <div>alarm: ${w.hb.warned != null ? 'TRIPPED at ' + w.hb.warned + ' s' : 'quiet'}${w.hb.intruded != null ? ' · INTRUSION' : ''} · mode ${w.mode}</div>
      <div style="color:#8fa89a">5/6/7 camera A/B/C · 8 hub · 9 recharge · 0 move camera D past the rock</div>`;
  }

  /** G07 readouts: capture state, the two gauges, charges, crate, generator, route. */
  captureHud() {
    const w = this.world, m = w.machine;
    return `<div style="margin-top:4px">capture: <b>${m.state}</b>${m.deliverable ? '' : ' (non-deliverable)'} · integrity ${Math.round(m.integrity)}${m.integrity < 40 ? ' ⚠' : ''} · condition ${Math.round(m.condition)}${m.condition < 35 ? ' ⚠' : ''}</div>
      <div>charges: light ${w.modules.light.charges} · heavy ${w.modules.heavy.charges} · crate repairs ${w.crate.repairs} · generator ${w.generator.running ? 'running' : 'OFF'} · route ${w.routeBlocked ? 'BLOCKED' : 'clear'} · paid ${w.paid.length}</div>
      <div style="color:#8fa89a">5 commit light · Shift+5 heavy · 6 secure+crate · 7 repair · 8 release · 9 stage/deliver · 0 generator · L log</div>`;
  }

  // ---- HUD ---------------------------------------------------------------------------------
  buildHud() {
    const el = this.el = document.createElement('div');
    el.id = 'gym-hud';
    Object.assign(el.style, { position: 'fixed', right: '8px', top: '8px', width: '330px', maxHeight: '92vh', overflowY: 'auto', zIndex: '30',
      background: 'rgba(10,14,18,0.86)', border: '1px solid #4a6a5a', color: '#d8e4dc', font: '11px/1.45 monospace', padding: '8px 10px', pointerEvents: 'auto' });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'reset') this.reset();
      if (a === 'blind') this.setBlind(!this.blind);
      if (a === 'run') this.onRun?.();
    });
    document.body.append(el);
    setInterval(() => this.render(), 400);
    this.render();
  }

  render() {
    if (!this.el) return;
    const g = this.g, s = g.survival, p = g.player.position;
    const link = (id, map) => `<a href="?map=${map}" style="color:${this.map.gym === id ? '#ffd88a' : '#9ac0b0'};margin-right:8px">${id}</a>`;
    const btn = (a, t) => `<button data-a="${a}" style="font:11px monospace;margin-right:6px;background:#1d2a24;color:#d8e4dc;border:1px solid #4d7a64;cursor:pointer">${t}</button>`;
    const status = { pass: '#8fe08a', fail: '#ff8a7a', not_evaluated: '#a8a8a8' };
    const answers = this.blind ? '<div style="color:#a8a8a8">BLIND MODE: debug answers hidden</div>' : [
      ...this.proxies.map((x) => `<div>${x.mesh.name.replace('gym-proxy-', '')}: <b>${x.state ?? 'scheduled'}</b> @ ${(x.pos ?? x).x.toFixed(1)}, ${(x.pos ?? x).z.toFixed(1)}</div>`),
      ...(this.falseTrace ? [`<div>ordinary trace: deer prints @ ${this.map.landmarks.falseTrace.x}, ${this.map.landmarks.falseTrace.z}</div>`] : []),
      `<div style="color:#8fa89a;margin-top:4px">TRACE (last 6 of ${this.events.length})</div>`,
      ...this.events.slice(-6).map((e) => `<div style="color:#b8c8c0">${e.tick} ${e.system}.${e.type} ${JSON.stringify(e.data).slice(0, 60)}</div>`),
    ].join('');
    this.el.innerHTML = `<div style="font-weight:bold;color:#ffd88a">${this.map.title}</div>
      <div>${link('G00', 'gym')}${link('G02', 'g02')}${link('G03', 'g03')}${link('G04', 'g04')}${link('G05', 'g05')}${link('G06', 'g06')}${link('G07', 'g07')}${link('G09', 'g09')}</div>
      <div>seed ${this.seed} · tick ${this.tick} · ${this.blind ? 'blind' : 'debug'}</div>
      <div style="margin:4px 0">${btn('reset', 'Reset')}${btn('run', 'Run script')}${btn('blind', this.blind ? 'Debug view' : 'Blind mode')}</div>
      <div>health ${Math.round(s.health.value)}${s.health.bleeding.length ? ' (bleeding)' : ''} · energy ${Math.round(s.nutrition.energy)} · body ${s.thermo.core.toFixed(1)}°C · wet ${Math.round(s.thermo.wetness)}% · stamina ${Math.round(g.player.stamina * 100)}% · you @ ${p.x.toFixed(1)}, ${p.z.toFixed(1)}</div>
      ${this.id === 'G04' && this.world ? this.worldHud() : this.world?.boat ? this.worldHud() : this.world?.machine ? this.captureHud() : this.world?.cams ? this.securityHud() : this.world?.cache ? this.finaleHud() : ''}
      <div style="color:#8fa89a;margin-top:4px">TASKS</div>${(GYM_TASKS[this.id] ?? []).map((t) => `<div>· ${t}</div>`).join('')}
      <div style="margin-top:4px">${answers}</div>
      ${this.criteria.length ? `<div style="color:#8fa89a;margin-top:4px">PASS CRITERIA</div>${this.criteria.map((c) => `<div><span style="color:${status[c.status]}">${c.status.toUpperCase()}</span> ${c.text}</div>`).join('')}` : ''}`;
  }
}
