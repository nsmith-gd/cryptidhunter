import * as THREE from 'three';
import { Input } from '../input.js';
import { Player } from '../player.js';
import { Flashlight } from '../flashlight.js';
import { PixelPipeline } from '../render/pixelPipeline.js';
import { FixedStepLoop } from '../core/simLoop.js';
import { setSeed, stream, randomSeed } from '../core/rng.js';
import { setGroundHeight } from '../maps/ground.js';
import { Thermoregulation, THERMO } from '../survival/thermoregulation.js';
import { Nutrition } from '../survival/nutrition.js';
import { Camp } from '../hunt/camp.js';
import { Ledger, formatCAD } from '../economy/ledger.js';
import { layoutFor, audit, PLACES, cellToWorld } from './tunnelLayout.js';
import { buildTunnelMap } from './tunnelMap.js';
import { TunnelMonster } from './tunnelMonster.js';
import { PhotoCamera } from '../hunt/photoCamera.js';
import { gradeOf } from '../evidence/quality.js';
import { TutorialCareer, freshL01, L01 } from './tutorialCareer.js';

// L01 Cabbagetown tunnels: the tutorial expedition, and the G01 tunnel gym (?gym).
// GDD 1.5 L01, 2.10, 5.4, 6.1, 6.6 #1, 9 (tutorial death), 12.2, 13.x (HUD), 15.2 G01.
//
// Engaged: S01 nutrition and S02 thermoregulation (the only physiological pressures), S03 a small
// pack, S04 navigation by landmarks and painted signs (no arrow), S05 the torch (no battery meter
// in the tutorial). No stamina, thirst, sleep, medical or fuel. The creature only watches and
// retreats. The one way to die is lingering in the deep culvert water past every warning: the
// cold turns critical and you black out; on the tutorial you restart at the entry, no new fee.
//
// URL: ?gym (G01 gym: fixed seed, in-session fixture career, F9 reset, F7 export the event trace)
//      ?seed=N (layout seed), ?cleared (gym fixture: tutorial already cleared, entrance stays open)

const q = new URLSearchParams(location.search);
const GYM = q.has('gym');
const KEY_FIXTURE = 'l01-gym-fixture';

// ---- career: the real save, or the gym's fixture (never touches the real save) --------------
let camp = null, career, fixture = null;
if (GYM) {
  try { fixture = JSON.parse(sessionStorage.getItem(KEY_FIXTURE) ?? 'null'); } catch { fixture = null; }
  if (!fixture) {
    fixture = { ledger: new Ledger().toJSON(), l01: freshL01(), seq: 0 };
    if (q.has('cleared')) fixture.l01.cleared = true;
  }
  const ledger = Ledger.fromJSON(fixture.ledger) ?? new Ledger();
  career = new TutorialCareer({ ledger, state: fixture.l01, newId: () => `G01-A${++fixture.seq}` });
} else {
  camp = new Camp();
  camp.state.l01 ??= freshL01();
  career = new TutorialCareer({ ledger: camp.ledger, state: camp.state.l01, newId: () => camp.newAttemptId() });
}
const saveCareer = () => {
  if (GYM) { fixture.ledger = career.ledger.toJSON(); try { sessionStorage.setItem(KEY_FIXTURE, JSON.stringify(fixture)); } catch { /* private mode */ } }
  else camp.save();
};

const entry = career.enter();
// One seed per attempt (a retry after a tutorial death replays the same tunnels).
if (career.s.open && career.s.open.seed == null) career.s.open.seed = GYM ? (Number(q.get('seed')) || 101) : (Number(q.get('seed')) || randomSeed());
saveCareer();
const seed = career.s.open?.seed ?? (Number(q.get('seed')) || 101);
setSeed(seed);
const layout = layoutFor(stream('l01-layout'));
const layoutAudit = audit(layout);

// ---- event trace (G01: every run is a replayable list of what happened) --------------------
const trace = [];
let simTime = 0;
const log = (type, data = {}) => {
  trace.push({ t: +simTime.toFixed(2), type, ...data });
  if (gymPanel) gymPanel.render();
};

