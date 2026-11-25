// Style-guide mockup boards, rendered with the game's own textures and renderer settings.
// Open with ?board=palette | textures | diorama&view=N (vite dev server). Used by tools/capture-t33.mjs.
import * as THREE from 'three';
import { RAMPS, TEXEL_DENSITY } from '../../src/art/palette.js';
import { FOREST_TEXTURES as F } from '../../src/art/forestTex.js';
import { pixelMaterial } from '../../src/art/pixelTex.js';

const q = new URLSearchParams(location.search);
const board = q.get('board') ?? 'palette';
const W = 1280, H = 720;

function canvas2d() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  document.body.appendChild(c);
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.fillStyle = '#0b0d10'; g.fillRect(0, 0, W, H);
  return g;
}

if (board === 'palette') {
  const g = canvas2d();
  g.fillStyle = '#d8d2c4'; g.font = 'bold 20px monospace'; g.fillText('CRYPTID HUNTER · MASTER PALETTE', 40, 46);
  g.font = '12px monospace'; g.fillStyle = '#8c8e88';
  g.fillText('Ramps run dark → light. Shadows shift cool (blue/violet), lights shift warm. No pure black or white.', 40, 68);
  let y = 92;
  for (const [name, cols] of Object.entries(RAMPS)) {
    g.fillStyle = '#b6aa96'; g.font = '13px monospace'; g.fillText(name, 40, y + 22);
    cols.forEach((c, i) => {
      g.fillStyle = c; g.fillRect(150 + i * 92, y, 88, 32);
      g.fillStyle = i < 3 ? '#8c8e88' : '#0b0d10'; g.font = '10px monospace'; g.fillText(c, 154 + i * 92, y + 27);
    });
    y += 38;
  }
  window.__ready = true;
}

if (board === 'textures') {
  const g = canvas2d();
  g.fillStyle = '#d8d2c4'; g.font = 'bold 20px monospace';
  g.fillText(`PINE HOLLOW TEXTURE SET · ${TEXEL_DENSITY} texels per metre · shown 2×2 tiled (no seams)`, 40, 44);
  const list = [
    ['bark (1×2 m)', F.pineBarkTexture()], ['dirt / trail (2 m)', F.dirtTexture()], ['leaf litter (2 m)', F.leafLitterTexture()],
    ['moss (1 m)', F.mossTexture()], ['granite (2 m)', F.rockTexture()], ['grass ground (2 m)', F.grassTexture()], ['pine needles (1 m)', F.needleTexture()], ['grass tuft card', F.grassTuftTexture()],
  ];
  // Every tile drawn at the same texel scale (3 screen px per texel), tiled 2x2.
  const S = 3;
  let x = 40, y = 70, rowH = 0;
  for (const [label, t] of list) {
    const img = t.image, tw = img.width * 2 * S, th = img.height * 2 * S;
    if (x + tw > W - 30) { x = 40; y += rowH + 34; rowH = 0; }
    if (label.startsWith('grass tuft')) { g.fillStyle = '#1d2a33'; g.fillRect(x, y, tw, th); }
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) g.drawImage(img, x + i * img.width * S, y + j * img.height * S, img.width * S, img.height * S);
    g.fillStyle = '#b6aa96'; g.font = '12px monospace'; g.fillText(label, x, y + th + 16);
    x += tw + 26; rowH = Math.max(rowH, th);
  }
  window.__ready = true;
}

