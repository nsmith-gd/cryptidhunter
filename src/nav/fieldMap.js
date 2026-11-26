// Paper map and compass (#70, GDD 1.2 S04, 2.4): getting back to the van is the task.
// M raises the map and compass in your hands (M again, or Esc, lowers them). The map is a printed
// trail map: trails, the creek, the ridge and its gaps, named places, trail signs and the
// parking. It does NOT show where you are: you work that out from the landmarks and signs
// around you. The compass needle swings to north as you turn. While reading you walk slowly and
// can't run. Without the map up, there's no heading readout on screen at all.

const MAP_PX = 384;          // map canvas (shown at about 2x)

export class FieldMap {
  constructor({ map, player, input, title = 'PINE HOLLOW', home = null }) {
    this.map = map;
    this.player = player;
    this.input = input;
    this.held = false;
    this.opens = 0;
    this.title = title;
    this.home = home;
    this.build();
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM' && input.locked) this.toggle();
    });
  }

  toggle(want = !this.held) {
    this.held = want;
    if (want) this.opens++;
    this.el.style.display = want ? 'flex' : 'none';
    this.player.readingMap = want;
    const banner = document.getElementById('trail-compass');
    if (banner) banner.style.display = want ? '' : 'none';
  }

  // --- drawing -------------------------------------------------------------------------------
  build() {
    const css = document.createElement('style');
    css.textContent = `
#field-map { position: fixed; left: 50%; bottom: 2vh; transform: translateX(-50%); display: none; gap: 14px;
  align-items: flex-end; pointer-events: none; z-index: 5; }
#field-map canvas { image-rendering: pixelated; box-shadow: 0 6px 18px #000c; }
#field-map .paper { width: min(76vh, 70vw); height: min(76vh, 70vw); transform: rotate(-2deg); }
#field-map .compass { width: min(22vh, 18vw); height: min(22vh, 18vw); border-radius: 50%; }
#field-map .hint { position: absolute; left: 0; right: 0; top: -18px; text-align: center; font: 11px monospace; color: #ccc; text-shadow: 0 0 2px #000; }`;
    document.head.append(css);
    this.el = Object.assign(document.createElement('div'), { id: 'field-map' });
    this.paper = Object.assign(document.createElement('canvas'), { className: 'paper', width: MAP_PX, height: MAP_PX });
    this.compass = Object.assign(document.createElement('canvas'), { className: 'compass', width: 96, height: 96 });
    const hint = Object.assign(document.createElement('div'), { className: 'hint', textContent: 'M  put the map away · the map does not show where you are' });
    this.el.append(hint, this.paper, this.compass);
    document.body.append(this.el);
    this.drawPaper();
    this.toggle(false);
  }

  /** World (x, z) to map pixels: north (-z) up. */
  project(x, z) {
    const H = this.map.bounds ?? 150, pad = 18, s = (MAP_PX - pad * 2) / (2 * H);
    return [pad + (x + H) * s, pad + (z + H) * s];
  }

  drawPaper() {
    const g = this.paper.getContext('2d');
    g.imageSmoothingEnabled = false;
    let seed = 7;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // Paper: worn cream with speckle, folds and darkened edges.
    g.fillStyle = '#d9c9a0'; g.fillRect(0, 0, MAP_PX, MAP_PX);
    for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? '#cdbb90' : '#e2d4ae'; g.fillRect(Math.floor(r() * MAP_PX), Math.floor(r() * MAP_PX), 1, 1); }
    g.fillStyle = '#c4b183';
    for (const f of [MAP_PX / 3, (MAP_PX * 2) / 3]) { g.fillRect(Math.round(f), 0, 1, MAP_PX); g.fillRect(0, Math.round(f), MAP_PX, 1); }
    g.strokeStyle = '#a8946a'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, MAP_PX - 3, MAP_PX - 3);
    const P = (p) => this.project(p.x, p.z);
    const m = this.map;
    // Forest: stippled green over everything but the clearings around named places.
    const H = m.bounds ?? 150;
    const open = (m.places ?? []).map((p) => P(p));
    g.fillStyle = '#9fae86';
    for (let y = 18; y < MAP_PX - 18; y += 4) for (let x = 18 + ((y / 4) % 2) * 2; x < MAP_PX - 18; x += 4) {
      if (open.some(([ox, oy]) => Math.hypot(x - ox, y - oy) < 9)) continue;
      if (r() < 0.75) g.fillRect(x, y, 1, 1);
    }
    // Creek.
    if (m.creek) {
      g.strokeStyle = '#4f7da0'; g.lineWidth = 3; g.beginPath();
      m.creek.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      g.fillStyle = '#4f7da0'; g.font = '8px monospace';
      const [lx, ly] = P(m.creek[Math.floor(m.creek.length * 0.2)]); g.fillText('Hollow Creek', lx - 20, ly + 12);
    }
    // Ridge: hatched rock band with its gaps left open.
    if (m.ridge) {
      const [, ry] = this.project(0, m.ridge.z);
      for (let x = 18; x < MAP_PX - 18; x += 2) {
        const wx = (x - 18) / ((MAP_PX - 36) / (2 * H)) - H;
        if (m.ridge.gaps.some(([a, b]) => wx > a && wx < b)) continue;
        g.fillStyle = x % 4 ? '#7a6a58' : '#5c4e40';
        g.fillRect(x, ry - 4 + (x % 6 === 0 ? 1 : 0), 1, 9);
      }
      g.fillStyle = '#5c4e40'; g.font = '8px monospace'; g.fillText('ROCK RIDGE', MAP_PX - 90, ry - 7);
    }
    // Trails: dashed.
    g.strokeStyle = '#7a2e1e'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    for (const t of m.trails ?? []) { g.beginPath(); t.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
    g.setLineDash([]);
    // Signposts.
    g.fillStyle = '#3a2a1a';
    for (const s of m.signs ?? []) { const [x, y] = P(s.post ?? s); g.fillRect(x - 1, y - 3, 3, 1); g.fillRect(x, y - 3, 1, 5); }
    // Places.
    g.font = 'bold 9px monospace';
    for (const p of m.places ?? []) {
      const [x, y] = P(p);
      if (p.id === this.home) {
        g.fillStyle = '#1f4f8a'; g.fillRect(x - 6, y - 6, 12, 12); g.fillStyle = '#e8e0c8'; g.fillText('P', x - 3, y + 3);
        g.fillStyle = '#1f2a3a'; g.fillText('PARKING · VAN', x + 9, y + 3);
        continue;
      }
      g.fillStyle = '#2a2018'; g.fillRect(x - 2, y - 2, 5, 5); g.fillStyle = '#d9c9a0'; g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = '#2a2018';
      const w = g.measureText(p.name).width;
      g.fillText(p.name, Math.min(MAP_PX - 20 - w, Math.max(20, x + 6)), y - 4);
    }
    // North arrow, scale bar, title.
    g.fillStyle = '#2a2018'; g.font = 'bold 10px monospace';
    g.fillText(this.title, 22, 32);
    g.font = '8px monospace'; g.fillText('Forest Service trail map', 22, 42);
    const nx = MAP_PX - 34, ny = 30;
    g.beginPath(); g.moveTo(nx, ny - 12); g.lineTo(nx - 5, ny + 4); g.lineTo(nx, ny); g.lineTo(nx + 5, ny + 4); g.closePath(); g.fill();
    g.fillText('N', nx - 3, ny + 14);
    const [s0] = this.project(0, 0), [s1] = this.project(100, 0);
    const by = MAP_PX - 26;
    g.fillRect(22, by, s1 - s0, 2); g.fillRect(22, by - 3, 1, 5); g.fillRect(22 + (s1 - s0), by - 3, 1, 5);
    g.fillText('100 m', 22, by - 5);
  }

  drawCompass() {
    const g = this.compass.getContext('2d'), c = 48;
    const h = ((-this.player.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);   // heading, 0 = north
    const deg = Math.round((h * 180) / Math.PI) % 360;
    if (deg === this.lastDeg) return;
    this.lastDeg = deg;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 96, 96);
    g.fillStyle = '#8a6a32'; g.beginPath(); g.arc(c, c, 47, 0, Math.PI * 2); g.fill();          // brass case
    g.fillStyle = '#e6dcc0'; g.beginPath(); g.arc(c, c, 40, 0, Math.PI * 2); g.fill();          // card
    g.save(); g.translate(c, c); g.rotate(-h);                                                   // card turns: N stays north
    g.fillStyle = '#2a2018'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]].forEach(([t, a]) => {
      g.save(); g.rotate(a); g.fillStyle = t === 'N' ? '#a02018' : '#2a2018'; g.fillText(t, 0, -30); g.restore();
    });
    for (let i = 0; i < 36; i++) { g.save(); g.rotate((i * Math.PI) / 18); g.fillStyle = '#5a4a38'; g.fillRect(-0.5, -40, 1, i % 9 === 0 ? 6 : 3); g.restore(); }
    g.fillStyle = '#c0281a'; g.beginPath(); g.moveTo(0, -24); g.lineTo(-4, 0); g.lineTo(4, 0); g.closePath(); g.fill();   // needle
    g.fillStyle = '#e8e8e8'; g.beginPath(); g.moveTo(0, 24); g.lineTo(-4, 0); g.lineTo(4, 0); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#2a2018'; g.fillRect(c - 1, 6, 2, 8);                                        // lubber line: your heading
    g.font = 'bold 9px monospace'; g.textAlign = 'center'; g.fillStyle = '#2a2018'; g.fillText(`${deg}°`, c, c + 18);
  }

  update() {
    if (this.held) this.drawCompass();
  }
}
