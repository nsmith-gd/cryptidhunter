import * as THREE from 'three';

// Trail signposts (#70, GDD S04): wooden posts at trail junctions with one carved board per
// branch, naming the nearest place down that trail and how far it is, with an arrow along the
// trail; the board on the trail that leads back to the parking says so. Signs are built from the
// trail network itself, so every arrow follows the real shortest trail to the place it names.
// They're physical things in the world: you have to find them, light them and read them.

const key = (p) => `${Math.round(p.x * 2) / 2},${Math.round(p.z * 2) / 2}`;

/** Trail graph: nodes (shared polyline points) and weighted edges. */
export function trailGraph(trails) {
  const nodes = new Map();
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { k, x: p.x, z: p.z, edges: [] });
    return nodes.get(k);
  };
  for (const t of trails) {
    for (let i = 1; i < t.length; i++) {
      const a = node(t[i - 1]), b = node(t[i]);
      if (a === b || a.edges.some((e) => e.to === b)) continue;
      const len = Math.hypot(a.x - b.x, a.z - b.z);
      a.edges.push({ to: b, len }); b.edges.push({ to: a, len });
    }
  }
  return nodes;
}

/** Shortest trail distance from `from` to every node. */
export function dijkstra(nodes, from) {
  const dist = new Map([...nodes.values()].map((n) => [n, Infinity]));
  dist.set(from, 0);
  const open = new Set([from]);
  while (open.size) {
    let n = null;
    for (const o of open) if (!n || dist.get(o) < dist.get(n)) n = o;
    open.delete(n);
    for (const e of n.edges) {
      const d = dist.get(n) + e.len;
      if (d < dist.get(e.to) - 1e-9) { dist.set(e.to, d); open.add(e.to); }
    }
  }
  return dist;
}

/**
 * Sign layout: for each junction (3+ trails) or named place on a through-trail, one board per
 * branch naming the nearest place that branch leads to (and whether it leads to the parking).
 * places: [{ id, name, x, z }], home: id of the place you leave from (the parking).
 */
export function layoutSigns(trails, places, home) {
  const nodes = trailGraph(trails);
  const at = (p) => nodes.get(key(p));
  const named = places.map((pl) => ({ ...pl, node: at(pl) })).filter((pl) => pl.node);
  const dists = new Map(named.map((pl) => [pl.id, dijkstra(nodes, pl.node)]));
  const signs = [];
  for (const n of nodes.values()) {
    const here = named.find((pl) => pl.node === n);
    if (n.edges.length < 3 && !(here && n.edges.length === 2)) continue;
    const boards = [];
    for (const e of n.edges) {
      // Places whose shortest trail from here starts down this branch.
      const via = named.filter((pl) => pl.node !== n && Math.abs(dists.get(pl.id).get(e.to) + e.len - dists.get(pl.id).get(n)) < 1e-6);
      if (!via.length) continue;
      via.sort((a, b) => dists.get(a.id).get(n) - dists.get(b.id).get(n));
      const homeVia = via.find((pl) => pl.id === home);
      const first = via[0];
      const lines = [{ name: first.name, m: dists.get(first.id).get(n), home: first.id === home }];
      if (homeVia && homeVia !== first) lines.push({ name: homeVia.name, m: dists.get(home).get(n), home: true });
      boards.push({ dir: Math.atan2(e.to.x - n.x, e.to.z - n.z), lines, home: !!homeVia, toward: e.to });
    }
    if (boards.length) signs.push({ x: n.x, z: n.z, here: here?.name ?? null, boards });
  }
  return signs;
}

const fmt = (m) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);

// 3x5 pixel font for the carved letters: sized to the game's low render resolution, so the
// signs stay crisp instead of turning to mush like a scaled-down system font.
const GLYPHS = {
  'A': ['010', '101', '111', '101', '101'],
  'B': ['110', '101', '110', '101', '110'],
  'C': ['011', '100', '100', '100', '011'],
  'D': ['110', '101', '101', '101', '110'],
  'E': ['111', '100', '110', '100', '111'],
  'F': ['111', '100', '110', '100', '100'],
  'G': ['011', '100', '101', '101', '011'],
  'H': ['101', '101', '111', '101', '101'],
  'I': ['111', '010', '010', '010', '111'],
  'J': ['001', '001', '001', '101', '010'],
  'K': ['101', '101', '110', '101', '101'],
  'L': ['100', '100', '100', '100', '111'],
  'M': ['101', '111', '111', '101', '101'],
  'N': ['110', '101', '101', '101', '101'],
  'O': ['010', '101', '101', '101', '010'],
  'P': ['110', '101', '110', '100', '100'],
  'Q': ['010', '101', '101', '110', '011'],
  'R': ['110', '101', '110', '101', '101'],
  'S': ['011', '100', '010', '001', '110'],
  'T': ['111', '010', '010', '010', '010'],
  'U': ['101', '101', '101', '101', '111'],
  'V': ['101', '101', '101', '101', '010'],
  'W': ['101', '101', '111', '111', '101'],
  'X': ['101', '101', '010', '101', '101'],
  'Y': ['101', '101', '010', '010', '010'],
  'Z': ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '110'],
  '.': ['000', '000', '000', '000', '010'],
  ' ': ['000', '000', '000', '000', '000'],
  "'": ['010', '010', '000', '000', '000'],
};

