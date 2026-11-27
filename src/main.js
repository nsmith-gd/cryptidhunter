import * as THREE from 'three';
import { setSeed, randomSeed, getSeed } from './core/rng.js';
import { FixedStepLoop } from './core/simLoop.js';
import { WebXRPresenter, PauseState, mountPauseScreen } from './xr/webxr.js';
import { ProfilingRecorder } from './profiling/recorder.js';
import { attachProbes } from './profiling/gameProbe.js';
import { ProfilerPanel } from './profiling/profilerPanel.js';
import { Input } from './input.js';
import { SaveService, memoryBackend } from './save/saveService.js';
import { Settings } from './settings/settings.js';
import { KeyRemap } from './settings/keyRemap.js';
import { GamepadControls } from './settings/gamepad.js';
import { Captions } from './settings/captions.js';
import { showSettingsPanel } from './settings/settingsPanel.js';
import { Player } from './player.js';
import { buildTestMap } from './testMap.js';
import { buildGymMap } from './maps/gymG00.js';
import { buildGymG02, buildGymG03, buildGymG04, GYM_SEEDS } from './maps/gymScenes.js';
import { GymHarness } from './gym/gymKit.js';
import { GYM_RUNS } from './gym/gymRuns.js';
import { buildGymG05 } from './gym/g05.js';
import { runG00 } from './gym/g00.js';
import { buildSwampMap } from './maps/swamp.js';
import { buildSimcoeMap } from './maps/simcoe.js';
import { buildForestMap } from './maps/forest.js';
import { setGroundHeight } from './maps/ground.js';
import { NightLighting } from './maps/nightLighting.js';
import { PixelWater } from './art/pixelWater.js';
import { Atmosphere, timeOfDayConfig } from './maps/atmosphere.js';
import { Flashlight } from './flashlight.js';
import { CryptidManager } from './cryptids/cryptidManager.js';
import { PROFILES } from './cryptids/profiles.js';
import { AIDebug } from './cryptids/aiDebug.js';
import { Rocks } from './cryptids/rocks.js';
import { WoodKnocks } from './cryptids/woodKnock.js';
import { ClueSystem } from './clues/clueSystem.js';
import { ClueTrails } from './clues/clueTrail.js';
import { FieldKit } from './gear/fieldKit.js';
import { Equipment, WEAR } from './gear/condition.js';
import { ScentField, SCENT_WORLD } from './cryptids/scent.js';
import { showEquipmentPanel } from './gear/equipmentPanel.js';
import { FieldCamp } from './survival/fieldCamp.js';
import { Weather } from './survival/weather.js';
import { getSpecies } from './cryptids/species.js';
import { Journal } from './journal/journal.js';
import { ClueFinder } from './journal/clueFinder.js';
import { JournalUI } from './journal/journalUI.js';
import { TrailReader } from './clues/trailReader.js';
import { Mothman, MOTHMAN } from './cryptids/mothman.js';
import { Chupacabra, CHUPA } from './cryptids/chupacabra.js';
import { BatteryPickups } from './pickups.js';
import { Hud } from './hud.js';
import { NoiseRing } from './noiseRing.js';
import { HuntFailure } from './hunt/huntFailure.js';
import { Viewmodel } from './gear/viewmodel.js';
import { HuntLoop, HUNT } from './hunt/huntLoop.js';
import { TextCard } from './story/textCard.js';
import { StoryCards } from './story/storyCards.js';
import { ReputationStub } from './story/reputation.js';
import { LevelFlow } from './hunt/levelFlow.js';
import { PhotoCamera } from './hunt/photoCamera.js';
import { TrailCameras } from './gear/trailCamera.js';
import { AudioLures, synthWhoop } from './gear/audioLure.js';
import { NightVision } from './gear/nightVision.js';
import { Fear } from './hunt/fear.js';
import { Dread, buildDreadAudio } from './hunt/dread.js';
import { Survival } from './survival/survival.js';
import { EvidenceKit } from './evidence/evidence.js';
import { spawnDeerTracks, spawnFoxTracks, spawnOwlFeathers } from './clues/deerTracks.js';
import { StatusModel } from './ui/statusModel.js';
import { StatusScreen } from './ui/statusScreen.js';
import { XRControls } from './xr/xrControls.js';
import { Camp, gearList, huntSummary, showCampPanel } from './hunt/camp.js';
import { showBountyPanel } from './hunt/bountyPanel.js';
import { applyUpgrades, showShopPanel } from './hunt/shop.js';
import { formatCAD } from './economy/ledger.js';
import { Loadout, showLoadoutPicker, ITEMS } from './gear/loadout.js';
import { FieldMap } from './nav/fieldMap.js';
import { resolveMap, showMapPicker, TARGET_BY_MAP, MAP_CHOICES, unlockContext } from './hunt/mapSelect.js';
import { fieldRecords, SPECIES } from './research/fieldRecords.js';
import { MILESTONE_NAMES } from './research/dossier.js';
import { Expedition, EXPEDITION, OUTCOMES, manifestText } from './hunt/expedition.js';
import { renderAlbum } from './hunt/album.js';
import { Supplier, showSupplierPanel, CATALOGUE } from './hunt/supplier.js';
import { chargeRecovery, gearAfter, deathReport } from './hunt/failureRules.js';
import { RecoveryAssignment } from './hunt/recoveryAssignment.js';
import { setKit } from './gear/pack.js';
import { EvidenceArchive, advance } from './evidence/photoEvidence.js';
import { BaitManager, BAIT } from './gear/bait.js';
import { PixelPipeline } from './render/pixelPipeline.js';
import { CinematicLighting } from './maps/cinematicLighting.js';

// Settings (#76) and key remapping: the remapper goes first so it runs before every key listener.
const settings = new Settings(new SaveService());
const keyRemap = new KeyRemap();


// One world seed per run (#66): ?seed=N replays a run exactly; otherwise a fresh one is logged.
// Gyms (#108) have a fixed default seed, so the fixture is the same every time.
const gymRun = ['g02', 'g03', 'g04', 'g05'].includes(new URLSearchParams(location.search).get('map'));
setSeed(Number(new URLSearchParams(location.search).get('seed')) || GYM_SEEDS[new URLSearchParams(location.search).get('map')] || randomSeed());
console.info(`[seed] ${getSeed()}  (add ?seed=${getSeed()} to replay this world)`);

// Render at a low internal resolution (~360 rows) and upscale by an exact integer with
// nearest-neighbour, snapping the view to whole pixels: see render/pixelPipeline.js.
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// Night: the test map is dark so the flashlight matters.
scene.background = new THREE.Color(0x05070b);
scene.fog = new THREE.Fog(0x05070b, 12, 45);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);   // near 0.1: depth precision for the ground layers (#61)

// Faint moonlight so silhouettes are just readable without the flashlight.
const hemi = new THREE.HemisphereLight(0x4a5a78, 0x0a0a0c, 0.12);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x8fa6d8, 0.08);
moon.position.set(15, 25, 10);
scene.add(moon);

// Base camp (money, gear, reputation, chosen map) is loaded first: it decides where you hunt.
// Gyms G02–G04 (#108) never touch your career: a fresh in-memory camp (the fixture) on every load.
const camp = gymRun ? new Camp(null, new SaveService(memoryBackend())) : new Camp();
// Equipment condition (#106, S11): the starter camera, torch and shoes are persistent instances whose
// condition (held in the ledger's asset record) drops with use, water and impact.
const equipment = new Equipment(camp);
// Map: chosen on the start screen (locked ones need reputation); ?map=forest|swamp overrides.
const MAPS = { test: buildTestMap, swamp: buildSwampMap, forest: buildForestMap, simcoe: buildSimcoeMap,   // simcoe: L03 greybox (#135)
  gym: buildGymMap,   // gym: G00 bench (#77)
  g02: buildGymG02, g03: buildGymG03, g04: buildGymG04, g05: buildGymG05 };                      // G05 (#138)                                          // gyms G02–G04 (#108)