// ---- renderer, scene, camera ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 120);
scene.add(camera);                 // the torch rides on the camera
scene.add(new THREE.HemisphereLight(0x46506a, 0x120c08, 0.22));   // just enough to read the tunnel's shape (GDD 12.1: navigable darkness)

const map = buildTunnelMap(scene, layout, { collapsed: false });
scene.background = new THREE.Color(map.environment.background);
scene.fog = new THREE.Fog(map.environment.fog.color, map.environment.fog.near, map.environment.fog.far);
setGroundHeight(map.heightAt);

const input = new Input(renderer.domElement);
const player = new Player(camera, input, map.colliders);
player.speedAt = map.speedAt;
player.position.set(map.playerStart.x, 0, map.playerStart.z);
player.yaw = map.playerStart.yaw;
// No stamina in the tutorial (GDD 2.10): sprinting never runs out (it just burns food faster).
player.updateStamina = function () { this.stamina = 1; this.exhausted = false; };
const flashlight = new Flashlight(camera, input);
flashlight.batteryLife = Infinity;      // the torch is not a meter in the tutorial (GDD 5.3)
flashlight.baseIntensity = 46;          // close brick walls soak up light: a stronger throw down here
flashlight.light.angle = THREE.MathUtils.degToRad(30);
const pixels = new PixelPipeline({ renderer, camera });

// ---- survival: hunger and temperature only ---------------------------------------------------
const thermo = new Thermoregulation({ player, airTemp: map.environment.airTemp, heatSources: () => map.heat, surfaceAt: map.surfaceAt });
const nutrition = new Nutrition({ player, food: { packedLunch: 0, trailSnack: 0 }, getCold: () => thermo.coldDeficit, start: 72 });
// Critical cold (shared health path, GDD 9): only reached by staying in the deep culvert at the
// edge of hypothermia. Health shows only once it starts to fall (GDD 13 HUD).
const EXPOSURE = { atCore: THERMO.floor + 0.15, drain: 1.6, recover: 4 };
let health = 100;
const pack = { lunch: false, furSample: null, dryClothes: true };
const found = new Set();
let collapsed = false, ended = false;

// ---- the creature ----------------------------------------------------------------------------
const audio = makeAudio();
// The tunnel creature (#123) on the shared cryptid framework: it rests in side chambers, creeps out
// to vantage points ahead of you, lingers at the edge of the light (the photo opportunity, longer
// the more careful you are), flinches from your torch and bolts from noise, rushing or closeness.
// It never attacks; scare it off often enough and it stays hidden; the level goes on either way.
const creature = new TunnelMonster({ scene, colliders: map.colliders, rand: stream('l01-creature'),
  senses: { player, flashlight, camera, colliders: map.colliders, lightLevel: 0.02 },
  onEvent: (type, d) => {
    if (!['showing', 'flinch', 'startled', 'slipped-away', 'gone', 'emerging'].includes(type)) return;
    const { cryptid, name, ...data } = d; void cryptid; void name;
    log(`creature-${type}`, data);
    if (type === 'startled') { audio.chitter(); toast(data.why === 'your light' ? 'It flinches from your light, chitters and scuttles away.' : `Something chitters and scuttles away into the dark (${data.why}).`); }
    if (type === 'flinch') toast('Eyes flare in your torchlight. It rears back. Quick.', 2);
    if (type === 'gone') toast('Whatever it was, it has gone deep. You won\'t see it again tonight.', 5);
  } });
// The camera (F01 still camera, 12 shots): hold right mouse to raise it, left-click to shoot. Each
// shot is graded from the light really on the subject, the steadiness and the framing (GDD 4.5).
const photo = new PhotoCamera({ camera, scene, input, getSubjects: () => creature.subjects(), canvas: renderer.domElement, film: 12,
  evidenceContext: () => ({ ambient: 0.03, time: simTime, attemptId: entry.attemptId ?? 'L01' }),
  onPhoto: (r) => log('photo', { subject: r.subject, distance: r.subject ? +r.distance.toFixed(1) : null, score: r.score }) });

