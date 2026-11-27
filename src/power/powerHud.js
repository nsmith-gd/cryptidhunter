// Power & fuel panel (#140): each pack with its charge and the devices wired to it (a device that's
// off because its pack is flat says so), the analogue backups, fuel in litres, the generator, and the
// GPS fix while the GPS is on. Words and bars, never colour alone.

const bar = (pct, n = 10) => { const k = Math.round(pct / 100 * n); return '█'.repeat(k) + '░'.repeat(n - k); };

export class PowerHud {
  constructor() {
    const el = this.el = document.createElement('div');
    el.id = 'power-hud';
    Object.assign(el.style, { position: 'fixed', left: '8px', bottom: '8px', zIndex: 6, pointerEvents: 'none', font: '11px/1.45 monospace',
      color: '#dfe6e8', background: '#0b1016c8', border: '1px solid #3a4652', padding: '6px 8px', maxWidth: '340px', whiteSpace: 'pre' });
    document.body.append(el);
  }

  render({ budget, player, boat, nearGen }) {
    const s = budget.status(), lines = ['POWER & FUEL'];
    for (const p of s.packs) {
      if (p.spare && !p.devices.length) continue;
      lines.push(`${p.name.padEnd(13)} ${bar(p.pct)} ${String(p.pct).padStart(3)}%${p.flat ? ' FLAT' : ''}${p.plugged ? ' · charging' : ''}`);
      for (const d of p.devices) lines.push(`  ${d.name.padEnd(17)} ${d.on ? 'ON' : p.flat && d.wantOn ? 'OFF (pack flat)' : p.flat ? 'no power' : 'off'}`);
    }
    const spares = s.packs.filter((p) => p.spare && !p.devices.length && !p.flat).length;
    lines.push(`spare packs: ${spares}   torch: own cells   paper map: no power`);
    for (const t of s.tanks) lines.push(`${t.name.padEnd(15)} ${t.litres.toFixed(1)} / ${t.capacity} L`);
    const g = s.generators[0];
    if (g) lines.push(`${g.name}: ${g.running ? 'RUNNING' : 'off'}`);
    if (budget.isOn('gps')) lines.push(`GPS fix: ${player.position.x.toFixed(0)} E, ${(-player.position.z).toFixed(0)} N`);
    lines.push(boat?.aboard ? '5 sonar · 6 lantern · 7 hydrophone · 8 GPS · 9 swap · 0 pour can' : nearGen ? '0 generator · 7 hydrophone · 8 GPS · 9 swap' : '7 hydrophone · 8 GPS · 9 swap spare');
    this.el.textContent = lines.join('\n');
  }
}