const TEX_W = 88;          // texels across a 2.2 m board (about the screen density at reading distance)

/** Board face: carved pale letters on dark stained wood, arrow on the end that points the way. */
function boardTexture(rows, arrowRight, home) {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = 8 * rows.length;
  const g = c.getContext('2d');
  g.fillStyle = home ? '#3b2a1a' : '#33281d'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#251c14'; g.fillRect(0, 0, c.width, 1); g.fillRect(0, c.height - 1, c.width, 1);   // board edges
  for (let x = 3; x < c.width; x += 17) g.fillRect(x, 1 + (x % 3), 3, 1);                          // grain
  rows.forEach((r, i) => {
    const y0 = i * 8 + 2, text = r.text.toUpperCase();
    const w = text.length * 4 - 1;
    let x = arrowRight ? TEX_W - 9 - w : 9;
    for (const ch of text) {
      const gl = GLYPHS[ch] ?? GLYPHS[' '];
      for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 3; xx++) if (gl[yy][xx] === '1') {
        g.fillStyle = '#1a130d'; g.fillRect(x + xx, y0 + yy + 1, 1, 1);                     // carved shadow
        g.fillStyle = r.home ? '#f0d68a' : '#d8cfb8'; g.fillRect(x + xx, y0 + yy, 1, 1);
      }
      x += 4;
    }
    g.fillStyle = r.home ? '#f0d68a' : '#d8cfb8';
    for (let k = 0; k < 3; k++) {                                                             // arrow
      const ax = arrowRight ? TEX_W - 6 + k : 5 - k;
      g.fillRect(ax, y0 + 2 - (2 - k), 1, (2 - k) * 2 + 1);
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build the posts in the scene. Returns the layout (for the paper map and checks). */
export function buildTrailSigns(scene, colliders, { trails, places, home, heightAt = () => 0 }) {
  const signs = layoutSigns(trails, places, home);
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95, flatShading: true });
  const group = new THREE.Group();
  group.name = 'trail-signs';
  for (const s of signs) {
    // Stand the post just off the tread, in the widest gap between the trails.
    const dirs = s.boards.map((b) => b.dir).sort((a, b) => a - b);
    let gap = 0, mid = 0;
    dirs.forEach((d, i) => { const nx = i + 1 < dirs.length ? dirs[i + 1] : dirs[0] + Math.PI * 2; if (nx - d > gap) { gap = nx - d; mid = d + (nx - d) / 2; } });
    const px = s.x + Math.sin(mid) * 2.4, pz = s.z + Math.cos(mid) * 2.4, y0 = heightAt(px, pz);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.5, 0.14), wood);
    post.position.set(px, y0 + 1.25, pz);
    post.castShadow = true; post.name = 'trail-sign-post';
    group.add(post);
    colliders.push(new THREE.Box3().setFromObject(post));
    s.post = { x: px, z: pz };
    let y = y0 + 2.3;
    s.boards.forEach((b) => {
      const rows = b.lines.map((l) => ({ text: `${l.name.toUpperCase()} ${fmt(l.m)}`, home: l.home }));
      const len = 2.2, h = 0.2 * rows.length;
      y -= h / 2;
      const board = new THREE.Group();
      board.position.set(px, y, pz);
      y -= h / 2 + 0.06;
      board.rotation.y = b.dir - Math.PI / 2;              // local +x points down the branch
      const plank = new THREE.Mesh(new THREE.BoxGeometry(len, h + 0.04, 0.04), wood);
      plank.position.x = len / 2 - 0.05;
      board.add(plank);
      for (const side of [1, -1]) {
        const face = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.04, h),
          new THREE.MeshStandardMaterial({ map: boardTexture(rows, side === 1, b.home), roughness: 0.9 }));
        face.position.set(len / 2 - 0.05, 0, side * 0.021);
        if (side === -1) face.rotation.y = Math.PI;
        board.add(face);
      }
      board.name = 'trail-sign-board';
      board.userData = { text: rows.map((r) => r.text).join(' / '), dir: b.dir, home: b.home };
      group.add(board);
    });
  }
  scene.add(group);
  return signs;
}
