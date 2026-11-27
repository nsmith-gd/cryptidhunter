import * as THREE from 'three';
import { SCENT_WORLD } from './scent.js';

const STATE_COLORS = {
  roam: '#9fb4c8', investigate: '#7fd0ff', observe: '#ffc23a', flee: '#ff5a4a', aggress: '#ff8a2a', shadow: '#c9a0ff', warn: '#ff6a2a',
};

// Debug overlay for the cryptid behaviour state machine (F4 toggles it).
// A panel lists each cryptid's state, how long it has been in it, what it senses and its
// recent transitions with the reason; a floating label over each cryptid shows its state.
export class AIDebug {
  constructor(scene, manager, { visible = true, others = () => [] } = {}) {
    this.others = others;   // cryptids with their own movement (Mothman, Chupacabra): tree only
    this.scene = scene;
    this.manager = manager;
    this.labels = new Map();
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'fixed', right: '8px', top: '130px', width: '340px', font: '11px monospace', color: '#ddd',
      background: 'rgba(0,0,0,0.55)', padding: '6px 8px', whiteSpace: 'pre-wrap', pointerEvents: 'none', lineHeight: '1.45',
      border: '1px solid #333',
    });
    this.panel.id = 'ai-debug';
    document.body.appendChild(this.panel);
    addEventListener('keydown', (e) => { if (e.code === 'F4') { e.preventDefault(); this.setVisible(!this.visible); } });
    this.setVisible(visible);
  }

  setVisible(v) {
    this.visible = v;
    this.panel.style.display = v ? 'block' : 'none';
    for (const l of this.labels.values()) l.visible = v;
  }

  label(c) {
    let l = this.labels.get(c);
    if (!l) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 48;
      const tex = new THREE.CanvasTexture(canvas);
      l = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false, transparent: true }));
      l.renderOrder = 11;
      l.userData = { canvas, tex, text: '' };
      l.visible = this.visible;
      this.scene.add(l);
      this.labels.set(c, l);
    }
    return l;
  }

  update(camera) {
    // Drop labels for cryptids that are gone.
    for (const [c, l] of this.labels) if (!this.manager.cryptids.includes(c)) { l.removeFromParent(); this.labels.delete(c); }
    if (!this.visible) return;
    const lines = ['CRYPTID AI  (F4 hides)'];
    // #107: scent traces in the world (source, strength, time left) and the wind.
    const sf = SCENT_WORLD.field;
    if (sf) {
      lines.push(`SCENT  wind → ${sf.wind.x.toFixed(1)},${sf.wind.z.toFixed(1)} at ${sf.wind.speed} m/s · ${sf.traces.length} trace${sf.traces.length === 1 ? '' : 's'}`);
      for (const t of sf.traces.slice(-4)) lines.push(`  #${t.id} ${t.kind} from ${t.source} @${t.x.toFixed(0)},${t.z.toFixed(0)}  ${sf.strengthOf(t).toFixed(2)}  expires ${sf.expiresIn(t).toFixed(0)}s`);
    }
    for (const c of this.manager.cryptids) {
      const pc = c.perception;
      lines.push('', `${c.profile.name}  [${c.state.toUpperCase()}] ${c.stateTime.toFixed(1)}s`);
      if (pc) {
        lines.push(`  hear ${pc.hearLevel.toFixed(2)}  see ${Math.max(pc.sightLevel, pc.beamLevel).toFixed(2)}  aware ${pc.awareness.toFixed(2)}${pc.detected ? ' DETECTED' : ''}`);
        // #86: awareness stage and the strongest remembered cue (channel, where, how sure).
        const m = pc.lastKnown?.();
        lines.push(`  stage ${pc.stage?.toUpperCase() ?? '-'}${m ? `  · remembers ${m.channel} cue ±${m.uncertainty.toFixed(1)} m, ${Math.round(m.confidence * 100)}%` : ''}`);
        // #107: stimulus trace per channel: channel, source, where, strength, time left before it expires.
        for (const r of (pc.memory ?? []).slice().sort((a, b) => b.expiry - a.expiry).slice(0, 4)) {
          lines.push(`  · ${r.channel.padEnd(8)} ${String(r.source).padEnd(7)} @${r.x.toFixed(0)},${r.z.toFixed(0)}  ${r.intensity.toFixed(2)}  expires ${Math.max(0, r.expiry - pc.time).toFixed(0)}s`);
        }
        if (pc.scentLevel > 0 && pc.lastScent) lines.push(`  smells ${pc.lastScent.kind} trace #${pc.lastScent.id} (${pc.scentLevel.toFixed(2)}), fades in ${pc.lastScent.expiresIn.toFixed(0)}s`);
        const rs = pc.routine?.spots ?? [];
        if (rs.length) lines.push(`  routine: ${rs.length} spot${rs.length > 1 ? 's' : ''} · ` + rs.slice(0, 3).map((x) => `${x.kind}/${x.via} ${Math.round(pc.routine.confidenceOf(x) * 100)}% ${Math.max(0, x.expiry - pc.routine.time).toFixed(0)}s`).join(' · '));
      }
      if (c.brain?.scores && Object.keys(c.brain.scores).length) {
        lines.push(`  scores ${Object.entries(c.brain.scores).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}`);
      }
      lines.push(`  ${c.playerDistance.toFixed(1)} m from you · level ${c.level} · agitation ${c.agitation.toFixed(2)}`);
      if (c.brain) lines.push(`  tree: ${c.brain.pathText}`);
      for (const h of c.history.slice(-5).reverse()) {
        lines.push(`  ${h.t.toFixed(1).padStart(6)}s ${h.from} → ${h.to}${h.why ? ` (${h.why})` : ''}`);
      }

      // World label.
      const l = this.label(c);
      const text = c.state.toUpperCase();
      if (l.userData.text !== text) {
        const { canvas, tex } = l.userData, g = canvas.getContext('2d');
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.font = 'bold 30px monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 128, 24);
        g.fillStyle = STATE_COLORS[c.state] ?? '#fff'; g.fillText(text, 128, 24);
        tex.needsUpdate = true;
        l.userData.text = text;
      }
      l.position.set(c.agent.x, c.profile.height + 0.75 + 0.3 * Math.max(1, camera.position.distanceTo(l.position) / 5), c.agent.z);
      const d = camera.position.distanceTo(l.position);
      // Keep it a readable size on screen at the game's low render resolution.
      const k = Math.max(1, d / 5);
      l.scale.set(3.2 * k, 0.6 * k, 1);
    }
    for (const o of this.others()) {
      lines.push('', `${o.name}  [${o.state.toUpperCase()}]  level ${o.level}`);
      lines.push(`  tree: ${o.pathText ?? ''}`);
    }
    this.panel.textContent = lines.join('\n');
  }
}