if (board === 'diorama') {
  // A pocket of Pine Hollow at night: dirt trail, litter, moss, a granite boulder, pines and
  // grass tufts; cold moonlight + one warm lantern, haze; rendered at 1/3 resolution.
  const PIXEL_SCALE = 3;
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W / PIXEL_SCALE, H / PIXEL_SCALE, false);
  renderer.domElement.style.width = `${W}px`; renderer.domElement.style.height = `${H}px`;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(RAMPS.night[2]);
  scene.fog = new THREE.FogExp2(RAMPS.night[2], 0.045);
  const camera = new THREE.PerspectiveCamera(70, W / H, 0.05, 200);

  scene.add(new THREE.HemisphereLight(RAMPS.night[4], RAMPS.dirt[0], 0.55));
  const moon = new THREE.DirectionalLight(RAMPS.night[6], 0.9);
  moon.position.set(-12, 18, -20); moon.castShadow = true;
  Object.assign(moon.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
  moon.shadow.mapSize.set(1024, 1024);
  scene.add(moon);

  const tiled = (tex, sx, sy) => pixelMaterial(tex, { repeat: [sx, sy] });
  // Ground: litter everywhere, a dirt trail through it, grass at the edges, moss under trees.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), tiled(F.leafLitterTexture(), 20, 20));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 40), tiled(F.dirtTexture(), 1.2, 20));
  trail.rotation.x = -Math.PI / 2; trail.rotation.z = 0.18; trail.position.y = 0.01; trail.receiveShadow = true; scene.add(trail);
  for (const [x, z, s] of [[-4, -3, 3], [4.5, -8, 4], [-6, -12, 5]]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(s, 10), tiled(F.mossTexture(), s * 2, s * 2));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.015, z); m.receiveShadow = true; scene.add(m);
  }
  // Pines: bark trunk (lathe) + stacked needle cones.
  const needleMat = pixelMaterial(F.needleTexture(), { repeat: [4, 2], flatShading: true });
  const pine = (x, z, h, r) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector2(r * (1 - 0.7 * t) * (1 + 0.5 * Math.pow(1 - Math.min(1, t * 5), 2)), t * h)); }
    const geo = new THREE.LatheGeometry(pts, 8);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r, uv.getY(i) * h / 2);
    const trunk = new THREE.Mesh(geo, pixelMaterial(F.pineBarkTexture())); trunk.position.set(x, 0, z);
    trunk.castShadow = trunk.receiveShadow = true; scene.add(trunk);
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(2.4 - k * 0.45, 2.6, 7), needleMat);
      c.position.set(x, h * 0.45 + k * 1.5, z); c.castShadow = true; scene.add(c);
    }
  };
  for (const [x, z, h, r] of [[-3.2, -4, 13, 0.42], [3.6, -9, 15, 0.5], [-6.5, -14, 14, 0.45], [7, -3, 12, 0.38], [1, -20, 16, 0.5], [-10, -6, 13, 0.4], [10, -14, 14, 0.45]]) pine(x, z, h, r);
  // Granite boulder with moss on top.
  const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(1.3, 0), tiled(F.rockTexture(), 1.3, 1.3));
  boulder.scale.set(1.4, 0.8, 1.1); boulder.position.set(2.2, 0.5, -5); boulder.rotation.y = 0.6;
  boulder.castShadow = boulder.receiveShadow = true; scene.add(boulder);
  const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0, 0), tiled(F.mossTexture(), 1, 1));
  cap.scale.set(1.5, 0.35, 1.1); cap.position.set(2.1, 1.05, -5); cap.rotation.y = 0.6; cap.receiveShadow = true; scene.add(cap);
  // Grass tufts (crossed cards).
  const tuftMat = pixelMaterial(F.grassTuftTexture(), { side: THREE.DoubleSide });
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - 0.5) * 16, z = -rnd() * 22;
    if (Math.abs(x - z * -0.18) < 1.6) continue;         // keep the trail clear
    for (const ry of [0, Math.PI / 2]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), tuftMat);
      t.position.set(x, 0.45, z); t.rotation.y = ry + rnd(); scene.add(t);
    }
  }
  // Warm lantern hanging on a post by the trail.
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), pixelMaterial(F.pineBarkTexture()));
  post.position.set(-1.6, 0.9, -6.5); post.castShadow = true; scene.add(post);
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), new THREE.MeshBasicMaterial({ color: RAMPS.warm[4] }));
  bulb.position.set(-1.45, 1.7, -6.5); scene.add(bulb);
  const lantern = new THREE.PointLight(RAMPS.warm[3], 6, 10, 1.6);
  lantern.position.copy(bulb.position); lantern.castShadow = true; scene.add(lantern);
  // Flashlight from the camera (optional view).
  const torch = new THREE.SpotLight(0xfff1d6, 30, 30, THREE.MathUtils.degToRad(22), 0.5, 1.6);
  camera.add(torch, torch.target); torch.position.set(0.2, -0.15, 0); torch.target.position.set(0, -0.6, -6);
  scene.add(camera);

  const view = q.get('view') ?? '0';
  torch.visible = view === '1';
  if (view === '0') { camera.position.set(0.4, 1.65, 3); camera.lookAt(-0.4, 1.2, -8); }
  if (view === '1') { camera.position.set(1.4, 1.65, -1.2); camera.lookAt(2.2, 0.6, -5); }
  if (view === '2') { camera.position.set(-0.4, 0.55, -3.4); camera.lookAt(-1.6, 1.1, -6.5); }
  renderer.render(scene, camera);
  requestAnimationFrame(() => { renderer.render(scene, camera); window.__ready = true; });
}
