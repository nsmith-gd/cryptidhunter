import * as THREE from 'three';

// Greybox test map: flat ground, box obstacles, and a low overhang to crouch under.
// Returns the scene objects plus a list of collider AABBs (THREE.Box3).
export function buildTestMap(scene) {
  const colliders = [];
  const grey = (shade) => new THREE.MeshStandardMaterial({ color: new THREE.Color(shade, shade, shade), roughness: 0.9 });

  // Ground with a checker texture so movement speed is readable.
  const size = 80;
  const tex = checkerTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 2, size / 2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const box = (x, y, z, w, h, d, shade = 0.55) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), grey(shade));
    m.position.set(x, y + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };

  // Perimeter walls.
  const half = size / 2;
  box(0, 0, -half, size, 3, 1, 0.35);
  box(0, 0, half, size, 3, 1, 0.35);
  box(-half, 0, 0, 1, 3, size, 0.35);
  box(half, 0, 0, 1, 3, size, 0.35);

  // Scattered obstacles of varying heights.
  box(-4, 0, -6, 2, 2, 2);
  box(5, 0, -8, 3, 1, 3, 0.6);
  box(-8, 0, -14, 4, 3, 1, 0.5);
  box(8, 0, -16, 1.5, 4, 1.5, 0.45);
  box(0, 0, -20, 6, 0.5, 2, 0.65);
  box(-12, 0, 4, 2, 2.5, 6, 0.5);
  box(12, 0, 6, 5, 1.5, 2, 0.6);

  // Low overhang ("crawl box"): a slab on two pillars. Gap under it is 1.1m —
  // too low to walk under standing (1.8m), fine when crouched (1.0m).
  const crawlZ = -11;
  box(-1.6, 0, crawlZ, 0.4, 1.1, 3, 0.4);
  box(1.6, 0, crawlZ, 0.4, 1.1, 3, 0.4);
  box(0, 1.1, crawlZ, 3.6, 0.6, 3, 0.7).name = 'crawl-slab';

  // A low tunnel to test staying crouched under a long ceiling.
  box(-6, 0, -26, 0.4, 1.1, 6, 0.4);
  box(-3.6, 0, -26, 0.4, 1.1, 6, 0.4);
  box(-4.8, 1.1, -26, 2.8, 0.5, 6, 0.7);

  return { colliders, bounds: half };
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d');
  g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, 2, 2);
  g.fillStyle = '#4c4c4c'; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
