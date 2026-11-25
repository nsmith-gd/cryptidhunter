import * as THREE from 'three';
import { Input } from './input.js';
import { Player } from './player.js';
import { buildTestMap } from './testMap.js';
import { buildSwampMap } from './maps/swamp.js';
import { buildForestMap } from './maps/forest.js';
import { NightLighting } from './maps/nightLighting.js';
import { Flashlight } from './flashlight.js';
import { CryptidManager } from './cryptids/cryptidManager.js';
import { PROFILES } from './cryptids/profiles.js';
import { AIDebug } from './cryptids/aiDebug.js';
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
import { Camp, gearList, huntSummary, showCampPanel } from './hunt/camp.js';
import { BaitManager, BAIT } from './gear/bait.js';
import { PixelPipeline } from './render/pixelPipeline.js';

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

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);

// Faint moonlight so silhouettes are just readable without the flashlight.
const hemi = new THREE.HemisphereLight(0x4a5a78, 0x0a0a0c, 0.12);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x8fa6d8, 0.08);
moon.position.set(15, 25, 10);
scene.add(moon);

// Pick the map with ?map=forest or ?map=swamp (default: the greybox test map).
const MAPS = { test: buildTestMap, swamp: buildSwampMap, forest: buildForestMap };
const mapId = new URLSearchParams(location.search).get('map') ?? 'test';
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
const camp = new Camp();
addEventListener('pagehide', () => camp.save());   // save on quit (money is also saved whenever it changes)
const packed = camp.packForHunt();
const hunt = new HuntLoop({ scene, player, journal: null, colliders, target: 'Bigfoot',
  onEnd: (outcome) => {
    const h = camp.settleHunt({
      outcome, target: 'Bigfoot', dawnBonus: outcome === 'complete' && !hunt.dawned ? HUNT.dawnBonus : 0,
      photos: hunt.photos.map((p) => ({ subject: p.subject, score: p.score })),
      gearLeft: { bait: bait.carried, spareBatteries: flashlight.spares },
    });
    const summary = huntSummary(h);
    if (outcome === 'caught') huntFailure.reason.textContent += `\n\n${summary}\nYou kept your gear: ${gearList(h.gear)}.`;
    return { summary, money: camp.state.money, entry: h };
  },
  // First light: every cryptid bolts for cover and is gone from the area a little later.
  onDawn: () => {
    for (const c of cryptids.cryptids) { c.leavingAtDawn = true; c.enterFlee?.(player.position, 'dawn: leaving'); }
    setTimeout(() => { for (const c of cryptids.cryptids) c.mesh.visible = false; cryptids.clear(); }, 20000);
  } });
showCampPanel(camp);
scene.add(camera); // camera carries the flashlight
const flashlight = new Flashlight(camera, input);
// Outdoor maps can opt into the night lighting baseline (moon, haze, ambient, sky).
const night = map.environment?.night ? new NightLighting({ scene, camera, hemi, moon, flashlight, config: map.environment.night }) : null;
const mothman = new Mothman(scene, player, flashlight);
const chupacabra = new Chupacabra(scene, player, camera, colliders);
mothman.mesh.visible = chupacabra.mesh.visible = sandbox;
const batteries = new BatteryPickups(scene, player, flashlight);
// G drops bait; cryptids that smell it come to investigate.
const bait = new BaitManager(scene, player, input);
bait.carried = packed.bait;               // carry what base camp owns
flashlight.spares = packed.spareBatteries;
// L sets an audio lure: it plays a Bigfoot call every few seconds and Bigfoot comes to check.
const audioLures = new AudioLures({ scene, player, input, notify: (m) => photo?.toast(m) });
// Fear: rises in the dark, near cryptids and on scares; light and the van calm you; high fear sways your aim.
const fear = new Fear({
  scene, player, flashlight, camera, safeZone: HUNT.exit, safeZones: map.safeZones ?? [],
  screenSway: new URLSearchParams(location.search).has('vr') ? 0 : undefined, // ?vr: no on-screen shake
  getThreats: () => [
    ...cryptids.cryptids.map((c) => ({ id: c.profile.name, x: c.agent.x, z: c.agent.z, state: c.state })),
    ...(sandbox ? [
      { id: 'Mothman', x: mothman.mesh.position.x, z: mothman.mesh.position.z },
      { id: 'Chupacabra', x: chupacabra.position.x, z: chupacabra.position.z },
    ] : []),
  ],
});
const bars = new Hud(player, flashlight, fear);
const noiseRing = new NoiseRing(scene, player);