const mapId = resolveMap(location.search, camp);
const huntTarget = TARGET_BY_MAP[mapId] ?? 'Bigfoot';
const map = (MAPS[mapId] ?? buildTestMap)(scene);
setGroundHeight(map.heightAt);    // sunken trail ruts (forest): feet, cryptids and ground clues follow the terrain
const { colliders, bounds, spawns } = map;
if (map.environment) {
  scene.background.set(map.environment.background);
  scene.fog.color.set(map.environment.fog.color);
  scene.fog.near = map.environment.fog.near;
  scene.fog.far = map.environment.fog.far;
}
if (spawns?.mothman) MOTHMAN.home.set(spawns.mothman.x, 0, spawns.mothman.z);
// Default is the greybox hunt (Bigfoot only). ?sandbox (and the swamp map) also bring in the other cryptid placeholders.
const sandbox = new URLSearchParams(location.search).has('sandbox') || mapId === 'swamp';
const input = new Input(renderer.domElement);
const player = new Player(camera, input, colliders);
player.speedAt = map.speedAt ?? null;
if (map.playerStart) { player.position.set(map.playerStart.x, 0, map.playerStart.z); player.yaw = map.playerStart.yaw ?? 0; }
// The night's hunt: briefing -> track -> photograph Bigfoot -> back to the van and leave (before dawn for a bonus).
// The extraction van parks at the map's exit spot (or 7 m behind the start). Built before the
// cryptids so it's baked into their walkable grid.
if (map.exit) HUNT.exit.set(map.exit.x, 0, map.exit.z);
else HUNT.exit.set(player.position.x + Math.sin(player.yaw) * 7, 0, player.position.z + Math.cos(player.yaw) * 7);
// Base camp: money, owned gear and past hunts carry over between hunts. This hunt's photos only
// count if you drive home from the van; getting caught loses them, gear comes home.
addEventListener('pagehide', () => camp.save());   // save on quit (money is also saved whenever it changes)
// Recovery assignment (#105, GDD 7.4): broke? A sponsor's local survey instead of a trip. While one is
// active you go out with the sponsor's loaner kit; your own gear stays at camp, untouched.
const sponsorSurvey = new RecoveryAssignment({ camp, mapId, tripCents: EXPEDITION.tripCents });
const packed = sponsorSurvey.active ? sponsorSurvey.loanerKit() : camp.packForHunt();
// Expedition lifecycle (#98): Plan on the start screen -> Commit (trip debited once, attempt ID)
// -> Investigate -> Extract (manifest review at the van) -> Debrief. Built after the loadout below.
let expedition = null;
const leftBehindNow = () => [
  ...(trailCams.cams.length ? [`${trailCams.cams.length} trail camera${trailCams.cams.length > 1 ? 's' : ''} still set out`] : []),
  ...(audioLures.lures.length ? [`${audioLures.lures.length} audio lure${audioLures.lures.length > 1 ? 's' : ''} still set out`] : []),
];
// Photo evidence you've brought home, kept across hunts for review (and HQ verification / sale) (#85).
const evidenceArchive = new EvidenceArchive(camp.saveService);
const hunt = new HuntLoop({ scene, player, journal: null, colliders, target: huntTarget,
  onStart: () => { expedition?.commit(); supplier.commit(expedition?.attemptId ?? null); sponsorSurvey.bind(expedition?.attemptId ?? null); },   // purchases and rentals are final once you set off (#88)
  manifest: () => {
    const carried = evidence.carried;
    const est = carried.length ? `${carried.length} item${carried.length > 1 ? 's' : ''}` : null;
    return manifestText({ evidence: carried.map((i) => i.name),   // what it really is stays unknown until HQ (#99) photos: photo.log?.length ?? hunt.shotsTaken,
      targetPhotos: hunt.photos.length, target: huntTarget, leftBehind: leftBehindNow(), kg: +loadout.load.total.toFixed(1),
      estimate: est && `${est} of evidence plus your photos, valued at base camp` });
  },
  onEnd: (outcome) => {
    // Ordinary death (#89, GDD 9.1): what you carried and set out is lost; camp keeps its stock.
    const died = outcome === 'caught' || outcome === 'dawn';
    const carriedNow = loadout.gearLeft();
    const deployedNow = leftBehindNow();
    const h = camp.settleHunt({
      attemptId: expedition?.attemptId ?? null, leftBehind: outcome === 'caught' || outcome === 'dawn' ? ['everything carried in the field'] : leftBehindNow(),
      charges: outcome === 'emergency' ? [{ id: 'evac', cents: EXPEDITION.emergencyCents, memo: 'Emergency evacuation' }] : [],
      outcome, target: huntTarget, dawnBonus: outcome === 'complete' && !hunt.dawned ? HUNT.dawnBonus : 0,
      photos: hunt.photos.map((p) => ({ subject: p.subject, score: p.score })),
      records: photo.records.filter((r) => r.kind === 'creature'),   // graded and verified at HQ (#99)
      // Research (#101): this attempt's field notes for the target's dossier (kept only if extracted).
      mapId, research: fieldRecords({ target: huntTarget, journalEntries: journal.entries, photos: hunt.photos,
        evidence: evidence.items.filter((i) => i.stage !== 'lost'), knocks: knocks.log, events: cryptidEvents }),
      evidence: evidence.settle(outcome === 'complete' || outcome === 'abandoned' || outcome === 'emergency'),
      // what you carried comes home (or is lost with you); gear left at camp is untouched. The
      // sponsor's loaner kit never enters your owned gear (#105).
      gearLeft: sponsorSurvey.active ? {} : gearAfter(carriedNow, died),
    });
    expedition?.settled();
    // Rented gear goes back after the trip (#88): deposit returned, or kept if it was lost out there at dawn.
    hunt.rentalReturns = supplier.returnRentals({ lost: died });
    const durableLost = died ? supplier.loseInUse() : [];
    // Photo evidence on the roll: home with you (extracted, archived for review) or lost with the camera.
    const extracted = outcome === 'complete' || outcome === 'abandoned' || outcome === 'emergency';
    advance(photo.records, extracted ? 'extracted' : 'lost', hunt.elapsed);
    if (extracted) evidenceArchive.add(photo.records);
    // Sponsor survey (#105): the fixed fee if both points were logged and you drove out; zero otherwise.
    hunt.sponsor = sponsorSurvey.settle({ extracted });
    if (hunt.sponsor) camp.save();
    // Between-trip recovery (GDD 9.3): a moderate/severe injury you brought home costs 5%/10% of the trip.
    const recovery = extracted ? chargeRecovery(camp.ledger, survival.health, EXPEDITION.tripCents, expedition?.attemptId ?? h.attemptId) : null;
    if (recovery) camp.save();
    let summary = huntSummary(h);
    if (hunt.sponsor) summary += `\n${hunt.sponsor.reason}.`;
    if (recovery) summary += `\nInjury recovery (${recovery.severity}): -${formatCAD(recovery.cents)}${recovery.cents < recovery.quoted ? ` (the rest waived)` : ''}. You'll be back to full health for the next trip.`;
    hunt.recovery = recovery;
    reputation.set(camp.state.reputation ?? 0);   // keep the live reputation in step with camp
    if (died) {
      const names = Object.entries(carriedNow).filter(([, n]) => n > 0).map(([k, n]) => `${ITEMS[k]?.name ?? k}${n > 1 ? ` x${n}` : ''}`);
      const report = deathReport({ carried: names, deployed: deployedNow, durable: durableLost,
        rentals: (hunt.rentalReturns ?? []).map((r) => CATALOGUE[r.id]?.name ?? r.id),
        evidence: evidence.items.filter((i) => i.stage === 'lost').length, photos: photo.records.length, notes: journal.entries.length });
      hunt.deathReport = report;
      huntFailure.reason.textContent += `\n\n${summary}\n\n${report.text}`;
    }
    if (outcome === 'caught') huntFailure.screen.append(renderAlbum(photo.log, { filmTotal: photo.filmTotal, lost: true, target: huntTarget }));
    return { summary, money: camp.state.money, entry: h };
  },
  // First light: every cryptid bolts for cover and is gone from the area a little later.
  onDawn: () => {
    for (const c of cryptids.cryptids) { c.leavingAtDawn = true; c.enterFlee?.(player.position, 'dawn: leaving'); }
    setTimeout(() => { for (const c of cryptids.cryptids) c.mesh.visible = false; cryptids.clear(); }, 20000);
  } });
