import * as THREE from 'three';
import { Input } from './input.js';
import { Player } from './player.js';
import { buildTestMap } from './testMap.js';
import { buildSwampMap } from './maps/swamp.js';
import { Flashlight } from './flashlight.js';
import { CryptidManager } from './cryptids/cryptidManager.js';
import { PROFILES } from './cryptids/profiles.js';
import { Mothman, MOTHMAN } from './cryptids/mothman.js';
import { Chupacabra } from './cryptids/chupacabra.js';

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

// Pick the map with ?map=swamp (default: the greybox test map).
const MAPS = { test: buildTestMap, swamp: buildSwampMap };
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
const input = new Input(renderer.domElement);
const player = new Player(camera, input, colliders);
player.speedAt = map.speedAt ?? null;
if (map.playerStart) { player.position.set(map.playerStart.x, 0, map.playerStart.z); player.yaw = map.playerStart.yaw ?? 0; }
scene.add(camera); // camera carries the flashlight
const flashlight = new Flashlight(camera, input);
const mothman = new Mothman(scene, player, flashlight);
// The stalker placeholder lives in the test map only for now.
const chupacabra = mapId === 'swamp' ? null : new Chupacabra(scene, player, camera, colliders);

// Cryptids. Bigfoot is the forest's starter cryptid; the map can give it a spawn point.
const cryptids = new CryptidManager({ scene, colliders, halfSize: bounds, getPlayerPosition: () => player.position });
// Bigfoot lives in the forest/test map, not the swamp.
if (mapId !== 'swamp') {
  const bigfootSpawn = spawns?.bigfoot ?? { x: 10, z: -25 };
  cryptids.spawn(PROFILES.bigfoot, bigfootSpawn.x, bigfootSpawn.z);
}

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
document.addEventListener('pointerlockchange', () => overlay.classList.toggle('hidden', input.locked));

const hud = document.getElementById('hud');
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);
  cryptids.update(dt);
  mothman.update(dt);
  chupacabra?.update(dt);
  const v = Math.hypot(player.velocity.x, player.velocity.z);
  const wading = map.surfaceAt?.(player.position.x, player.position.z, player.position.y);
  const gait = player.crouching ? 'CROUCH' : player.sprinting ? 'SPRINT' : 'WALK';
  hud.textContent = `${gait}${wading === 'shallow' ? ' (WADING)' : wading === 'deep' ? ' (DEEP WATER)' : ''}  ${v.toFixed(1)} m/s   LIGHT ${flashlight.on ? 'ON' : 'OFF'}` +
    cryptids.cryptids.map((c) => `\n${c.profile.name}: ${c.state.toUpperCase()} ${c.playerDistance.toFixed(1)} m`).join('');
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by automated captures).
window.__game = { THREE, map, mapId, player, flashlight, mothman, chupacabra, cryptids, cryptidProfiles: PROFILES, input, scene, camera, renderer, overlay };
