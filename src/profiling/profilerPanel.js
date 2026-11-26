import { validateBundle } from './recorder.js';

// Debug overlay for the profiling recorder (GDD 17.2): F6 shows/hides it. Start/stop recording
// (stopping adds a gap marker; it never pauses the game), insert a marker, and export the
// summary.json / events.jsonl / manifest.json files (downloads start only on a click).
export class ProfilerPanel {
  constructor(rec) {
    this.rec = rec;
    this.visible = false;
    const el = this.el = document.createElement('div');
    el.id = 'profiler-panel';
    Object.assign(el.style, { position: 'fixed', left: '8px', bottom: '64px', width: '340px', padding: '8px 10px', zIndex: '25',
      background: 'rgba(8,12,16,0.88)', color: '#cfe0d8', font: '11px/1.5 monospace', border: '1px solid #3d5a4e', display: 'none' });
    el.innerHTML = `<div id="prof-stats" style="white-space:pre-wrap"></div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button data-a="rec">Start</button><button data-a="mark">Marker</button><button data-a="export">Export</button></div>
      <div id="prof-msg" style="margin-top:4px;color:#ffd88a"></div>`;
    for (const b of el.querySelectorAll('button')) {
      Object.assign(b.style, { font: '11px monospace', background: '#1d2a24', color: '#cfe0d8', border: '1px solid #4d7a64', cursor: 'pointer' });
    }
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'rec') { if (rec.recording) rec.stop(); else rec.start(); }
      if (a === 'mark') rec.marker('manual');
      if (a === 'export') this.export();
      this.render();
    });
    document.body.append(el);
    addEventListener('keydown', (e) => { if (e.code === 'F6') { e.preventDefault(); this.toggle(); } });
    setInterval(() => { if (this.visible) this.render(); }, 500);
  }

  toggle(v = !this.visible) { this.visible = v; this.el.style.display = v ? 'block' : 'none'; this.render(); }

  render() {
    const r = this.rec, m = r.metrics(), t = r.domainTotals();
    this.el.querySelector('button[data-a="rec"]').textContent = r.recording ? 'Stop' : 'Start';
    this.el.querySelector('#prof-stats').textContent = [
      `PROFILER (F6)  ${r.recording ? '● REC' : '○ idle'}  ${(r.elapsedMs / 1000).toFixed(1)} s  [${r.segment}]`,
      `frames ${m.frame_interval_ms.count}  p95 ${m.frame_interval_ms.p95 ?? '-'} ms  max ${m.frame_interval_ms.max ?? '-'} ms`,
      `cpu p95 ${m.cpu_app_ms.p95 ?? '-'} ms   stalls >100 ms: ${m.stalls_over_100ms.count}`,
      `photos ${t.evidence.photos_taken} (best ${t.evidence.best_photo_score ?? '-'})  clues ${t.evidence.clues_logged}`,
      `sales ${t.economy.sales} ($${t.economy.revenue})  bounties ${t.economy.bounties_paid}  buys ${t.economy.purchases}`,
      `events ${r.events.length}${r.droppedEvents ? ` (+${r.droppedEvents} dropped)` : ''}`,
      r.baseName,
    ].join('\n');
  }

  /** Validate and download the three files. Returns { baseName, files, errors } (also used by checks). */
  export() {
    const b = this.rec.exportBundle();
    const errors = validateBundle(b.files);
    this.lastExport = { ...b, errors };
    this.el.querySelector('#prof-msg').textContent = errors.length
      ? `Export has problems: ${errors.slice(0, 2).join('; ')}` : `Exported ${b.baseName}.* (valid)`;
    for (const [role, text] of Object.entries(b.files)) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: role.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json' }));
      a.download = `${b.baseName}.${role}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    return this.lastExport;
  }
}
