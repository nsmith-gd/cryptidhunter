import * as THREE from 'three';
import { Input } from './input.js';
import { Player } from './player.js';
import { buildTestMap } from './testMap.js';
import { buildSwampMap } from './maps/swamp.js';
import { buildForestMap } from './maps/forest.js';
import { Flashlight } from './flashlight.js';
import { CryptidManager } from './cryptids/cryptidManager.js';
import { PROFILES } from './cryptids/profiles.js';
import { AIDebug } from './cryptids/aiDebug.js';
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
import { LevelFlow } from './hunt/levelFlow.js';
import { PhotoCamera } from './hunt/photoCamera.js';
import { Fear } from './hunt/fear.js';
import { BaitManager, BAIT } from './gear/bait.js';

// Render at a low internal resolution and upscale with nearest-neighbour:
// the base of the game's 3D pixel-art look.
const PIXEL_SCALE = 3;

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
scene.add(new THREE.HemisphereLight(0x4a5a78, 0x0a0a0c, 0.12));
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
// The night's hunt: briefing -> track -> photograph Bigfoot -> back to the van before dawn.
// The extraction van parks at the map's exit spot (or 7 m behind the start). Built before the
// cryptids so it's baked into their walkable grid.
if (map.exit) HUNT.exit.set(map.exit.x, 0, map.exit.z);
else HUNT.exit.set(player.position.x + Math.sin(player.yaw) * 7, 0, player.position.z + Math.cos(player.yaw) * 7);
const hunt = new HuntLoop({ scene, player, journal: null, colliders, target: 'Bigfoot' });
scene.add(camera); // camera carries the flashlight
const flashlight = new Flashlight(camera, input);
const mothman = new Mothman(scene, player, flashlight);
const chupacabra = new Chupacabra(scene, player, camera, colliders);
mothman.mesh.visible = chupacabra.mesh.visible = sandbox;
const batteries = new BatteryPickups(scene, player, flashlight);
// G drops bait; cryptids that smell it come to investigate.
const bait = new BaitManager(scene, player, input);
// Fear: rises in the dark, near cryptids and on scares; light and the van calm you; high fear sways your aim.
const fear = new Fear({
  scene, player, flashlight, camera, safeZone: HUNT.exit,
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
  // Hearing + sight: they notice your noise, your silhouette and your flashlight.
  // ?nosenses falls back to the L0 fixed flee distance (used by older mechanic checks).
  senses: new URLSearchParams(location.search).has('nosenses') ? null
    : { player, flashlight, camera, lightLevel: map.environment?.lightLevel ?? 0 } });
// State-machine debug overlay (F4 toggles; ?nodebugai starts it hidden).
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

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(Math.ceil(w / PIXEL_SCALE), Math.ceil(h / PIXEL_SCALE), false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => input.requestLock());
document.addEventListener('pointerlockchange', () => {
  overlay.classList.toggle('hidden', input.locked);
  if (input.locked) hunt.start();   // the dawn clock starts with the first click into the game
});

const hud = document.getElementById('hud');
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (huntFailure.isCaught && hunt.stage !== 'ended') hunt.end('caught');
  if (huntFailure.isCaught || hunt.stage === 'ended') {   // world freezes behind the end screens
    renderer.render(scene, camera);
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
  clueTrails.update();
  clues.update(dt);
  journal.update(dt);
  if (sandbox) {
    mothman.update(dt);
    chupacabra.update(dt);
  }
  photo.update(dt);
  hunt.update(dt);
  const v = Math.hypot(player.velocity.x, player.velocity.z);
  const wading = map.surfaceAt?.(player.position.x, player.position.z, player.position.y);
  const gait = player.crouching ? 'CROUCH' : player.sprinting ? 'SPRINT' : 'WALK';
  hud.textContent = `${gait}${wading === 'shallow' ? ' (WADING)' : wading === 'deep' ? ' (DEEP WATER)' : ''}  ${v.toFixed(1)} m/s   LIGHT ${flashlight.on ? 'ON' : 'OFF'}   BAIT ${bait.carried} (G)` +
    cryptids.cryptids.map((c) => `\n${c.profile.name}: ${c.state.toUpperCase()} ${c.playerDistance.toFixed(1)} m` +
      (c.perception ? `  hear ${c.perception.hearLevel.toFixed(2)} see ${Math.max(c.perception.sightLevel, c.perception.beamLevel).toFixed(2)} aware ${c.perception.awareness.toFixed(2)}${c.perception.detected ? ' DETECTED' : ''}` : '')).join('') +
    (clueTrails.debug ? `\nDEBUG PATH ON (F3)  clues: ${clues.clues.length}` : '');
  bars.update();
  noiseRing.update();
  clueFinder.update();
  journalUI.update(dt);
  huntFailure.update();
  aiDebug.update(camera);
  trailReader.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by automated captures).
window.__game = { THREE, fear, levelFlow, HUNT, aiDebug, sandbox, hunt, photo, bait, map, mapId, player, huntFailure, noiseRing, flashlight, batteries, mothman, chupacabra, cryptids, cryptidProfiles: PROFILES, clues, clueTrails, journal, clueFinder, journalUI, trailReader, input, scene, camera, renderer, overlay };