showCampPanel(camp, undefined, evidenceArchive);
showBountyPanel(camp.bounties);   // #45: offers for specific photos, paid once when you sell a match
// End-of-hunt photo album: every frame shot this hunt (lost if you were caught).
hunt.album = (outcome) => renderAlbum(photo.log, { filmTotal: photo.filmTotal, lost: outcome === 'caught' || outcome === 'dawn', target: huntTarget });
hunt.screen.style.overflowY = 'auto';
showMapPicker({ current: mapId, ctx: unlockContext(camp), onPick: (id) => {
  camp.state.map = id; camp.save();
  location.href = location.pathname;            // reload into the chosen map (drops any ?map=)
} });
scene.add(camera); // camera carries the flashlight
const flashlight = new Flashlight(camera, input);
// Outdoor maps can opt into the night lighting baseline (moon, haze, ambient, sky).
// ?time=dusk|night|dawn picks a palette grade for the sky, fog and light (outdoor maps).
const timeOfDay = new URLSearchParams(location.search).get('time');
const todConfig = timeOfDay ? timeOfDayConfig(mapId === 'swamp' ? 'swamp' : 'forest', timeOfDay) : null;
const night = map.environment?.night ? new NightLighting({ scene, camera, hemi, moon, flashlight, config: { ...map.environment.night, ...(todConfig ?? {}) } }) : null;
// Forest atmosphere: ground mist + midground and background fog curtains (?noatmos turns it off).
const atmosphere = mapId === 'forest' && !new URLSearchParams(location.search).has('noatmos')
  ? new Atmosphere({ scene, camera, half: bounds, keepClear: map.keepClear, hazeColor: night?.cfg.skyHorizon, glowColor: night?.cfg.moonGlow }) : null;
const mothman = new Mothman(scene, player, flashlight, { camera, level: null, onEvent: (t, e) => cryptidEvent(t, e) });
const chupacabra = new Chupacabra(scene, player, camera, colliders, { flashlight, onEvent: (t, e) => cryptidEvent(t, e) });
mothman.mesh.visible = chupacabra.mesh.visible = sandbox;
const batteries = new BatteryPickups(scene, player, flashlight);
// G drops bait; cryptids that smell it come to investigate.
const bait = new BaitManager(scene, player, input);
chupacabra.lures = { lures: () => bait.lures(), consume: (b) => bait.consume(b) };
// L sets an audio lure: it plays a Bigfoot call every few seconds and Bigfoot comes to check.
const audioLures = new AudioLures({ scene, player, input, notify: (m) => photo?.toast(m) });
// Fear: rises in the dark, near cryptids and on scares; light and the van calm you; high fear sways your aim.
const fear = new Fear({
  scene, player, flashlight, camera, safeZone: HUNT.exit, safeZones: map.safeZones ?? [],
  screenSway: new URLSearchParams(location.search).has('vr') ? 0 : undefined, // ?vr: no on-screen shake
  getThreats: () => [
    // Only threatening cryptids frighten you (#52): a harmless one can wander right past.
    ...cryptids.cryptids.filter((c) => c.profile.threatening).map((c) => ({ id: c.profile.name, x: c.agent.x, z: c.agent.z, state: c.state })),
    ...(sandbox ? [ // both can catch you, so both are threatening
      { id: 'Mothman', x: mothman.mesh.position.x, z: mothman.mesh.position.z },
      { id: 'Chupacabra', x: chupacabra.position.x, z: chupacabra.position.z },
    ] : []),
  ],
});
const bars = new Hud(player, flashlight, fear);
// Survival (#68, GDD S01/S02): energy + food (Z eats) and body temperature + wetness. Heat:
// the campfire, safe interiors (cabin, tent) and the van. Tutorial values: impairing, never lethal.
let fieldKit = null;   // #87 field kit, built once the camera and evidence kit exist (below)
let fieldCamp = null;  // #104 tent, sleep and camp (built with the field kit)
// Rain (#104): ?rain or ?rain=0.5, or the map's environment.rain. Shelter: your tent, a bivy, the
// cabin and other safe interiors, the van.
const rainParam = new URLSearchParams(location.search).get('rain');
const weather = new Weather({ scene, camera, rain: rainParam != null ? (rainParam === '' ? 1 : Math.max(0, Math.min(1, +rainParam || 1))) : (map.environment?.rain ?? 0),
  sheltered: (p) => fieldCamp?.shelterAt(p) ?? (map.safeZones ?? []).find((z) => Math.hypot(p.x - z.x, p.z - z.z) < z.r)?.name
    ?? (Math.hypot(p.x - HUNT.exit.x, p.z - HUNT.exit.z) < 3 ? 'the van' : null) });
const survival = new Survival({ player, input, lethalCold: true,   // past the tutorial, critical cold can kill (#89, GDD 9.1)
  rain: () => weather.exposure(player.position),
  map: { ...map, environment: { ...map.environment, airTemp: map.environment?.airTemp ?? ({ forest: 6, swamp: 13 }[mapId] ?? 10) } },
  heatSources: () => [
    ...(map.landmarks?.campsite ? [{ ...map.landmarks.campsite, r: 4.5, name: 'campfire' }] : []),
    ...(map.safeZones ?? []).map((z) => ({ x: z.x, z: z.z, r: z.r, name: z.name })),
    { x: HUNT.exit.x, z: HUNT.exit.z, r: 6, name: 'the van' },
    ...(fieldKit?.heatSources() ?? []),   // your own fire and bivy (#87)
    ...(fieldCamp?.heatSources() ?? []),  // inside your pitched tent (#104)
  ] });
const noiseRing = new NoiseRing(scene, player);
// Scent traces (#107): food you open and blood from a bleeding wound leave real traces the wind
// carries; cryptids smell only those (never your pack). Pine Hollow's night breeze blows west to
// east at 1.5 m/s (?wind=x,z,speed overrides for tests). Carcasses use the same field (emit 'carcass').
const scent = new ScentField();
{ const w = new URLSearchParams(location.search).get('wind')?.split(',').map(Number); if (w?.length === 3) scent.setWind({ x: w[0], z: w[1], speed: w[2] }); }
SCENT_WORLD.field = scent;
{
  const eat = survival.eat.bind(survival);
  survival.eat = () => { const r = eat(); if (r) scent.emit('food', player.position.x, player.position.z, { source: 'player' }); return r; };
}
let bloodClock = 0;
function updateScent(dt) {
  scent.update(dt);
  const b = survival.health?.bleeding ?? [];
  if (b.length && (bloodClock -= dt) <= 0) {
    bloodClock = 3;                              // drops every few seconds while you bleed
    const heavy = b.some((w) => w.severity === 'heavy');
    scent.emit('blood', player.position.x, player.position.z, { strength: heavy ? 0.7 : 0.4, source: 'player' });
  }
}

