import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CryptidManager } from '../src/cryptids/cryptidManager.js';
import { getSpecies, registerSpecies, brainFactory } from '../src/cryptids/species.js';
import { makeProfile, PROFILES } from '../src/cryptids/profiles.js';
import { MEMORY } from '../src/cryptids/perception.js';

// A flat, empty 60 m field and a stand-in player the senses can read.
function world() {
  const player = { position: new THREE.Vector3(0, 0, 0), noise: 0, noiseRadius: 0, crouching: false, height: 1.8 };
  const m = new CryptidManager({ scene: new THREE.Scene(), colliders: [], halfSize: 30, getPlayerPosition: () => player.position,
    senses: { player, flashlight: null, camera: null, lightLevel: 0 } });
  const run = (c, seconds, each = () => {}) => { for (let t = 0; t < seconds; t += 1 / 30) { each(t); m.update(1 / 30); } };
  return { player, m, run };
}

test('species are data: the registry has Bigfoot, the Prowler and the Sidehill Gouger, each on a shared brain and body family', () => {
  const { m } = world();
  const g = m.spawn(getSpecies('gouger'), 0, -20);
  assert.equal(g.brain.current !== undefined, true, 'gouger runs the shared utility brain');
  assert.equal(g.mesh.children.filter((o) => o.isGroup).length, 4, 'quadruped body family: four legs');
  // Bigfoot's sculpted body needs a browser canvas; its registration is what matters here.
  assert.equal(getSpecies('bigfoot').brain, 'bigfoot', 'Bigfoot keeps its signature tree on the shared CryptidAI');
  assert.equal(brainFactory('bigfoot').name, 'bigfootBrain');
  assert.equal(brainFactory('gouger').name, 'utilityBrain', 'unknown brain names fall back to the shared utility brain');
  assert.ok(PROFILES.prowler && getSpecies('prowler'));
});

test('stimulus memory: a heard cue is remembered with distance-based uncertainty and fades by its expiry', () => {
  const { player, m, run } = world();
  const g = m.spawn(getSpecies('gouger'), 0, -20);
  player.position.set(0, 0, 5);
  player.noise = 1; player.noiseRadius = 20;
  run(g, 0.2);
  const rec = g.perception.lastKnown();
  assert.equal(rec.channel, 'acoustic');
  assert.ok(rec.uncertainty > 1, `uncertainty ${rec.uncertainty}`);
  player.noise = 0; player.position.set(25, 0, 25);
  run(g, MEMORY.ttl.acoustic + 1);
  assert.equal(g.perception.memory.filter((r) => r.channel === 'acoustic').length, 0, 'forgotten after its expiry');
});

test('awareness stages climb and fall: unaware -> suspicious/investigating -> identified/engaged -> lost -> reset -> unaware', () => {
  const { player, m, run } = world();
  // The shared ladder, on a Gouger that doesn't stalk (this 60 m field keeps you inside its stalking range).
  const base = getSpecies('gouger');
  const g = m.spawn(makeProfile({ ...base, id: 'gougerNoStalk', stalk: null, actions: base.actions.filter((a) => a !== 'stalk') }), 0, -10);
  player.position.set(25, 0, 25);
  run(g, 1);
  assert.equal(g.stage, 'unaware');
  // A noise a little way off: it notices and goes to check.
  player.position.set(0, 0, 4); player.noise = 0.5; player.noiseRadius = 12;
  run(g, 0.5);
  player.noise = 0; player.position.set(28, 0, 28);
  run(g, 1);
  // Walk right up in plain view: identified, then it bolts (engaged).
  player.position.copy(new THREE.Vector3(g.agent.x, 0, g.agent.z - 3));
  player.noise = 1; player.noiseRadius = 10;
  run(g, 1.5, () => player.position.set(g.agent.x, 0, g.agent.z - 3));
  // Vanish: it loses contact, forgets, resets.
  player.noise = 0; player.position.set(-28, 0, 28);
  run(g, 60);
  const seen = new Set(g.perception.stageLog.map((s) => s.to));
  for (const s of ['suspicious', 'investigating', 'engaged', 'lost', 'reset', 'unaware']) assert.ok(seen.has(s), `reached ${s}: ${[...seen]}`);
  assert.equal(g.stage, 'unaware');
  assert.ok(g.history.some((h) => h.to === 'flee'), 'it fled when identified');
});

test('the Sidehill Gouger never turns on you, even cornered', () => {
  const { player, m, run } = world();
  const g = m.spawn(getSpecies('gouger'), 0, -10);
  run(g, 4, () => { player.position.set(g.agent.x + 1.5, 0, g.agent.z); player.noise = 1; player.noiseRadius = 10; });
  assert.ok(!g.history.some((h) => h.to === 'aggress'));
  assert.ok(g.history.some((h) => h.to === 'flee'));
});

test('a brand-new species plugs in as data only: a territorial creature warns, pursues, then disengages back to its range', () => {
  const HODAG = registerSpecies(makeProfile({
    id: 'testHodag', name: 'Test Hodag', model: 'quadruped', height: 1.2, radius: 0.5, roamRadius: 12, roamSpeed: 1.5,
    senses: { hearing: 1.2, sightRange: 25, viewAngle: 80 },
    traits: { fear: 0.15, aggression: 0.5, territoriality: 0.9, curiosity: 0.4 },
    actions: ['roam', 'investigate', 'warn', 'pursue', 'return', 'flee'],
    behavior: { aggressSpeed: 4, aggressTime: 4, aggressGiveUp: 18, afterAggress: 'roam' },
  }));
  const { player, m, run } = world();
  const h = m.spawn(getSpecies('testHodag'), 0, 0);
  assert.equal(h.profile, HODAG);
  run(h, 3, () => { player.position.set(h.agent.x, 0, h.agent.z - 6); player.noise = 1; player.noiseRadius = 12; });
  const states = h.history.map((x) => x.to);
  assert.ok(states.includes('warn'), `warns first: ${states}`);
  run(h, 3, () => { player.position.set(h.agent.x, 0, h.agent.z - 5); });
  assert.ok(h.history.some((x) => x.to === 'aggress'), `then pursues: ${h.history.map((x) => x.to)}`);
  // Run far away and stay quiet: it gives up and goes back to its range.
  player.noise = 0;
  run(h, 30, () => player.position.set(28, 0, -28));
  assert.ok(h.history.some((x) => x.to === 'roam' && /gave up|back home|lost/.test(x.why)), h.history.map((x) => `${x.to}:${x.why}`).join(', '));
});