// ---- HUD ---------------------------------------------------------------------------------------
const css = document.createElement('style');
css.textContent = `
#l01-hud { position: fixed; left: 10px; top: 10px; color: #d6d0c0; font: 12px monospace; text-shadow: 0 0 3px #000; line-height: 1.5; pointer-events: none; }
#l01-hud .bar { display: inline-block; width: 90px; height: 7px; background: #0008; border: 1px solid #fff3; vertical-align: middle; margin: 0 6px; }
#l01-hud .bar i { display: block; height: 100%; }
#l01-warn { position: fixed; left: 10px; top: 92px; font: 12px monospace; color: #ffcf7a; text-shadow: 0 0 3px #000; pointer-events: none; max-width: 46vw; }
#l01-warn .n2 { color: #ff8a6a; }
#l01-prompt { position: fixed; left: 50%; top: 58%; transform: translateX(-50%); font: 13px monospace; color: #fff; text-shadow: 0 0 4px #000; pointer-events: none; }
#l01-toast { position: fixed; left: 50%; bottom: 70px; transform: translateX(-50%); font: 13px monospace; color: #f2ead2; text-shadow: 0 0 4px #000; pointer-events: none; text-align: center; max-width: 70vw; transition: opacity .6s; }
#l01-pack { position: fixed; left: 10px; bottom: 10px; font: 11px monospace; color: #b8b2a2; text-shadow: 0 0 3px #000; pointer-events: none; }
#l01-cross { position: fixed; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1px; background: #fff7; }
.l01-screen { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #000c; color: #ddd; font: 14px monospace; text-align: center; line-height: 1.6; z-index: 5; }
.l01-screen.hidden { display: none; }
.l01-screen > div { max-width: 600px; padding: 16px; }
.l01-screen b.t { font-size: 20px; letter-spacing: 3px; }
#l01-notes { position: fixed; right: 12px; top: 40px; font: 12px monospace; color: #d6d0c0; background: #000b; padding: 10px 14px; border: 1px solid #fff2; display: none; line-height: 1.6; }
#l01-gym { position: fixed; right: 10px; top: 8px; font: 11px monospace; color: #9fd; text-shadow: 0 0 3px #000; text-align: right; pointer-events: none; white-space: pre; }
`;
document.head.append(css);
const el = (id, tag = 'div') => { const e = document.createElement(tag); e.id = id; document.body.append(e); return e; };
const hud = el('l01-hud'), warnEl = el('l01-warn'), promptEl = el('l01-prompt'), toastEl = el('l01-toast'), packEl = el('l01-pack'), notesEl = el('l01-notes');
el('l01-cross');
let toastTimer = 0;
function toast(text, secs = 4) { toastEl.textContent = text; toastEl.style.opacity = '1'; toastTimer = secs; }

function renderHud() {
  const e = nutrition.energy, core = thermo.core;
  const bar = (v, col) => `<span class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${col}"></i></span>`;
  let h = `HUNGER ${bar(e, e > 50 ? '#9c6' : e > 25 ? '#dc6' : '#e64')} ${nutrition.band}<br>`;
  h += `BODY&nbsp;&nbsp; ${bar((core - 34) / 3.6 * 100, core >= THERMO.comfortLow ? '#7bd' : core >= THERMO.coldBelow ? '#9ad' : '#c9f')} ${core.toFixed(1)}°C ${thermo.band}${thermo.nearHeat ? ' · warming' : ''}<br>`;
  if (thermo.wetness > 1) h += `WET&nbsp;&nbsp;&nbsp; ${bar(thermo.wetness, '#58a')} ${Math.round(thermo.wetness)}%<br>`;
  if (health < 100) h += `HEALTH ${bar(health, '#e55')} ${Math.round(health)}<br>`;
  hud.innerHTML = h;
  // Warnings name their cause (GDD 2.11).
  const w = [...thermo.warnings(), ...nutrition.warnings().map((x) => ({ ...x, text: x.text.replace('stamina recovers slower', 'you tire and slow down').replace('stamina recovers much slower', 'you are slow and weak') }))];
  if (thermo.warnings().some((x) => x.id === 'cold')) w.forEach((x) => { if (x.id === 'cold') x.text = x.text.replace('stamina recovers slower', 'you move slower').replace('find a fire', 'find somewhere warm'); });
  if (exposed()) w.unshift({ id: 'freezing', level: 2, text: 'FREEZING: the cold water is overwhelming you. Get out of the water now and get warm' });
  warnEl.innerHTML = w.map((x) => `<div class="n${x.level}">${x.level >= 2 ? '⚠ ' : ''}${x.text}</div>`).join('');
  const kit = [`packed lunch${pack.lunch ? ` ×${nutrition.food.packedLunch}` : ' (lost!)'}`, pack.dryClothes ? 'dry clothes (X)' : 'clothes: changed', `sample pouch${pack.furSample ? ': fur' : ''}`, 'torch (F)', 'camera', 'sketchbook'];
  packEl.textContent = `PACK 12 L · ${kit.join(' · ')}   ·   Z eat · Tab notes`;
}
function exposed() { return thermo.core <= EXPOSURE.atCore && thermo.inWater !== 'dry'; }