// Cryptids. Bigfoot is the forest's starter cryptid; the map can give it a spawn point.
// Escalation level for this hunt: 1 Pine Hollow (forgiving) .. 3 (relentless).
const MAP_LEVEL = { forest: 1, swamp: 2 };  // the test yard uses each cryptid's own home level
const escalation = Number(new URLSearchParams(location.search).get('tier')) || map.level || MAP_LEVEL[mapId] || null;
const rocks = new Rocks(scene);
if (escalation) { mothman.level = escalation; chupacabra.level = escalation; }
// What cryptids do that the player should feel: captions, sound and fear.
const cryptidEvents = [];   // recent events, for the debug hook / checks
function cryptidEvent(type, e) {
  cryptidEvents.push({ type, name: e.name, distance: e.distance, why: e.why, bluff: e.bluff, t: performance.now() });
  if (cryptidEvents.length > 50) cryptidEvents.shift();
  const where = (x, z) => { const d = Math.hypot(x - player.position.x, z - player.position.z); return `${d.toFixed(0)} m away`; };
  if (type === 'whoop') fieldKit?.hear({ kind: 'whoop', x: e.cryptid.agent.x, z: e.cryptid.agent.z, cryptid: e.cryptid.profile.id, name: e.name });
  // A significant cue wakes you if you're asleep nearby (#104, #137, GDD 6.5): any creature sound or
  // event with a place (a call, a splash, a surfacing), not its quiet moment-to-moment moves.
  if (!['stalk', 'perched', 'emerging'].includes(type)) {
    const at = e.cryptid?.agent ?? (Number.isFinite(e.x) ? e : null);
    if (at) fieldCamp?.cue({ x: at.x, z: at.z, what: e.what ?? `a ${type}` });
  }
  if (type === 'whoop') { audioLures.playCall({ x: e.cryptid.agent.x, z: e.cryptid.agent.z, cryptid: true }); fear.scare(8, 'whoop'); photo.toast(`A deep whoop, ${where(e.cryptid.agent.x, e.cryptid.agent.z)}. It knows you're here.`); }
  if (type === 'rock') { fear.scare(e.distance < 3 ? 22 : 12, 'rock'); photo.toast(`A rock slams into the ground ${e.distance.toFixed(0)} m from you. Back off.`); }
  if (type === 'rock-hit') { equipment.impact(); fear.scare(35, 'rock hit'); player.velocity.x += (player.position.x - e.x) * 6; player.velocity.z += (player.position.z - e.z) * 6; }
  if (type === 'roar') { fear.scare(30, 'roar'); photo.toast(`${e.name} stops short and ROARS in your face.`); }
  if (type === 'hiss') { fear.scare(10, 'hiss'); photo.toast('A wet HISS behind you…'); }
  if (type === 'screech') { fear.scare(15, 'screech'); photo.toast('A shriek overhead: it is coming down at your light!'); }
  if (type === 'swoop-pass') fear.scare(25, 'swoop');
  if (type === 'vanish') photo.toast(e.why === 'photographed' ? 'The flash catches it, and it is gone into the dark.' : 'It unfolds and is gone over the trees.');
  if (type === 'fed') photo.toast('Something is feeding on your bait…');
}
const cryptids = new CryptidManager({ scene, colliders, halfSize: bounds, getPlayerPosition: () => player.position,
  lures: { lures: () => bait.lures(), consume: (b) => bait.consume(b), eatTime: BAIT.eatTime },
  calls: audioLures,
  // Escalation: each hunting ground is a level (?tier=1..3 overrides it for testing).
  level: escalation, rocks,
  onEvent: (type, e) => cryptidEvent(type, e),
  // Hearing + sight: they notice your noise, your silhouette and your flashlight.
  // ?nosenses falls back to the L0 fixed flee distance (used by older mechanic checks).
  senses: new URLSearchParams(location.search).has('nosenses') ? null
    : { player, flashlight, camera, lightLevel: map.environment?.lightLevel ?? 0 } });
// State-machine debug overlay (F4 toggles; ?nodebugai starts it hidden).
// Bigfoot knocks on trees now and then; K knocks back with your stick and can draw it closer.
const knocks = new WoodKnocks({ cryptids, player, camera, fear, input });
const aiDebug = new AIDebug(scene, cryptids, { visible: !new URLSearchParams(location.search).has('nodebugai'),
  others: () => (sandbox ? [mothman, chupacabra] : []) });

// Clues: cryptids drop footprints / hair / scratch marks along the route they actually take.
// F3 (or ?debug in the URL) draws that true route as a yellow line for checking.
const clues = new ClueSystem(scene);
const clueTrails = new ClueTrails(scene, cryptids, clues, colliders);
clueTrails.setDebug(new URLSearchParams(location.search).has('debug'));
addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); clueTrails.setDebug(!clueTrails.debug); levelFlow?.setDebug(clueTrails.debug); } });

// Field journal: aim at a clue within reach and press E to log it; J opens the journal.
const journal = new Journal();
const clueFinder = new ClueFinder(camera, clues, journal, input);
// Examining a clue also says how fresh it is and which way the cryptid went (compass at top).
const trailReader = new TrailReader({ clues, clueTrails, journal, player });
// Paper map and compass (#70): M raises them. No position marker, no beacon, no distance to the
// van: the way back is read from the map, the compass, the landmarks and the trail signs.
const fieldMap = new FieldMap({ map, player, input, home: 'trailhead', title: mapId === 'swamp' ? 'BLACKWATER SWAMP' : 'PINE HOLLOW' });
const journalUI = new JournalUI(journal, clueFinder);
// Species dossier in the field journal (#101): milestones banked from earlier extracted trips,
// career credibility, and what the next milestone needs. Tonight's notes count once you get out.
journalUI.dossier = () => {
  const id = SPECIES[huntTarget] ?? 'bigfoot', sp = camp.state.research?.species?.[id];
  const ms = ['lead', 'located', 'documented', 'characterized', 'confirmed'];
  const have = (m) => (m === 'lead' ? true : !!sp?.milestones?.[m]);
  const next = ms.find((m) => !have(m));
  const need = { located: 'a clearly identifying sign (e.g. a huge footprint), or two weaker signs on different trips',
    documented: 'a grade 2+ record of the target (a photo scoring 40+, or bagged physical evidence)',
    characterized: 'two different behaviours observed (a knock exchange, a warning, a charge...)',
    confirmed: 'strong evidence from two trips and two kinds of evidence' }[next];
  return `<b>DOSSIER · ${huntTarget}</b> · credibility ${camp.state.research?.credibility ?? 0}<br>` +
    ms.map((m) => `${have(m) ? '✓' : '·'} ${MILESTONE_NAMES[m]}`).join(' &nbsp; ') +
    (next ? `<br><i>Next: ${MILESTONE_NAMES[next]} needs ${need}. Tonight's notes count once you get back to the van and drive out.</i>` : '');
};
hunt.journal = journal;

// Dread (#114): the slow build under fear. Time out alone, distance from the van, the dark, every
// fresh sign and a share of every scare push it up; only a lit safe place eases it a little. It
// closes the fog in, kills the night chorus under a rising heartbeat, makes fear build faster,
// stutters the torch at its worst, and makes the creature bolder (higher escalation level).
const dread = new Dread({ player, fear, flashlight, scene, half: map.bounds ?? 150,
  getHome: () => HUNT.exit,
  getThreats: () => cryptids.cryptids,
  // #132: the kind of safe place you're in; dread falls fastest at the van, then in shelter, by a fire, in lamplight.
  isSafe: () => {
    const p = player.position, near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r;
    if (near(HUNT.exit.x, HUNT.exit.z, 8)) return 'vehicle';
    if (fieldCamp?.insideTent || (map.safeZones ?? []).some((z) => near(z.x, z.z, z.r))) return 'shelter';
    if ((fieldKit?.fires ?? []).some((f) => near(f.x, f.z, 4)) || (map.landmarks?.campsite && near(map.landmarks.campsite.x, map.landmarks.campsite.z, 4.5))) return 'fire';
    if (fear.lampLight() > 0.5) return 'light';
    return false;
  },
  notify: (m) => m && photo.toast(m),
  vr: () => !!renderer.xr?.isPresenting });
{ const scare = fear.scare.bind(fear); fear.scare = (amount, why) => { dread.onScare(amount); return scare(amount, why); }; }
{ const record = journal.record.bind(journal);
  journal.record = (clue) => { const e = record(clue); if (e && !['deerTrack', 'foxTrack', 'owlFeather'].includes(clue.type)) dread.onClue(); return e; }; }
let dreadAudio = null, dreadAudioAt = 0;
addEventListener('pointerdown', () => {      // browsers only start sound after a click
  if (dreadAudio || new URLSearchParams(location.search).has('mute')) return;
  try { const ac = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(); dreadAudio = buildDreadAudio(ac); dreadAudio.set(dread.level); } catch { /* no audio */ }
});
dread.audio = () => dreadAudio;   // checks: the breathing/heartbeat the player hears matches the label (#131)

