// Coverage maps for #153: the G06 gym's layout, judged by the shared coverage rules (src/security/coverage.js).
// Top-down: green = watched, dark = not; cameras and their cones, the rock, the corridors, the camp.
// Three setups: all cameras on (D past the rock), camera B removed, the power hub flat.
// Run: node tools/coverage-map-t153.mjs [outDir]  (writes SVGs; the check renders them to PNG)
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildGymG06, G06 } from '../src/gym/g06.js';
import { CoverageGraph } from '../src/security/coverage.js';

const out = process.argv[2] || '.ballast/media/t153';
mkdirSync(out, { recursive: true });
const map = buildGymG06(new THREE.Scene());
const H = G06.half, S = 10, W = H * 2 * S;
const X = (x) => (x + H) * S, Z = (z) => (z + H) * S;
const setups = {
  '01-all-cameras-on-blind-spot-covered': { remove: [], power: true, moveD: true },
  '02-camera-B-removed-centre-corridor-open': { remove: ['B'], power: true, moveD: true },
  '03-power-hub-flat-no-coverage': { remove: [], power: false, moveD: true },
  '04-camera-D-behind-the-rock-blind-spot': { remove: [], power: true, moveD: false },
};
for (const [name, cfg] of Object.entries(setups)) {
  const cams = G06.cameras.map((c) => { const R = c.id === 'D' && cfg.moveD ? G06.remedyD : c; return { id: c.id, x: R.x, y: 2.1, z: R.z, heading: Math.atan2(R.aim[0] - R.x, R.aim[1] - R.z), fov: G06.sight.camCone, range: G06.sight.cam, removed: cfg.remove.includes(c.id) }; });
  const g = new CoverageGraph({ nodes: cams, occluders: map.colliders, powered: () => cfg.power });
  let cells = '', watched = 0, total = 0;
  for (let x = -H + 1; x < H; x += 2) for (let z = -H + 1; z < H; z += 2) {
    const w = g.camerasSeeing({ x, y: 1.4, z }).length > 0; total++; if (w) watched++;
    if (w) cells += `<rect x="${X(x - 1)}" y="${Z(z - 1)}" width="${2 * S}" height="${2 * S}" fill="#3a8a4a" opacity="0.55"/>`;
  }
  const corr = Object.entries(G06.corridors).map(([k, pts]) => `<polyline points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="none" stroke="${k === 'behindRock' ? '#d8a040' : '#c8c0a0'}" stroke-width="5" stroke-dasharray="${k === 'behindRock' ? '10 6' : ''}" opacity="0.8"/>`).join('');
  const camsSvg = cams.map((c) => { const L = c.range * S, a1 = c.heading - c.fov, a2 = c.heading + c.fov, on = !c.removed && cfg.power;
    return `<path d="M ${X(c.x)} ${Z(c.z)} L ${X(c.x) + Math.sin(a1) * L} ${Z(c.z) + Math.cos(a1) * L} L ${X(c.x) + Math.sin(a2) * L} ${Z(c.z) + Math.cos(a2) * L} Z" fill="none" stroke="${on ? '#7fdc8a' : '#664'}" stroke-dasharray="${on ? '' : '6 6'}"/>
      <circle cx="${X(c.x)}" cy="${Z(c.z)}" r="9" fill="${c.removed ? '#555' : on ? '#40ff60' : '#802020'}"/><text x="${X(c.x) + 12}" y="${Z(c.z) + 5}" fill="#eee" font-size="18">${c.id}${c.removed ? ' (removed)' : on ? '' : ' (no power)'}</text>`; }).join('');
  const rock = G06.rock;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W + 60}" style="background:#11161c;font-family:monospace">
<rect width="${W}" height="${W + 60}" fill="#11161c"/>${cells}${corr}
<rect x="${X(rock.x - rock.w / 2)}" y="${Z(rock.z - rock.d / 2)}" width="${rock.w * S}" height="${rock.d * S}" fill="#8a867e"/>
<circle cx="${X(G06.camp.x)}" cy="${Z(G06.camp.z)}" r="${G06.perimeter * S}" fill="none" stroke="#c84a3a" stroke-width="2"/>
<circle cx="${X(G06.camp.x)}" cy="${Z(G06.camp.z)}" r="10" fill="#ffd060"/>${camsSvg}
<text x="16" y="${W + 26}" fill="#ddd" font-size="20">${name.replace(/^\d+-/, '').replace(/-/g, ' ')}</text>
<text x="16" y="${W + 50}" fill="#9a9" font-size="16">green: covered by a camera (${Math.round(100 * watched / total)}% of the gym) · dashed yellow: the route round the rock · red ring: alarm</text></svg>`;
  writeFileSync(`${out}/${name}.svg`, svg);
  console.log(name, `${Math.round(100 * watched / total)}% covered`);
}