function renderNotes() {
  const places = [...found];
  notesEl.innerHTML = `<b>FIELD NOTES</b><br>Places I've found: ${places.length ? places.join(', ') : 'none yet'}<br>` +
    `Cash: ${formatCAD(career.ledger.cash)} · trip cost ${formatCAD(L01.tripCents)} (attempt ${career.s.open?.id ?? '-'})<br>` +
    `Kit: ${L01.kit.join(', ')}<br><small>${collapsed ? 'The stair I came down has caved in. There must be another way up.' : career.entranceCollapses ? '' : 'The stair I came down is still open behind me.'}</small>`;
}

// ---- interactions -----------------------------------------------------------------------------
const interactables = () => {
  const list = [];
  if (!pack.lunch) list.push({ id: 'lunch', obj: map.props.lunch, text: 'E · pick up your packed lunch' });
  if (!pack.furSample) list.push({ id: 'fur', obj: map.props.fur, text: 'E · bag the tuft of coarse fur (sample pouch)', reach: 2.4 });
  list.push({ id: 'exit', pos: map.props.exit.position, text: 'E · climb the ladder up to the street hatch', reach: 2.6 });
  if (!collapsed && !career.entranceCollapses) list.push({ id: 'stair', pos: map.props.entrance.position, text: 'E · climb back up the stair to the street', reach: 3 });
  return list;
};
let target = null;
function pickTarget() {
  const eye = camera.position, fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  target = null;
  for (const it of interactables()) {
    const p = it.pos ?? it.obj.getWorldPosition(new THREE.Vector3());
    const flat = Math.hypot(p.x - eye.x, p.z - eye.z);
    if (flat > (it.reach ?? 2.0)) continue;
    const to = p.clone().sub(eye); to.y = Math.min(0, to.y);
    if (flat > 0.8 && fwd.angleTo(to) > THREE.MathUtils.degToRad(55)) continue;
    target = it; break;
  }
  promptEl.textContent = target?.text ?? '';
}
function interact() {
  if (!target || ended) return;
  if (target.id === 'lunch') {
    pack.lunch = true; nutrition.food.packedLunch = 1; map.props.lunch.visible = false;
    toast('Your packed lunch. It must have flown out of your pack when the stair went. (Z to eat)'); log('pickup', { item: 'packed lunch' });
  } else if (target.id === 'fur') {
    pack.furSample = { kind: 'fur', eventId: `fur-${seed}-${layout.trace.x}-${layout.trace.y}` }; map.props.fur.visible = false;
    toast('A tuft of coarse, oily fur, caught on the grate. Not a raccoon. Into the sample pouch.'); log('pickup', { item: 'fur sample', optionalEvidence: true });
  } else if (target.id === 'exit') escape('the maintenance ladder');
  else if (target.id === 'stair') escape('the entrance stair');
}
addEventListener('keydown', (e) => {
  if (!input.locked || e.repeat || ended) return;
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyZ') {
    const r = nutrition.eat();
    toast(r ? `You eat your ${r.name.toLowerCase()}. Better. (+${r.energy} energy)` : pack.lunch ? 'Nothing left to eat.' : 'Your lunch isn\'t in your pack. You dropped it somewhere near the stair.');
    if (r) log('eat', { food: r.name });
  }
  if (e.code === 'KeyX') {
    if (!pack.dryClothes) toast('You already changed into your dry clothes.');
    else if (thermo.inWater !== 'dry') toast('Not while you\'re standing in water.');
    else { pack.dryClothes = false; const was = thermo.wetness; thermo.wetness = 0; toast(was > 10 ? 'You change into your dry clothes. Much better.' : 'You change into your dry clothes (you were barely damp).'); log('dry-clothes', { wetnessBefore: Math.round(was) }); }
  }
  if (e.code === 'Tab') { e.preventDefault(); renderNotes(); notesEl.style.display = notesEl.style.display === 'block' ? 'none' : 'block'; }
});