// Level flow: spawn this hunt's Bigfoot. On maps with spawn zones (the forest) it picks where it
// beds down and where its fresh trail starts, and walks that route so the clues are real.
// Bigfoot lives in the forest/test map, not the swamp (Mothman's home).
const levelFlow = new LevelFlow({ scene, map });
if (mapId !== 'swamp' && !map.noBigfoot) levelFlow.spawnCryptid({ cryptids, profile: PROFILES.bigfoot, clueTrails, clues });
// #86: any registered species joins the hunt from its data alone: ?cryptid=gouger (repeatable).
for (const id of new URLSearchParams(location.search).getAll('cryptid')) {
  const sp = getSpecies(id);
  if (!sp || id === 'bigfoot') continue;
  const s = map.spawns?.[id] ?? { x: player.position.x + 12, z: player.position.z - 30 };
  cryptids.spawn(sp, s.x, s.z);
}
// Ordinary-animal false leads (#84, GDD 4.4): deer trails wander Pine Hollow.
// #99: plus fox trails and owl feathers. All are tagged ordinary (hidden; HQ verification reads it).
if (mapId === 'forest') {
  const wild = { clues, bounds,
    blocked: (x, z) => colliders.some((c) => c.max.y > 0.4 && x > c.min.x - 0.3 && x < c.max.x + 0.3 && z > c.min.z - 0.3 && z < c.max.z + 0.3),
    avoid: [{ x: player.position.x, z: player.position.z, r: 25 }, { x: HUNT.exit.x, z: HUNT.exit.z, r: 15 }] };
  spawnDeerTracks(wild); spawnFoxTracks(wild); spawnOwlFeathers(wild);
}
// Sponsor survey (#105): flagged stakes with fresh sign at the two survey points.
sponsorSurvey.setUp({ scene, clues });
sponsorSurvey.buildHud();
// Sandbox also gets a hostile stand-in on the shared brain, to exercise the Aggress state.
if (sandbox && mapId === 'test') cryptids.spawn(PROFILES.prowler, -15, 15);
// Authored clue spots (#94, Blackwater Swamp): Mothman's sign at its perches and ordinary false
// leads. They stay all night (no fading): the swamp's sign is where it lands, not a moving trail.
for (const sp of map.clueSpots ?? []) {
  const c = clues.spawn(sp.type, { cryptidId: sp.cryptidId, position: sp.position, rotationY: sp.rotationY, data: sp.data });
  c.lifetime = 1e9;
}
levelFlow.setDebug(clueTrails.debug);

// Camera: hold right mouse to raise it, left-click to snap. A shot is a HIT if a cryptid is
// inside the viewfinder's frustum and not completely blocked.
const photo = new PhotoCamera({
  canvas: renderer.domElement,              // album thumbnails come from the rendered view
  camera, scene, input,
  getSubjects: () => [
    ...cryptids.cryptids.map((c) => ({ name: c.profile.name, object3d: c.mesh, radius: c.profile.radius,
      center: new THREE.Vector3(c.agent.x, c.profile.height * 0.6, c.agent.z),
      base: new THREE.Vector3(c.agent.x, 0, c.agent.z), height: c.profile.height })),
    ...(sandbox ? [
      { name: 'Mothman', object3d: mothman.mesh, radius: 0.8, center: mothman.mesh.position.clone() },
      { name: 'Chupacabra', object3d: chupacabra.mesh, radius: 0.5, center: chupacabra.position.clone() },
    ] : []),
  ],
  onPhoto: (r) => { if (r.subject === 'Mothman') mothman.onPhotographed(); hunt.onPhoto(r); },
  getShake: () => fear.swaySpeed + (dread?.effects.photoShake ?? 0),   // dread (#132): shaking hands blur photos
  getAimOffset: () => fear.hiddenSway,      // evidence sees the full hand shake whatever the screen shows (#77)
  // What each evidence record needs (#85): attempt, field clock, the map's ambient light, goggles on.
  evidenceContext: () => ({ attemptId: expedition?.attemptId ?? null, time: hunt.elapsed, ambient: map.environment?.lightLevel ?? 0.05,
    nightVision: !!nightVision?.on, committed: hunt.stage === 'search' || hunt.stage === 'extract' }),
});
// Physical evidence (#73): X bags a hair tuft or casts a footprint; a photo of a footprint or
// scratch marks is kept as evidence too. Drive home to sell it at base camp; caught = lost.
const evidence = new EvidenceKit({ camera, clues, input, notify: (m) => photo.toast(m) });
evidence.getEffects = () => dread.effects;              // dread (#132): slower casting and sampling with shaking hands
fieldMap.getUnfoldDelay = () => dread.effects.mapDelay;  // ...and slower to unfold the map
fieldMap.notify = (m) => photo.toast(m);
{
  const snap = photo.snap.bind(photo);
  photo.snap = () => { const shot = snap(); if (shot) evidence.photographed(shot, photo); return shot; };
}
// T sets a trail camera facing where you look: it photographs any cryptid that walks into its
// view, on its own (grainy shots, lower score).
const trailCams = new TrailCameras({ scene, player, input, getSubjects: () => photo.getSubjects(),
  onPhoto: (r) => { if (r.subject === 'Mothman') mothman.onPhotographed(); hunt.onPhoto(r); }, notify: (m) => photo.toast(m) });
// V toggles night-vision goggles: see in the dark (green, narrow view) without light; shares the
// flashlight's battery. Cryptids can't see it, unlike the torch.
const nightVision = new NightVision({ renderer, scene, camera, flashlight, hemi, input, photo, notify: (m) => photo.toast(m) });
// Loadout: 4 slots picked on the start screen from gear you own; 1-4 / wheel to pick, Q (or
// left-click with the camera down) to use. Only slotted gear is carried.
// ?loadout=nightVision,knockStick,... packs those items instead (testing / quick setups).
const urlLoadout = new URLSearchParams(location.search).get('loadout')?.split(',').filter(Boolean);
// Pack (#69): unslotted gear can ride in the pack, with food and water; load slows you and makes
// running cost more stamina. ?pack=bait,... and ?water=N set it for testing.
const qs = new URLSearchParams(location.search);
const urlPack = qs.get('pack')?.split(',').filter(Boolean);
const getFood = () => survival.nutrition.food;
// Field kit (#87): binoculars, whistle, field recorder, emergency bivy, dry clothes, fire kit.
fieldKit = new FieldKit({ scene, camera, player, flashlight, photo, evidence, input, thermo: () => survival.thermo, notify: (m) => photo.toast(m) });
// Camp (#104, GDD S09/S10): pitch the tent, sleep in it to bring fatigue down. Sleep is cut short by
// a creature coming close, a loud cue or a worsening condition.
fieldCamp = new FieldCamp({ scene, player, survival, weather, fieldKit, colliders, surfaceAt: map.surfaceAt, notify: (m) => photo.toast(m),
  isThreatNear: (r) => cryptids.cryptids.find((c) => c.mesh.visible && c.playerDistance < r)?.profile.name ?? null });
let knocksHeard = 0;
const loadout = new Loadout({ owned: packed, slots: urlLoadout ?? camp.state.loadout, input, player, scene, getFood,
  pack: urlPack ?? camp.state.pack ?? [], water: qs.has('water') ? +qs.get('water') : camp.state.water ?? 2,
  gear: { bait, trailCams, audioLures, nightVision, knocks, flashlight, fieldKit, equipment, repairKit: { uses: 0 }, notify: (m) => photo.toast(m) } });
