import * as THREE from 'three';
import { setSeed, randomSeed, getSeed } from './core/rng.js';
import { FixedStepLoop } from './core/simLoop.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { buildTestMap } from './testMap.js';
import { buildSwampMap } from './maps/swamp.js';
import { buildForestMap } from './maps/forest.js';
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
import { Survival } from './survival/survival.js';
import { StatusModel } from './ui/statusModel.js';
import { StatusScreen } from './ui/statusScreen.js';
import { XRControls } from './xr/xrControls.js';
import { Camp, gearList, huntSummary, showCampPanel } from './hunt/camp.js';
import { showBountyPanel } from './hunt/bountyPanel.js';
import { applyUpgrades, showShopPanel } from './hunt/shop.js';
import { Loadout, showLoadoutPicker } from './gear/loadout.js';
import { resolveMap, showMapPicker, TARGET_BY_MAP } from './hunt/mapSelect.js';
import { renderAlbum } from './hunt/album.js';
import { BaitManager, BAIT } from './gear/bait.js';
import { PixelPipeline } from './render/pixelPipeline.js';
import { CinematicLighting } from './maps/cinematicLighting.js';

// One world seed per run (#66): ?seed=N replays a run exactly; otherwise a fresh one is logged.
setSeed(Number(new URLSearchParams(location.search).get('seed')) || randomSeed());
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
const camp = new Camp();
// Map: chosen on the start screen (locked ones need reputation); ?map=forest|swamp overrides.
const MAPS = { test: buildTestMap, swamp: buildSwampMap, forest: buildForestMap };
const mapId = resolveMap(location.search, camp);
const huntTarget = TARGET_BY_MAP[mapId] ?? 'Bigfoot';
const map = (MAPS[mapId] ?? buildTestMap)(scene);
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
const packed = camp.packForHunt();
const hunt = new HuntLoop({ scene, player, journal: null, colliders, target: huntTarget,
  onEnd: (outcome) => {
    const h = camp.settleHunt({
      outcome, target: huntTarget, dawnBonus: outcome === 'complete' && !hunt.dawned ? HUNT.dawnBonus : 0,
      photos: hunt.photos.map((p) => ({ subject: p.subject, score: p.score })),
      gearLeft: loadout.gearLeft(),   // what you carried comes home; gear left at camp is untouched
    });
    const summary = huntSummary(h);
    reputation.set(camp.state.reputation ?? 0);   // keep the live reputation in step with camp
    if (outcome === 'caught') huntFailure.reason.textContent += `\n\n${summary}\nYou kept your gear: ${gearList(h.gear)}.`;
    if (outcome === 'caught') huntFailure.screen.append(renderAlbum(photo.log, { filmTotal: photo.filmTotal, lost: true, target: huntTarget }));
    return { summary, money: camp.state.money, entry: h };
  },
  // First light: every cryptid bolts for cover and is gone from the area a little later.
  onDawn: () => {
    for (const c of cryptids.cryptids) { c.leavingAtDawn = true; c.enterFlee?.(player.position, 'dawn: leaving'); }
    setTimeout(() => { for (const c of cryptids.cryptids) c.mesh.visible = false; cryptids.clear(); }, 20000);
  } });
