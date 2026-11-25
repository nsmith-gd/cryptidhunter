// Plain HUD bars for stamina, flashlight battery and (debug) player noise, top-left.
export class Hud {
  constructor(player, flashlight) {
    this.player = player;
    this.flashlight = flashlight;
    const root = document.createElement('div');
    Object.assign(root.style, { position: 'fixed', left: '8px', top: '8px', font: '11px monospace', color: '#ccc',
      textShadow: '0 0 2px #000', pointerEvents: 'none' });
    document.body.appendChild(root);
    this.stamina = this.bar(root, 'STAMINA', '#7fc8ff');
    this.battery = this.bar(root, 'BATTERY', '#ffe27a');
    this.noise = this.bar(root, 'NOISE', '#c9a0ff');   // debug readout of what cryptids can hear
  }

  bar(root, label, color) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', margin: '3px 0' });
    const name = Object.assign(document.createElement('span'), { textContent: label });
    name.style.width = '58px';
    const track = document.createElement('div');
    Object.assign(track.style, { width: '120px', height: '8px', background: '#0008', border: '1px solid #888' });
    const fill = document.createElement('div');
    Object.assign(fill.style, { height: '100%', width: '100%', background: color });
    track.appendChild(fill);
    const note = document.createElement('span');
    row.append(name, track, note);
    root.appendChild(row);
    return { fill, note, color };
  }

  update() {
    const p = this.player, f = this.flashlight;
    this.stamina.fill.style.width = `${(p.stamina * 100).toFixed(1)}%`;
    this.stamina.fill.style.background = p.exhausted ? '#c0504d' : this.stamina.color;
    this.stamina.note.textContent = p.exhausted ? 'winded' : '';
    this.battery.fill.style.width = `${(f.battery * 100).toFixed(1)}%`;
    this.battery.fill.style.background = f.battery < 0.15 ? '#c0504d' : this.battery.color;
    const n = p.noise;
    const label = n < 0.02 ? 'silent' : n < 0.25 ? 'quiet' : n < 0.7 ? 'medium' : 'loud';
    this.noise.fill.style.width = `${(n * 100).toFixed(1)}%`;
    this.noise.note.textContent = `${n.toFixed(2)} ${label}  (${p.noiseRadius.toFixed(1)} m)`;
    this.battery.note.textContent = `${Math.ceil(f.battery * 100)}%  spares ${f.spares}${f.battery < 0.15 && f.spares ? '  [R] swap' : ''}`;
  }
}