// S07 hydration (#103): the packed bottles are the loadout's water; the canteen and tablets come
// from camp. The canteen and its water are carried in the pack (mass counts once, in the load).
survival.hydration.bottles = { get: () => loadout.water, set: (n) => { loadout.water = n; loadout.render(); } };
survival.hydration.hasCanteen = (camp.state.gear.canteen ?? 0) > 0;
survival.hydration.canteen.litres = survival.hydration.hasCanteen ? 1 : 0;
survival.hydration.tablets = camp.state.gear.purTablets ?? 0;
survival.hydration.onTablet = () => { camp.state.gear.purTablets = Math.max(0, (camp.state.gear.purTablets ?? 0) - 1); camp.save(); };
loadout.extraPack = () => (survival.hydration.hasCanteen ? { canteen: 1, canteenWater: survival.hydration.canteen.litres } : {});
photo.onLoweredClick = () => loadout.use();
// The night's clock for 'sleep until dawn' (#137).
fieldCamp.getClock = () => ({ dawned: hunt.dawned, elapsed: hunt.elapsed, dawnSeconds: HUNT.dawnSeconds });
// Level 3 (the first overnight trip, GDD 1.5 L03): it introduces sleep and campcraft, so the tent and
// fire kit come with the trip and sit in your first slots, and sleep lasts until dawn or a cue.
if (map.level === 3) {
  fieldCamp.sleepUntil = 'dawn';
  loadout.owned.tent = Math.max(loadout.owned.tent ?? 0, 1); loadout.owned.fireKit = Math.max(loadout.owned.fireKit ?? 0, 6);
  fieldKit.carried.tent = Math.max(fieldKit.carried.tent ?? 0, 1); fieldKit.carried.fireKit = Math.max(fieldKit.carried.fireKit ?? 0, 6);
  loadout.setSlots(['tent', 'fireKit', ...loadout.slots.filter((id) => id !== 'tent' && id !== 'fireKit')].slice(0, 4), loadout.pack);
}
const picker = showLoadoutPicker({ owned: packed, slots: loadout.slots, pack: loadout.pack, water: loadout.water, getFood,
  onChange: ({ slots, pack, water }) => {
    if (hunt.stage !== 'briefing') return;         // packing happens before you set off
    camp.state.loadout = slots; camp.state.pack = pack; camp.state.water = water; camp.save();
    loadout.water = water;
    loadout.setSlots(slots, pack);
    expedition?.render();
  } });
// Shop (#46): buy gear and permanent upgrades at base camp, before you set off. Upgrades are
// saved with camp and applied to the camera and torch at the start of every hunt.
applyUpgrades(camp, { photo, flashlight });
// Condition changes capability only (#106): camera low-light clarity, torch output, shoes in water.
{
  const base = player.speedAt;
  player.speedAt = (x, z, y) => { const sp = base ? base(x, z, y) : 1; return sp < 1 ? sp * equipment.wadeFactor : sp; };
}
const equipmentPanel = showEquipmentPanel(equipment, { canAct: () => hunt.stage === 'briefing', onChange: () => {
  const cp = document.getElementById('camp-panel');
  if (cp) cp.textContent = cp.textContent.replace(/BASE CAMP {2}· {2}\S+/, `BASE CAMP  ·  $${camp.state.money}`);
} });
// Field wear (#106): per shot, per minute of torch, per km walked; wading soaks the shoes; raising
// the camera while wading dips it into the water (the photos already on its card are kept).
const wearState = { shots: photo.log.length, last: player.position.clone(), dunkCooldown: 0 };
function updateWear(dt) {
  photo.clarity = equipment.cameraClarity; flashlight.output = equipment.torchOutput;
  if (hunt.stage !== 'search' && hunt.stage !== 'extract') { wearState.last.copy(player.position); return; }
  if (photo.log.length > wearState.shots) { equipment.wear('camera', WEAR.cameraPerShot * (photo.log.length - wearState.shots), 'use'); wearState.shots = photo.log.length; }
  if (flashlight.on) equipment.wear('flashlight', WEAR.torchPerMinute * dt / 60, 'use');
  const d = Math.hypot(player.position.x - wearState.last.x, player.position.z - wearState.last.z);
  if (d < 5) equipment.wear('shoes', WEAR.shoesPerKm * d / 1000, 'use');
  wearState.last.copy(player.position);
  const water = map.surfaceAt?.(player.position.x, player.position.z, player.position.y);
  wearState.dunkCooldown = Math.max(0, wearState.dunkCooldown - dt);
  if (water === 'shallow' || water === 'deep') {
    equipment.wet.shoes = true;
    equipment.wear('shoes', WEAR.shoesWetPerSecond * dt, 'water');
    if ((photo.raised || photo.wantRaised) && wearState.dunkCooldown <= 0) {
      wearState.dunkCooldown = 20;
      const c = equipment.dunk('camera');
      photo.toast(`Your camera dips into the water! It's at ${Math.round(c * 100)}% now; the photos on its card are safe.`);
    }
  }
}
// Supplier (#88): catalogue gear you own or rent changes this hunt through the systems it affects
// (pack and worn mass, pace on rough ground, insulation, torch beam, camera lens).
const supplier = new Supplier(camp);
const applyGear = () => supplier.apply({ player, thermo: survival.thermo, flashlight, photo, setKit });
applyGear();
const shop = showShopPanel(camp, {
  canBuy: () => hunt.stage === 'briefing',
  onChange: ({ kind, key }) => {
    if (kind === 'gear') {                       // bought gear is packable right away
      packed[key] = camp.state.gear[key];
      loadout.setSlots(loadout.slots);
      picker?.refresh?.();
    } else applyUpgrades(camp, { photo, flashlight });
    refreshMoney();
  },
});
const supplierPanel = showSupplierPanel(supplier, {
  canTrade: () => hunt.stage === 'briefing',
  onChange: ({ act, ok }) => {
    if (!ok) return;
    // Taking gear back out of the kit: reload the camp so its effects are gone too (nothing is lost, all saved).
    if (act === 'undo' || act === 'sell' || act === 'cancel') { camp.save(); location.reload(); return; }
    applyGear();
    loadout.setSlots(loadout.slots);
    picker?.refresh?.();
    refreshMoney();
  },
});
/** Every money readout on the start screen shows the ledger's cash right now. */
function refreshMoney() {
  const cp = document.getElementById('camp-panel');
  if (cp) cp.textContent = cp.textContent.replace(/BASE CAMP {2}· {2}\$[\d.]+/, `BASE CAMP  ·  ${formatCAD(camp.ledger.cash)}`);
  shop?.render?.();
  supplierPanel?.render?.();
  expedition?.render();
}
// Prep panel (#98): plan numbers and capabilities, and the one COMMIT button that pays for the trip.
expedition = new Expedition({ camp, loadout, target: huntTarget,
  mapName: MAP_CHOICES.find((m) => m.id === mapId)?.name ?? 'Test range',
  capabilities: () => {
    const g = camp.state.gear, carried = [...loadout.slots, ...loadout.pack];
    return [
      { name: 'Light source', required: true, ok: (g.flashlight ?? 0) > 0, note: 'flashlight' },
      { name: 'Way back to the van', required: true, ok: true, note: 'map & compass (M), always with you' },
      { name: 'Camera with film', required: false, ok: (g.camera ?? 0) > 0, note: `${photo.filmTotal} shots` },
      { name: 'Water, 1 L or more', required: false, ok: loadout.water >= 1, note: `${loadout.water} L packed` },
      { name: 'Spare battery packed', required: false, ok: carried.includes('spareBatteries'), note: 'the torch runs down' },
      { name: 'Load under half your limit', required: false, ok: loadout.load.ratio < 0.5, note: `${Math.round(loadout.load.ratio * 100)}%` },
    ];
  } });
hunt.outcomeLabels = OUTCOMES;
expedition.requireSponsor = () => sponsorSurvey.offered;   // broke: the sponsor's survey is the way out (#105)
expedition.mount(undefined, {
  onCommit: () => { refreshMoney(); input.requestLock(); },
  onEmergency: () => { if (hunt.stage === 'search' || hunt.stage === 'extract') { overlay.classList.add('hidden'); hunt.end('emergency'); } },
});
sponsorSurvey.mount(undefined, { onAccept: () => { location.href = location.pathname + location.search; } });   // reload with the loaner kit

// First-person hands and gear: torch in the right hand, camera in the left, goggles and trail cam on use.
const viewmodel = new Viewmodel({ camera, player, flashlight, photo, nightVision, trailCams });

// A cryptid's contact is an injury event (S08); the hunt ends when health reaches 0.
const huntFailure = new HuntFailure({
  player, health: survival.health,   // #72: contacts wound you; only health 0 ends the hunt
  getThreats: () => [
    ...cryptids.cryptids.map((c) => ({ name: c.profile.name, x: c.agent.x, z: c.agent.z, y0: 0, y1: c.profile.height, radius: c.profile.radius, catchHits: c.profile.catchHits ?? 1 })),
    ...(!sandbox ? [] : [
    { name: 'The Mothman', x: mothman.mesh.position.x, z: mothman.mesh.position.z, y0: mothman.mesh.position.y - 0.8, y1: mothman.mesh.position.y + 0.8, radius: 0.8, catchHits: MOTHMAN.catchHits },
    { name: 'The Chupacabra', x: chupacabra.position.x, z: chupacabra.position.z, y0: 0, y1: 0.55, radius: 0.45, catchHits: CHUPA.catchHits },
    ]),
  ],
});
survival.onDeath = (cause) => huntFailure.caught(cause);
chupacabra.onHit = () => {
  huntFailure.touched('The Chupacabra', CHUPA.catchHits);
  chupacabra.flash.style.display = 'none'; // the hunt's own hit flash / Caught screen replaces it
};