showCampPanel(camp);
showBountyPanel(camp.bounties);   // #45: offers for specific photos, paid once when you sell a match
// End-of-hunt photo album: every frame shot this hunt (lost if you were caught).
hunt.album = (outcome) => renderAlbum(photo.log, { filmTotal: photo.filmTotal, lost: outcome === 'caught' || outcome === 'dawn', target: huntTarget });
hunt.screen.style.overflowY = 'auto';
showMapPicker({ current: mapId, reputation: camp.state.reputation ?? 0, onPick: (id) => {
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
const survival = new Survival({ player, input,
  map: { ...map, environment: { ...map.environment, airTemp: map.environment?.airTemp ?? ({ forest: 6, swamp: 13 }[mapId] ?? 10) } },
  heatSources: () => [
    ...(map.landmarks?.campsite ? [{ ...map.landmarks.campsite, r: 4.5, name: 'campfire' }] : []),
    ...(map.safeZones ?? []).map((z) => ({ x: z.x, z: z.z, r: z.r, name: z.name })),
    { x: HUNT.exit.x, z: HUNT.exit.z, r: 6, name: 'the van' },
  ] });
const noiseRing = new NoiseRing(scene, player);

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
  if (type === 'whoop') { audioLures.playCall({ x: e.cryptid.agent.x, z: e.cryptid.agent.z }); fear.scare(8, 'whoop'); photo.toast(`A deep whoop, ${where(e.cryptid.agent.x, e.cryptid.agent.z)}. It knows you're here.`); }
  if (type === 'rock') { fear.scare(e.distance < 3 ? 22 : 12, 'rock'); photo.toast(`A rock slams into the ground ${e.distance.toFixed(0)} m from you. Back off.`); }
  if (type === 'rock-hit') { fear.scare(35, 'rock hit'); player.velocity.x += (player.position.x - e.x) * 6; player.velocity.z += (player.position.z - e.z) * 6; }
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
const journalUI = new JournalUI(journal, clueFinder);
hunt.journal = journal;

// Level flow: spawn this hunt's Bigfoot. On maps with spawn zones (the forest) it picks where it
// beds down and where its fresh trail starts, and walks that route so the clues are real.
// Bigfoot lives in the forest/test map, not the swamp (Mothman's home).
const levelFlow = new LevelFlow({ scene, map });
if (mapId !== 'swamp') levelFlow.spawnCryptid({ cryptids, profile: PROFILES.bigfoot, clueTrails, clues });
// Sandbox also gets a hostile stand-in on the shared brain, to exercise the Aggress state.
if (sandbox && mapId === 'test') cryptids.spawn(PROFILES.prowler, -15, 15);
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
  getShake: () => fear.swaySpeed,
});
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
const loadout = new Loadout({ owned: packed, slots: urlLoadout ?? camp.state.loadout, input,
  gear: { bait, trailCams, audioLures, nightVision, knocks, flashlight } });
photo.onLoweredClick = () => loadout.use();
const picker = showLoadoutPicker({ owned: packed, slots: loadout.slots, onChange: (slots) => {
  if (hunt.stage !== 'briefing') return;         // packing happens before you set off
  camp.state.loadout = slots; camp.save();
  loadout.setSlots(slots);
} });
// Shop (#46): buy gear and permanent upgrades at base camp, before you set off. Upgrades are
// saved with camp and applied to the camera and torch at the start of every hunt.
applyUpgrades(camp, { photo, flashlight });
const shop = showShopPanel(camp, {
  canBuy: () => hunt.stage === 'briefing',
  onChange: ({ kind, key }) => {
    if (kind === 'gear') {                       // bought gear is packable right away
      packed[key] = camp.state.gear[key];
      loadout.setSlots(loadout.slots);
      picker?.refresh?.();
    } else applyUpgrades(camp, { photo, flashlight });
    const cp = document.getElementById('camp-panel');
    if (cp) cp.textContent = cp.textContent.replace(/BASE CAMP {2}· {2}\$\d+/, `BASE CAMP  ·  $${camp.state.money}`);
  },
});
// First-person hands and gear: torch in the right hand, camera in the left, goggles and trail cam on use.
const viewmodel = new Viewmodel({ camera, player, flashlight, photo, nightVision, trailCams });

// Getting touched by a cryptid ends the hunt.
const huntFailure = new HuntFailure({
  player,
  getThreats: () => [
    ...cryptids.cryptids.map((c) => ({ name: c.profile.name, x: c.agent.x, z: c.agent.z, y0: 0, y1: c.profile.height, radius: c.profile.radius, catchHits: c.profile.catchHits ?? 1 })),
    ...(!sandbox ? [] : [
    { name: 'The Mothman', x: mothman.mesh.position.x, z: mothman.mesh.position.z, y0: mothman.mesh.position.y - 0.8, y1: mothman.mesh.position.y + 0.8, radius: 0.8, catchHits: MOTHMAN.catchHits },
    { name: 'The Chupacabra', x: chupacabra.position.x, z: chupacabra.position.z, y0: 0, y1: 0.55, radius: 0.45, catchHits: CHUPA.catchHits },
    ]),
  ],
});
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
const drawFrame = () => pixels.frame(() => { water?.renderReflection(); if (!nightVision.render()) renderer.render(scene, camera); });

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
story.start(camp.state.hunts.length === 0 && camp.state.money === 0);
story.reputationChanged(reputation.value, reputation.max);
addEventListener('keydown', (e) => { if (e.code === 'F8') { e.preventDefault(); reputation.set(reputation.max); } });

const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => input.requestLock());
document.addEventListener('pointerlockchange', () => {
  overlay.classList.toggle('hidden', input.locked);
  if (input.locked) { hunt.start(); if (picker) picker.el.style.display = 'none'; }   // the night clock starts with the first click into the game
});

