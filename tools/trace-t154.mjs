// Infrastructure state (#154) scenario trace and site diagram. Run: node tools/trace-t154.mjs [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { graftonSite } from '../src/infrastructure/infrastructure.js';

const out = process.argv[2] || '.ballast/media/t154';
mkdirSync(out, { recursive: true });
let t = 0;
const s = graftonSite(() => +t.toFixed(0));
const lines = [];
const say = (msg) => lines.push(`  ${String(t).padStart(4)} s  ${msg}`);
const routes = () => `cargo ${s.routeOpen('cargo', 1800).open ? 'OPEN' : 'closed (' + s.routeOpen('cargo', 1800).why + ')'} · foot ${s.routeOpen('foot').open ? 'OPEN' : 'closed'}`;
lines.push('== The Grafton site: a 1,800 kg crate to move out by the heavy cargo route');
say(`start · ${routes()} · vibrating: ${s.vibrationSources().map((v) => v.id).join(', ')}`);
t = 30; s.setRunning('winch', true); say(`winch started · vibrating: ${s.vibrationSources().map((v) => v.id).join(', ')}`);
t = 60; say(`a 2,200 kg load? ${s.routeOpen('cargo', 2200).why}`);
t = 90; let r = s.damage('shelter', 35, 'the creature'); say(`creature strikes the shelter: integrity ${r.integrity}, nothing else touched (${r.affected.length} affected)`);
t = 120; r = s.damage('generator', 70, 'the creature, drawn by the vibration'); say(`creature strikes the running generator: integrity ${r.integrity}`);
t = 150; r = s.damage('generator', 40, 'the creature'); say(`again: generator broken · offline because of it: ${r.affected.join(', ')} · ${routes()}`);
t = 180; s.repair('generator'); s.setRunning('generator', true); s.setRunning('winch', true); say(`generator repaired and restarted · ${routes()}`);
t = 240; s.block('cargo', 'flood water over the cargo track'); say(`flood · ${routes()} · foot exits: ${s.footExits().join(', ')}`);
t = 300; s.damage('bridge', 100, 'flood debris'); say(`cargo bridge swept away · ${routes()} · foot exits still: ${s.footExits().join(', ')}`);
lines.push('', '== Trace', ...s.trace.map((e) => `  ${String(e.t).padStart(4)} s  ${e.type.padEnd(9)} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['t', 'type'].includes(k))))}`));
writeFileSync(`${out}/scenario.txt`, lines.join('\n'));
console.log(lines.join('\n'));