// Cinematic lighting (forest): key/fill/rim and light shafts. Built last so every material gets
// the rim. ?nocine turns it off for comparison.
const cine = mapId === 'forest' && !new URLSearchParams(location.search).has('nocine')
  ? new CinematicLighting({ scene, camera, renderer, night, flashlight, map }) : null;
const pixels = new PixelPipeline({ renderer, camera });
// Swamp water: pixelated reflections, texel-snapped ripples and a moon sheen (art/pixelWater.js).
const water = mapId === 'swamp' ? new PixelWater({ renderer, scene, camera, height: map.waterHeight ?? 0.3,
  moonDir: night?.moonDir, moonColor: night ? new THREE.Color(night.cfg.moonColor) : undefined }) : null;
water?.applyToScene();
// In VR (#74) the headset gives the view: the rig sits at the player's feet (floor-relative space adds
// real head height), turned by the player's yaw only (no pitch, roll or sway: GDD 16.3), drawn
// straight to the headset (no desktop pixel pass, night-vision post or water mirror pass).
const drawFrame = () => {
  if (vr?.presenting) {
    // 'local' space starts at the user's eyes, so lift it to standing eye height; 'local-floor' starts at the floor.
    camera.position.set(player.position.x, player.position.y + (vr.refSpaceType === 'local-floor' ? 0 : 1.6), player.position.z);
    camera.rotation.set(0, player.yaw, 0, 'YXZ');
    renderer.render(scene, camera);
    return;
  }
  pixels.frame(() => { water?.renderReflection(); if (!nightVision.render()) renderer.render(scene, camera); });
};

// Story cards (placeholder copy in story/cardText.js): the intro once on a new game, the finale
// once when reputation hits max. Reputation is a stub until the hub economy lands; debug:
// ?rep=<n> starts at n, F8 sets it to max, or __game.reputation.set(n).
const textCard = new TextCard();
const reputation = new ReputationStub(Number(new URLSearchParams(location.search).get('rep') ?? camp.state.reputation ?? 0));
reputation.onChange((v) => { camp.state.reputation = v; camp.save(); }); // base camp keeps it between hunts
// Story cards are OFF for now (director: the TV-show story belongs later in development, not on
// the opening Bigfoot hunt). The system stays in place; ?cards turns it on for testing.
const cardsOn = new URLSearchParams(location.search).has('cards');
const story = new StoryCards({ show: (id) => (cardsOn ? textCard.show(id) : null) });
reputation.onChange((v, max) => story.reputationChanged(v, max));
story.start(camp.state.hunts.length === 0);   // first night (a new career starts with $250 now, #97)
story.reputationChanged(reputation.value, reputation.max);
addEventListener('keydown', (e) => { if (e.code === 'F8') { e.preventDefault(); reputation.set(reputation.max); } });

const overlay = document.getElementById('overlay');
// Clicking the start screen only enters the field once the expedition is committed (#98).
overlay.addEventListener('click', () => {
  if (gymRun && expedition && !expedition.committed) expedition.commit();   // a gym just starts (in-memory career)
  if (expedition && !expedition.committed) expedition.nudge(); else input.requestLock();
});
function setInGame(on) {
  overlay.classList.toggle('hidden', on);
  if (!on) refreshMoney();
  if (on) { hunt.start(); if (picker) picker.el.style.display = 'none'; }   // the night clock starts with the first click into the game
}
document.addEventListener('pointerlockchange', () => { if (!gamepad.engaged) setInGame(input.locked); });

// Gamepad (#76): the same inputs as keyboard and mouse; A or Menu on the start screen plays with it.
const gamepad = new GamepadControls({ input, player, photo, isEnded: () => ended(),
  onEngage: () => setInGame(true), onRelease: () => setInGame(false) });
// Captions for sounds, with a direction cue (#76): knocks, whoops, the lure, thrown rocks.
const captions = new Captions({ player });
knocks.showCaption = (text) => {
  const last = knocks.log[knocks.log.length - 1];
  captions.say(text.replace(/\s*\([^)]*\)\s*$/, ''), last && last.who !== 'player' ? { x: last.x, z: last.z } : null);
};
{
  const playCall = audioLures.playCall.bind(audioLures);
  audioLures.playCall = (l) => { playCall(l); captions.say(l.cryptid ? 'A deep whoop' : 'Your audio lure plays a whoop', l); };
}
// Apply settings live: view, look, shake, brightness (display only), captions, keys, pad.
const baseSway = fear.screenSway;
settings.onChange((s) => {
  if (!nightVision.on) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
  nightVision.nakedFov = s.fov;
  if (!nightVision.on) photo.baseFov = s.fov;
  player.lookScale = s.lookSensitivity; player.invertY = s.invertY;
  gamepad.lookSpeed = s.padLookSpeed;
  if (!renderer.xr?.isPresenting) fear.screenSway = s.reducedShake ? 0 : baseSway;   // VR keeps its own (none)
  viewmodel.bobScale = s.reducedShake ? 0.25 : 1;
  renderer.domElement.style.filter = s.brightness === 1 ? '' : `brightness(${s.brightness})`;
  captions.enabled = s.captions;
  keyRemap.apply(s);
});
const settingsPanel = showSettingsPanel(settings);
keyRemap.paused = () => !!settingsPanel?.waiting;