const hud = document.getElementById('hud');
// Fixed-step loop (#66): the world simulates in exact 1/60 s steps whatever the frame rate;
// rendering, HUD and post effects run once per drawn frame with positions interpolated.
const ended = () => huntFailure.isCaught || hunt.stage === 'ended';
function simulate(dt) {
  xr.update(dt);                 // VR controllers -> the same intents as keyboard/mouse (before the player reads them)
  if (huntFailure.isCaught && hunt.stage !== 'ended') hunt.end('caught');
  if (ended()) return;                       // world freezes behind the end screens
  player.update(dt);
  survival.update(dt);
  fear.update(dt);
  fear.applySway(dt);                        // after the player sets the view; sim-timed so photos blur the same at any fps
  photo.update(dt);
  flashlight.update(dt);
  batteries.update(dt);
  bait.update(dt);
  cryptids.update(dt);
  knocks.update(dt);
  clueTrails.update();
  clues.update(dt);
  journal.update(dt);
  if (sandbox) {
    mothman.update(dt);
    chupacabra.update(dt);
  }
  rocks.update(dt);
  audioLures.update(dt);
  trailCams.update(dt);
  hunt.update(dt);
  huntFailure.update(dt);
}
function present(dt) {
  if (huntFailure.isCaught && hunt.stage !== 'ended') hunt.end('caught');
  if (ended()) { drawFrame(); return; }
  nightVision.update(dt);
  viewmodel.update(dt);
  loadout.render();
  survival.render();
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
const statusScreen = new StatusScreen({ model: status, input });
survival.setWarningSource(() => status.hudWarnings());
// VR input parity and comfort (#75, GDD 13.1 / 16.2 / 16.3): active whenever an XR session is
// presenting. Controllers submit the same intents as keyboard and mouse; snap/smooth turn,
// validated teleport, seated and one-handed layouts. (Entering VR itself is the #74 entry point.)
const xr = new XRControls({ renderer, camera, scene, game: { player, input, colliders, map, cryptids, survival, fear, hunt, photo, statusScreen } });

function frame() {
  // sim.paused: tests drive the simulation directly with sim.step() / sim.frame(dt).
  if (!sim.paused && !statusScreen.open) sim.frame(clock.getDelta()); else { clock.getDelta(); drawFrame(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by automated captures).
window.__game = { THREE, xr, status, statusScreen, survival, sim, seed: getSeed(), shop, viewmodel, water, pixels, cine, atmosphere, rocks, escalation, cryptidEvents, textCard, story, reputation, camp, loadout, nightVision, knocks, trailCams, audioLures, synthWhoop, fear, night, levelFlow, HUNT, aiDebug, sandbox, hunt, photo, bait, map, mapId, player, huntFailure, noiseRing, flashlight, batteries, mothman, chupacabra, cryptids, cryptidProfiles: PROFILES, clues, clueTrails, journal, clueFinder, journalUI, trailReader, input, scene, camera, renderer, overlay };
