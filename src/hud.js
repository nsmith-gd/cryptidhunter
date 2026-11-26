// Plain HUD bars for stamina, flashlight battery and fear, top-left. The player-noise bar is a
// debug aid only (shown with N, together with the noise ring).
export class Hud {
  constructor(player, flashlight, fear = null) {
    this.player = player;
    this.flashlight = flashlight;
    this.fear = fear;
    const root = document.createElement('div');
    Object.assign(root.style, { position: 'fixed', left: '8px', top: '8px', font: '11px monospace', color: '#ccc',
      textShadow: '0 0 2px #000', pointerEvents: 'none' });
    document.body.appendChild(root);
    this.stamina = this.bar(root, 'STAMINA', '#7fc8ff');
    this.battery = this.bar(root, 'BATTERY', '#ffe27a');
    this.noise = this.bar(root, 'NOISE', '#c9a0ff');   // debug readout of what cryptids can hear
    this.showNoise = false;
    if (fear) this.fearBar = this.bar(root, 'FEAR', '#e0604a');
    // Fear vignette: the screen edges darken and redden as fear climbs.
    this.vignette = document.createElement('div');
    Object.assign(this.vignette.style, { position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0',
      background: 'radial-gradient(ellipse at center, transparent 45%, #2a0000 100%)' });
    document.body.prepend(this.vignette); // first in the page: over the 3D view, under every HUD element
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
    return { row, fill, note, color };
  }

  update() {
    const p = this.player, f = this.flashlight;
    this.stamina.fill.style.width = `${(p.stamina * 100).toFixed(1)}%`;
    this.stamina.fill.style.background = p.exhausted ? '#c0504d' : this.stamina.color;
    this.stamina.note.textContent = p.exhausted ? 'winded' : p.staminaCap < 1 ? `max ${Math.round(p.staminaCap * 100)}% (hurt)` : '';
    // Contextual HUD (GDD 2.11): stamina shows while you exert or recover, then fades out.
    const full = p.stamina >= (p.staminaCap ?? 1) - 1e-3 && !p.sprinting;
    const now = performance.now();
    if (!full || this.staminaShownAt == null) this.staminaShownAt = full ? (this.staminaShownAt ?? -1e9) : now;
    this.staminaVisible = !full || now - this.staminaShownAt < 2000;
    this.stamina.row.style.opacity = this.staminaVisible ? '1' : '0';
    this.stamina.row.style.transition = 'opacity .6s';
    this.battery.fill.style.width = `${(f.battery * 100).toFixed(1)}%`;
    this.battery.fill.style.background = f.battery < 0.15 ? '#c0504d' : this.battery.color;
    this.noise.row.style.display = this.showNoise ? 'flex' : 'none';
    const n = p.noise;
    const label = n < 0.02 ? 'silent' : n < 0.25 ? 'quiet' : n < 0.7 ? 'medium' : 'loud';
    this.noise.fill.style.width = `${(n * 100).toFixed(1)}%`;
    this.noise.note.textContent = `${n.toFixed(2)} ${label}  (${p.noiseRadius.toFixed(1)} m)`;
    if (this.fear) {
      const v = this.fear.value;
      this.fearBar.fill.style.width = `${v.toFixed(1)}%`;
      this.fearBar.fill.style.background = v > 70 ? '#ff3a2a' : this.fearBar.color;
      this.fearBar.note.textContent = v < 20 ? 'calm' : v < 45 ? 'uneasy' : v < 70 ? 'scared' : 'terrified';
      this.vignette.style.opacity = String(Math.max(0, (v - 30) / 70) * 0.9);
    }
    this.battery.note.textContent = `${Math.ceil(f.battery * 100)}%  spares ${f.spares}${f.battery < 0.15 && f.spares ? '  [R] swap' : ''}`;
  }
}
