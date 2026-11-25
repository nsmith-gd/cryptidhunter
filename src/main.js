import * as THREE from 'three';
import { Input } from './input.js';
import { Player } from './player.js';
import { buildTestMap } from './testMap.js';
import { Flashlight } from './flashlight.js';
import { CryptidManager } from './cryptids/cryptidManager.js';
import { PROFILES } from './cryptids/profiles.js';
import { Mothman } from './cryptids/mothman.js';
import { Chupacabra } from './cryptids/chupacabra.js';
import { BatteryPickups } from './pickups.js';
import { Hud } from './hud.js';
import { NoiseRing } from './noiseRing.js';

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

const { colliders, bounds, spawns } = buildTestMap(scene);
const input = new Input(renderer.domElement);
const player = new Player(camera, input, colliders);
scene.add(camera); // camera carries the flashlight
const flashlight = new Flashlight(camera, input);
const mothman = new Mothman(scene, player, flashlight);
const chupacabra = new Chupacabra(scene, player, camera, colliders);
const batteries = new BatteryPickups(scene, player, flashlight);
const bars = new Hud(player, flashlight);
const noiseRing = new NoiseRing(scene, player);

// Cryptids. Bigfoot is the forest's starter cryptid; the map can give it a spawn point.
const cryptids = new CryptidManager({ scene, colliders, halfSize: bounds, getPlayerPosition: () => player.position });
const bigfootSpawn = spawns?.bigfoot ?? { x: 10, z: -25 };
cryptids.spawn(PROFILES.bigfoot, bigfootSpawn.x, bigfootSpawn.z);

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
  flashlight.update(dt);
  batteries.update(dt);
  cryptids.update(dt);
  mothman.update(dt);
  chupacabra.update(dt);
  const v = Math.hypot(player.velocity.x, player.velocity.z);
  hud.textContent = `${player.crouching ? 'CROUCH' : player.sprinting ? 'SPRINT' : 'WALK'}  ${v.toFixed(1)} m/s   LIGHT ${flashlight.on ? 'ON' : 'OFF'}` +
    cryptids.cryptids.map((c) => `\n${c.profile.name}: ${c.state.toUpperCase()} ${c.playerDistance.toFixed(1)} m`).join('');
  bars.update();
  noiseRing.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by automated captures).
window.__game = { THREE, player, noiseRing, flashlight, batteries, mothman, chupacabra, cryptids, cryptidProfiles: PROFILES, input, scene, camera, renderer, overlay };