// ---- the collapse (first attempt) ---------------------------------------------------------------
let shake = 0;
function maybeCollapse() {
  if (collapsed || !career.entranceCollapses) return;
  const s = cellToWorld(PLACES.start);
  if (Math.hypot(player.position.x - s.x, player.position.z - s.z) < 7) return;
  collapsed = true;
  map.collapse();
  shake = 0.9;
  audio.rumble();
  toast('With a roar, the stairway behind you caves in. Dust everywhere. You\'ll have to find another way out.', 7);
  log('entrance-collapsed', {});
}

// ---- outcomes -------------------------------------------------------------------------------------
const screen = (id) => { const d = document.createElement('div'); d.id = id; d.className = 'l01-screen hidden'; document.body.append(d); return d; };
const endScreen = screen('l01-end');
function escape(via) {
  if (ended) return;
  ended = true;
  const evidence = pack.furSample ? [pack.furSample] : [];
  // Your best photo of the creature (one sighting event): its grade sets the offer, GDD 4.7
  // round(T × 0.01 × 35 × M) with T = $250 at L01. A grade-0 frame is no evidence.
  const best = photo.records.filter((x) => x.kind === 'creature').sort((a, b) => b.quality.Q - a.quality.Q)[0];
  const g = best && gradeOf(best.quality.Q);
  if (best && g.M > 0) evidence.push({ kind: 'photo', eventId: best.eventId, cents: Math.round(250 * 0.01 * 35 * g.M) * 100, label: `Creature photo (${g.name}, quality ${best.quality.Q})`, grade: g, Q: best.quality.Q });
  const r = career.escape(evidence, via);
  saveCareer();
  log('escaped', { via, minutes: +(simTime / 60).toFixed(1), evidence: evidence.map((x) => x.kind), creatureClosest: +creature.closest.toFixed(1) });
  const st = r.settlement, paid = st.gross;
  document.exitPointerLock?.();
  endScreen.innerHTML = `<div><b class="t">YOU GOT OUT</b><br><i>Up ${via}, into the cold night air. ${fmtTime(simTime)} underground.</i><br><br>` +
    `Trip cost: ${formatCAD(-st.expense)}<br>` +
    (pack.furSample ? `Fur sample (compelling physical trace)<br>` : '') +
    (evidence.find((x) => x.kind === 'photo') ? `${evidence.find((x) => x.kind === 'photo').label}<br>` : best ? `Your best photo of it was too poor to count (${best.quality.problems?.[0] ?? 'grade 0'})<br>` : '') +
    (evidence.length ? `Evidence paid: ${paid ? `+${formatCAD(paid)}` : 'already sold before: $0'}<br>` : 'No evidence brought out: that\'s fine. Getting out was the job.<br>') +
    `Cash now: <b>${formatCAD(career.ledger.cash)}</b><br><br>` +
    (r.firstClear ? `<b>Tutorial cleared.</b> Next trip unlocked: <b>${r.unlocked.name}</b> (${r.unlocked.place}).<br>` : `Next trip available: <b>${r.unlocked.name}</b>.<br>`) +
    `<br><small>${GYM ? 'G01 gym · F9 reset · F7 export the event trace' : '<a href="./" style="color:#9cf">Back to base</a> · or reload to go down the tunnels again'}</small></div>`;
  endScreen.classList.remove('hidden');
}
function die() {
  if (ended) return;
  ended = true;
  const r = career.die('hypothermia');
  saveCareer();
  log('death', { cause: 'hypothermia (critical cold in the deep culvert)', tutorialRetry: r?.tutorialRetry });
  document.exitPointerLock?.();
  endScreen.innerHTML = `<div><b class="t">YOU BLACKED OUT</b><br><i>The cold water took everything you had.</i><br><br>` +
    (r?.tutorialRetry ? `This is the tutorial: you'll start again at the tunnel entry with the same kit.<br>No extra trip fee. Cash: ${formatCAD(career.ledger.cash)}.` : `The attempt is over. Cash: ${formatCAD(career.ledger.cash)}.`) +
    `<br><br><b id="l01-retry" style="cursor:pointer">Click to go back down</b></div>`;
  endScreen.classList.remove('hidden');
  endScreen.onclick = () => location.reload();
}

