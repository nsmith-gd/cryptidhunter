// Capture state machine (#149) traces and diagram. Run: node tools/trace-t149.mjs [outDir]
// Plays four scenarios through the pure machine and writes their traces, plus the state diagram.
import { writeFileSync, mkdirSync } from 'node:fs';
import { CaptureMachine } from '../src/capture/captureMachine.js';

const out = process.argv[2] || '.ballast/media/t149';
mkdirSync(out, { recursive: true });
let clock = 0;
const mk = (mod = {}) => new CaptureMachine({ creature: { id: 'dogman-1', species: 'dogman', mass: 140, aggression: 0.7, fear: 0.4 },
  module: { id: 'G03', kind: 'light capture module', charges: 2, species: ['dogman'], ...mod }, now: () => +clock.toFixed(1) });
const crate = { id: 'crate G04', capacity: 180, mass: 60, species: ['dogman'] };
const lines = [];
const run = (title, fn) => { clock = 0; const m = fn(); lines.push(`== ${title}`, ...m.trace.map((e) => `  ${String(e.t).padStart(6)} s  ${e.type.padEnd(13)} ${e.from ? `${e.from} -> ${e.to}` : e.state}${e.why ? `  (${e.why})` : ''}${e.chargesLeft != null ? `  charges left ${e.chargesLeft}` : ''}${e.creatureNow ? `  creature: ${e.creatureNow}` : ''}${e.what ? `  ${e.what}` : ''}`), ''); };
run('Success: commit during the opening, crate, sled, delivered once', () => {
  const m = mk(); m.opportunity({ kind: 'feeding at the carcass' }); clock = 2; m.commit(); clock = 5; m.secure(); clock = 40; m.tick(35, { resistance: 0.6 }); m.contain(crate);
  clock = 300; m.tick(260, { resistance: 0.3 }); m.stage({ id: 'cargo sled', capacity: 260 }); clock = 900; m.tick(600, { resistance: 0.2 }); m.deliver({ atExit: true, contractId: 'L10 live delivery' }); m.deliver({ atExit: true }); return m;
});
run('Missed opening (no charge), then a late commit: the charge is spent and it turns on you', () => {
  const m = mk(); m.opportunity({ kind: 'crossing the road' }); clock = 6; m.opportunityLost('it crossed before you were ready');
  clock = 60; m.opportunity({ kind: 'investigating your camp' }); clock = 64; m.commit({ stillValid: false }); clock = 65; m.commit(); return m;
});
run('Containment strain: warning, then escape', () => { const m = mk(); m.opportunity(); m.commit(); m.secure(); for (let i = 0; i < 80 && m.state !== 'free'; i++) { clock += 1; m.tick(1, { resistance: 1.4 }); } return m; });
run('Emergency release from the crate', () => { const m = mk(); m.opportunity(); m.commit(); m.secure(); m.contain(crate); clock = 30; m.release(); return m; });
writeFileSync(`${out}/traces.txt`, lines.join('\n'));
console.log(lines.join('\n'));
const S = ['Free', 'Eligible', 'Committed', 'Secured', 'Contained', 'Staged', 'Delivered'];
const W = 1000, box = (i) => 20 + i * 140;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="300" style="background:#12151a;font-family:monospace">
<rect width="${W}" height="300" fill="#12151a"/>
${S.map((s, i) => `<rect x="${box(i)}" y="110" width="110" height="44" rx="6" fill="${i === 6 ? '#2a5a3a' : i === 0 ? '#3a3a4a' : '#2a3a5a'}" stroke="#8aa"/><text x="${box(i) + 55}" y="137" fill="#eee" font-size="14" text-anchor="middle">${s}</text>`).join('')}
${S.slice(0, -1).map((_, i) => `<line x1="${box(i) + 110}" y1="132" x2="${box(i + 1)}" y2="132" stroke="#aac" stroke-width="2"/><polygon points="${box(i + 1)},132 ${box(i + 1) - 7},128 ${box(i + 1) - 7},136" fill="#aac"/>`).join('')}
<text x="${box(1) + 120}" y="100" fill="#ffcf60" font-size="12" text-anchor="middle">commit: one charge</text>
<path d="M ${box(1) + 55} 154 C ${box(1) + 55} 230, ${box(0) + 55} 230, ${box(0) + 55} 156" fill="none" stroke="#7a8" stroke-dasharray="4 3"/>
<text x="${box(0) + 125}" y="222" fill="#7a8" font-size="12" text-anchor="middle">opening lost (no charge)</text>
<path d="M ${box(2) + 55} 110 C ${box(2) + 55} 40, ${box(0) + 55} 40, ${box(0) + 55} 108" fill="none" stroke="#e06050"/>
<path d="M ${box(5) + 55} 154 C ${box(5) + 55} 290, ${box(0) + 30} 290, ${box(0) + 30} 156" fill="none" stroke="#e06050"/>
<text x="${box(1) + 60}" y="36" fill="#e06050" font-size="12" text-anchor="middle">failed commit: charge spent</text>
<text x="${box(3)}" y="282" fill="#e06050" font-size="12" text-anchor="middle">any failure / escape / emergency release -> Free as fleeing, hostile or recovering</text>
<text x="${box(4) + 55}" y="190" fill="#c8a040" font-size="11" text-anchor="middle">integrity &lt;40 warn, 0 escape</text>
<text x="${box(4) + 55}" y="204" fill="#c8a040" font-size="11" text-anchor="middle">condition &lt;35 warn, 0 non-deliverable</text>
<text x="${box(6) + 55}" y="100" fill="#7c8" font-size="12" text-anchor="middle">pays once</text></svg>`;
writeFileSync(`${out}/state-diagram.svg`, svg);