// Cryptids. Bigfoot is the forest's starter cryptid; the map can give it a spawn point.
const cryptids = new CryptidManager({ scene, colliders, halfSize: bounds, getPlayerPosition: () => player.position,
  lures: { lures: () => bait.lures(), consume: (b) => bait.consume(b), eatTime: BAIT.eatTime },
  calls: audioLures,
  // Hearing + sight: they notice your noise, your silhouette and your flashlight.
  // ?nosenses falls back to the L0 fixed flee distance (used by older mechanic checks).
  senses: new URLSearchParams(location.search).has('nosenses') ? null
    : { player, flashlight, camera, lightLevel: map.environment?.lightLevel ?? 0 } });
// State-machine debug overlay (F4 toggles; ?nodebugai starts it hidden).
// Bigfoot knocks on trees now and then; K knocks back with your stick and can draw it closer.
const knocks = new WoodKnocks({ cryptids, player, camera, fear, input });
const aiDebug = new AIDebug(scene, cryptids, { visible: !new URLSearchParams(location.search).has('nodebugai') });

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
  onPhoto: (r) => hunt.onPhoto(r),
  getShake: () => fear.swaySpeed,
});
// T sets a trail camera facing where you look: it photographs any cryptid that walks into its
// view, on its own (grainy shots, lower score).
const trailCams = new TrailCameras({ scene, player, input, getSubjects: () => photo.getSubjects(),
  onPhoto: (r) => hunt.onPhoto(r), notify: (m) => photo.toast(m) });
// V toggles night-vision goggles: see in the dark (green, narrow view) without light; shares the
// flashlight's battery. Cryptids can't see it, unlike the torch.
const nightVision = new NightVision({ renderer, scene, camera, flashlight, hemi, input, photo, notify: (m) => photo.toast(m) });

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

const pixels = new PixelPipeline({ renderer, camera });
const drawFrame = () => pixels.frame(() => { if (!nightVision.render()) renderer.render(scene, camera); });

// Story cards (placeholder copy in story/cardText.js): the intro once on a new game, the finale
// once when reputation hits max. Reputation is a stub until the hub economy lands; debug:
// ?rep=<n> starts at n, F8 sets it to max, or __game.reputation.set(n).
const textCard = new TextCard();
const reputation = new ReputationStub(Number(new URLSearchParams(location.search).get('rep') ?? 0));
// Automated browser checks skip the cards (they'd eat the first key press) unless ?cards is given.
const cardsOn = !navigator.webdriver || new URLSearchParams(location.search).has('cards');
const story = new StoryCards({ show: (id) => (cardsOn ? textCard.show(id) : null) });
reputation.onChange((v, max) => story.reputationChanged(v, max));
story.start(camp.state.hunts.length === 0 && camp.state.money === 0);
story.reputationChanged(reputation.value, reputation.max);
addEventListener('keydown', (e) => { if (e.code === 'F8') { e.preventDefault(); reputation.set(reputation.max); } });

const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => input.requestLock());
document.addEventListener('pointerlockchange', () => {
  overlay.classList.toggle('hidden', input.locked);
  if (input.locked) hunt.start();   // the night clock starts with the first click into the game
});

const hud = document.getElementById('hud');
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (huntFailure.isCaught && hunt.stage !== 'ended') hunt.end('caught');
  if (huntFailure.isCaught || hunt.stage === 'ended') {   // world freezes behind the end screens
    drawFrame();
    requestAnimationFrame(frame);
    return;
  }
  player.update(dt);
  fear.update(dt);
  fear.applySway(dt);
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
  photo.update(dt);
  nightVision.update(dt);
  audioLures.update(dt);
  trailCams.update(dt);
  hunt.update(dt);
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
  huntFailure.update();
  aiDebug.update(camera);
  night?.update(player.position, dt);
  trailReader.update(dt);
  drawFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by automated captures).
window.__game = { THREE, pixels, textCard, story, reputation, camp, nightVision, knocks, trailCams, audioLures, synthWhoop, fear, night, levelFlow, HUNT, aiDebug, sandbox, hunt, photo, bait, map, mapId, player, huntFailure, noiseRing, flashlight, batteries, mothman, chupacabra, cryptids, cryptidProfiles: PROFILES, clues, clueTrails, journal, clueFinder, journalUI, trailReader, input, scene, camera, renderer, overlay };