// ---- start / pause overlay ------------------------------------------------------------------------
const overlay = screen('l01-overlay');
overlay.classList.remove('hidden');
overlay.style.cursor = 'pointer';
overlay.innerHTML = entry.ok ? `<div><b class="t">01 · CABBAGETOWN TUNNELS</b><br><i>Toronto · ${entry.resumed && career.s.open?.retries ? 'second try' : 'late evening'}</i><br><br>` +
  `A neighbour swears something lives in the old service tunnels under the park. You've come down the maintenance stair with your hand-me-down kit to see for yourself.<br><br>` +
  `<b>Get back out.</b> Keep fed and keep warm; your torch and the old painted signs are all you have to find the way.<br>` +
  `Trip cost ${formatCAD(L01.tripCents)}${entry.charged ? ' (paid)' : entry.resumed ? ' (already paid)' : ''} · cash ${formatCAD(career.ledger.cash)}<br><br>` +
  `Something lives down here. If it shows itself, a clear photo is worth money, but it is shy: move quietly, keep your light off it, and let it come to the edge of the light.<br><br>` +
  `WASD move · mouse look · Shift hurry · Ctrl/C crouch · F torch · hold right mouse: camera, left-click: photo · E use / pick up · Z eat · X change into dry clothes · Tab field notes<br><br><b>Click to start</b>` +
  `${GYM ? `<br><small>G01 gym · seed ${seed} · F9 reset · F7 export trace</small>` : ''}</div>`
  : `<div><b class="t">01 · CABBAGETOWN TUNNELS</b><br><br>${entry.reason}</div>`;
overlay.addEventListener('click', () => { if (entry.ok && !ended) input.requestLock(); });
document.addEventListener('pointerlockchange', () => {
  overlay.classList.toggle('hidden', input.locked || ended);
  if (input.locked && !started) { started = true; log('attempt-start', { attemptId: entry.attemptId, resumed: entry.resumed, charged: entry.charged, cash: career.ledger.cash, seed, collapses: career.entranceCollapses }); }
});
let started = false;

