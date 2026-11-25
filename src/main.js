import * as THREE from 'three';
import { Input } from './input.js';
import { Player } from './player.js';
import { buildTestMap } from './testMap.js';

// Render at a low internal resolution and upscale with nearest-neighbour:
// the base of the game's 3D pixel-art look.
const PIXEL_SCALE = 3;

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7d8794);
scene.fog = new THREE.Fog(0x7d8794, 20, 60);

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);

scene.add(new THREE.HemisphereLight(0xc8d2dc, 0x3a3630, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: 80 });
scene.add(sun);

const { colliders } = buildTestMap(scene);
const input = new Input(renderer.domElement);
const player = new Player(camera, input, colliders);

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
  const v = Math.hypot(player.velocity.x, player.velocity.z);
  hud.textContent = `${player.crouching ? 'CROUCH' : player.sprinting ? 'SPRINT' : 'WALK'}  ${v.toFixed(1)} m/s`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by automated captures).
window.__game = { player, input, scene, camera, renderer, overlay };