const hud = document.getElementById('hud');
// Fixed-step loop (#66): the world simulates in exact 1/60 s steps whatever the frame rate;
// rendering, HUD and post effects run once per drawn frame with positions interpolated.
const ended = () => huntFailure.isCaught || hunt.stage === 'ended';
// Sleep (#104) fast-forwards: every world system runs several steps per step while you're asleep.
function simulate(dt) {
  const n = fieldCamp?.timeScale ?? 1;
  for (let i = 0; i < n; i++) {
    simulateOnce(dt, i > 0);
    if (!fieldCamp?.sleeping) break;     // woke up: back to normal time at once
  }
}
let gymHarness = null;   // gyms G02–G04 (#108), built once the game object exists (below)
function simulateOnce(dt, extra = false) {
  if (!extra) xr.update(dt);                 // VR controllers -> the same intents as keyboard/mouse (before the player reads them)
  if (huntFailure.isCaught && hunt.stage !== 'ended') hunt.end('caught');
  if (ended()) return;                       // world freezes behind the end screens
  // Dread's effects this tick (#132): from its value at the start of the last tick, so nothing it
  // causes now can raise it again in the same tick. Breathing noise, stamina recovery.
  { const e = dread.effects; player.breathNoise = { level: e.breathNoise, radius: e.breathRadius }; survival.dreadPenalty = e.recoveryPenalty; }
  if (!fieldCamp?.sleeping) player.update(dt);   // asleep: you lie still
  updateWear(dt);
  survival.update(dt);
  updateScent(dt);
  fear.update(dt);
  dread.update(dt, { active: hunt.stage === 'search' || hunt.stage === 'extract' });
  if (!vr?.presenting) fear.applySway(dt);    // after the player sets the view (never in VR: no forced camera motion)
  photo.update(dt);
  flashlight.update(dt);
  batteries.update(dt);
  bait.update(dt);
  cryptids.update(dt);
  knocks.update(dt);
  clueTrails.update();
  clues.update(dt);
  evidence.update(dt);
  journal.update(dt);
  if (sandbox) {
    mothman.update(dt);
    chupacabra.update(dt);
  }
  rocks.update(dt);
  audioLures.update(dt);
  trailCams.update(dt);
  fieldKit.update(dt);
  fieldCamp.update(dt);
  gymHarness?.update(dt);    // gym proxies, trace and watchers (#108)
  for (const s of sponsorSurvey.update(clues)) photo.toast(`Survey point logged: ${s.name} (${sponsorSurvey.progress.done}/${sponsorSurvey.progress.total})`);
  // Wood knocks a cryptid makes are sounds the field recorder can pick up (#87).
  for (; knocksHeard < knocks.log.length; knocksHeard++) {
    const k = knocks.log[knocksHeard];
    if (k.who !== 'player') fieldKit.hear({ kind: 'knock', x: k.x, z: k.z, cryptid: 'bigfoot', name: k.who });
    if (k.who !== 'player') fieldCamp.cue({ x: k.x, z: k.z, what: 'a wood knock' });
  }
  hunt.update(dt);
  huntFailure.update(dt);
}
function present(dt) {
  gamepad.update(dt);
  if (huntFailure.isCaught && hunt.stage !== 'ended') hunt.end('caught');
  if (ended()) { drawFrame(); return; }
  nightVision.update(dt);
  viewmodel.tremor = dread.feedback.tremor;   // dread (#131): a tremor in the hands holding the tools, never the view
  viewmodel.update(dt);
  loadout.render();
  loadout.update(dt);
  fieldMap.update(dt);
  survival.render();
  weather.update(dt);
  sponsorSurvey.renderHud();
  evidence.render();
  const v = Math.hypot(player.velocity.x, player.velocity.z);
  const wading = map.surfaceAt?.(player.position.x, player.position.z, player.position.y);
  const gait = player.crouching ? 'CROUCH' : player.sprinting ? 'SPRINT' : 'WALK';
  hud.textContent = `${gait}${wading === 'shallow' ? ' (WADING)' : wading === 'deep' ? ' (DEEP WATER)' : ''}  ${v.toFixed(1)} m/s   LIGHT ${flashlight.on ? 'ON' : 'OFF'}${nightVision.on ? '  NVG ON' : ''}   BAIT ${bait.carried} (G)  TRAIL CAM ${trailCams.carried} (T)  LURE ${audioLures.carried} (L)` +
    cryptids.cryptids.map((c) => `\n${c.profile.name}: ${c.state.toUpperCase()} ${c.playerDistance.toFixed(1)} m` +
      (c.perception ? `  hear ${c.perception.hearLevel.toFixed(2)} see ${Math.max(c.perception.sightLevel, c.perception.beamLevel).toFixed(2)} aware ${c.perception.awareness.toFixed(2)}${c.perception.detected ? ' DETECTED' : ''}` : '')).join('') +
    (clueTrails.debug ? `\nDEBUG PATH ON (F3)  clues: ${clues.clues.length}` : '');
  bars.showNoise = noiseRing.enabled;   // the noise readout is a debug aid (N)
  bars.update();
  noiseRing.update();
  clueFinder.update();
  journalUI.update(dt);
  dread.render();
  if (dreadAudio) { dreadAudio.tick(); if ((dreadAudioAt -= dt) <= 0) { dreadAudioAt = 0.5; dreadAudio.set(dread.level); } }
  aiDebug.update(camera);
  night?.update(player.position, dt);
  water?.update(dt);
  atmosphere?.update(dt);
  cine?.update(dt);
  trailReader.update(dt);
  drawFrame();
}
const sim = new FixedStepLoop({ simulate, present,
  tracked: () => [camera, ...cryptids.cryptids.map((c) => c.mesh)] });
sim.paused = new URLSearchParams(location.search).has('simpaused');   // tests drive the sim themselves
const clock = new THREE.Clock();
// Status screen (#71, GDD 2.11 / 13.1): Tab. One consolidated model names each condition's root
// cause, effect and recovery, and warns (SOON) before any penalty applies (NOW). It also feeds the
// HUD warning list, so there's one list, not one per system. The hunt pauses while it's open.
const status = new StatusModel({ player, survival, fear, flashlight });
status.dread = dread;   // #114: dread shows on the status screen
const statusScreen = new StatusScreen({ model: status, input });
survival.setWarningSource(() => status.hudWarnings());

// WebXR (#74): Enter VR appears only when immersive VR is supported. Leaving VR, the headset going
// hidden, tracking loss or a hidden tab pauses the simulation safely (no time passes).
const pauseState = new PauseState();
mountPauseScreen(pauseState);
// VR input parity and comfort (#75, GDD 13.1 / 16.2 / 16.3): active whenever the XR session above
// is presenting. Controllers submit the same intents as keyboard and mouse; snap/smooth turn,
// validated teleport, seated / one-handed / left-handed layouts; the pause control uses pauseState.
const xr = new XRControls({ renderer, camera, scene, game: { player, input, colliders, map, cryptids, survival, fear, hunt, photo, statusScreen, pauseState } });
const vr = new WebXRPresenter({ renderer, pause: pauseState, notify: (m) => photo.toast(m),
  onEnter: () => { overlay.classList.add('hidden'); },
  onExit: () => { pixels.resize?.(); } });
vr.mountButtons([document.querySelector('#overlay > div')]);
vr.detect();
vr.watchPage();
// The renderer's loop runs on XRSession.requestAnimationFrame while in VR, the page's otherwise.
// Profiling recorder (#67, GDD 17): a dev tool, opt-in. F6 opens its panel; ?profile starts recording
// at load. It reads frame timings and game events; it never changes the game or the save.
const profiler = new ProfilingRecorder({ build: 'dev', gym: map.gym ? map.gym.toLowerCase() : 'none', scenario: mapId, platform: 'desktop', seed: getSeed(),
  getTick: () => sim.tick });
attachProbes(profiler, { photo, trailCams, journal, hunt, camp, pauseState });
const profilerPanel = new ProfilerPanel(profiler);
if (new URLSearchParams(location.search).has('profile')) { profiler.start(); profilerPanel.toggle(true); }
let lastFrameAt = null;
renderer.setAnimationLoop((time, xrFrame) => {
  const frameStart = performance.now();
  profiler.meta.platform = vr.presenting ? 'immersive-webxr' : 'desktop';
  const dt = clock.getDelta();
  vr.onFrame(xrFrame, dt);
  // sim.paused: tests drive the simulation directly with sim.step() / sim.frame(dt).
  if (sim.paused || pauseState.paused || statusScreen.open) drawFrame();
  else sim.frame(dt);
  if (lastFrameAt != null) profiler.frame(frameStart - lastFrameAt, performance.now() - frameStart);
  lastFrameAt = frameStart;
});

// Test/debug hook (used by automated captures).
// Gym G00 (#77): ?map=gym&seed=N&simpaused, then __gym.run() replays the bench script.
if (map.gym === 'G00') window.__gym = { run: (opts) => runG00(window.__game, opts) };
window.__game = { dread, buildDreadAudio, sponsorSurvey,scent, equipment, equipmentPanel, fieldKit, fieldCamp, weather, expedition, evidenceArchive, supplier, ITEMS, THREE, bars, evidence, profiler, profilerPanel, settings, keyRemap, gamepad, captions, settingsPanel, fieldMap, vr, xr, pauseState, status, statusScreen, survival, sim, seed: getSeed(), shop, viewmodel, water, pixels, cine, atmosphere, rocks, escalation, cryptidEvents, textCard, story, reputation, camp, loadout, nightVision, knocks, trailCams, audioLures, synthWhoop, fear, night, levelFlow, HUNT, aiDebug, sandbox, hunt, photo, bait, map, mapId, player, huntFailure, noiseRing, flashlight, batteries, mothman, chupacabra, cryptids, cryptidProfiles: PROFILES, clues, clueTrails, journal, clueFinder, journalUI, trailReader, input, scene, camera, renderer, overlay };
// Gyms G02–G04 (#108): ?map=g02|g03|g04 (&blind, &simpaused). HUD: links to every gym, Reset (reload
// the same fixture and seed), Run script, Blind. window.__gym.run() plays the scripted checks.
if (GYM_RUNS[map.gym]) {
  gymHarness = new GymHarness({ game: window.__game, map, seed: getSeed(), blind: new URLSearchParams(location.search).has('blind') });
  window.__game.gymHarness = gymHarness;
  window.__gym = { harness: gymHarness, run: () => GYM_RUNS[map.gym](window.__game, gymHarness), reset: () => gymHarness.reset() };
  gymHarness.onRun = () => { const r = window.__gym.run(); console.info('[gym]', r); };
}