// ---- G01 gym panel ------------------------------------------------------------------------------
const gymPanel = GYM ? (() => {
  const p = el('l01-gym');
  return { render() { p.textContent = `G01 TUNNEL GYM · seed ${seed}\nt ${fmtTime(simTime)} · ${trace.length} events · last: ${trace.at(-1)?.type ?? '-'}\nF9 reset · F7 export trace`; } };
})() : null;
addEventListener('keydown', (e) => {
  if (!GYM) return;
  if (e.code === 'F9') { e.preventDefault(); resetGym(); }
  if (e.code === 'F7') { e.preventDefault(); exportTrace(); }
});
function resetGym() { try { sessionStorage.removeItem(KEY_FIXTURE); } catch { /* ignore */ } location.reload(); }
function exportTrace() {
  const blob = new Blob([JSON.stringify({ gym: 'G01', seed, layout: layoutAudit, trace }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `g01-trace-seed${seed}.json`; a.click();
}

// ---- simulation ----------------------------------------------------------------------------------
let wasExposed = false, warnedVeryCold = false;
let lastBand = thermo.band, lastSurface = 'dry', lastHeat = null;
function simulate(dt) {
  if (ended || !input.locked) return;
  simTime += dt;
  player.update(dt);
  thermo.update(dt);
  nutrition.update(dt);
  // Hunger and cold slow you a little (capability; the GDD's floor still applies in the player).
  player.thermalPenalty = thermo.coldDeficit * 0.25 + nutrition.hungerDeficit * 0.15;
  if (exposed() && !wasExposed) log('exposure', { core: +thermo.core.toFixed(2), surface: thermo.inWater });
  if (thermo.band === 'very cold' && !warnedVeryCold) { warnedVeryCold = true; log('warning', { text: 'very cold' }); }
  wasExposed = exposed();
  if (exposed()) health = Math.max(0, health - EXPOSURE.drain * dt);
  else if (thermo.inWater === 'dry') health = Math.min(100, health + EXPOSURE.recover * dt * (thermo.nearHeat ? 2 : 1));
  if (health <= 0) { die(); return; }
  creature.update(dt);
  photo.update(dt);
  maybeCollapse();
  // Landmarks and places (S04 navigation: they go in your field notes).
  const c = map.cellAt(player.position.x, player.position.z);
  for (const k of ['junction', 'pumpRoom', 'grate', 'alcove', 'culvert']) {
    const pl = PLACES[k];
    if (!found.has(pl.name) && Math.abs(c.x - pl.x) <= 1 && Math.abs(c.y - pl.y) <= 1) {
      found.add(pl.name);
      toast({ junction: 'A faded mural of a heron. The tunnel splits three ways here.', pumpRoom: 'The old pump room. A rusted wheel as tall as you.', grate: 'Streetlight falls through an iron grate, high above. You can hear a car pass.', alcove: 'Warm air. An old steam main still runs hot along the wall.', culvert: 'The culvert is flooded. Freezing water over your boots.' }[k], 5);
      log('place-found', { place: pl.name, landmark: pl.landmark ?? null });
    }
  }
  const s = thermo.inWater;
  if (s !== lastSurface) { log(s === 'dry' ? 'left-water' : 'entered-water', { surface: s }); lastSurface = s; }
  if (thermo.nearHeat !== lastHeat) { if (thermo.nearHeat) log('warming', { at: thermo.nearHeat, core: +thermo.core.toFixed(2) }); lastHeat = thermo.nearHeat; }
  if (thermo.band !== lastBand) { log('temperature', { band: thermo.band, core: +thermo.core.toFixed(2) }); lastBand = thermo.band; }
  if (nutrition.band !== lastHunger) { log('hunger', { band: nutrition.band, energy: Math.round(nutrition.energy) }); lastHunger = nutrition.band; }
}
let lastHunger = nutrition.band;
function present(dt) {
  flashlight.update(dt);
  if (shake > 0) { shake -= dt; camera.rotation.z = Math.sin(performance.now() / 25) * 0.02 * Math.max(0, shake); }
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = '0'; }
  pickTarget();
  renderHud();
  if (gymPanel && Math.floor(simTime * 4) !== Math.floor((simTime - dt) * 4)) gymPanel.render();
  pixels.frame(() => renderer.render(scene, camera));
}
const sim = new FixedStepLoop({ simulate, present, tracked: () => [player] });
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => sim.frame(clock.getDelta()));
gymPanel?.render();

// ---- sound (no files: a little WebAudio) ----------------------------------------------------------
function makeAudio() {
  let ctx = null;
  const get = () => { try { ctx ??= new AudioContext(); } catch { ctx = null; } return ctx; };
  const noise = (secs, freq, gain) => {
    const c = get(); if (!c) return;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = b; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination); src.start();
  };
  return {
    rumble: () => noise(2.5, 220, 0.9),
    chitter: () => {
      const c = get(); if (!c) return;
      for (let i = 0; i < 5; i++) {
        const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.07;
        o.type = 'square'; o.frequency.setValueAtTime(900 + Math.random() * 500, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.07);
      }
    },
  };
}
function fmtTime(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; }

// Test / gym hooks.
window.__l01 = { THREE, scene, camera, renderer, player, input, flashlight, thermo, nutrition, map, layout, layoutAudit, career, creature, photo, trace, sim, pack, seed,
  get health() { return health; }, set health(v) { health = v; }, get simTime() { return simTime; }, get collapsed() { return collapsed; }, get ended() { return ended; },
  get target() { return target; }, exposed, interact, escape, exportTrace, resetGym, entry };
