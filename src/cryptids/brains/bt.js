// Tiny reactive behaviour tree. The whole tree is re-evaluated from the root every tick, so
// higher-priority branches interrupt lower ones the moment their conditions hold. Ongoing
// behaviours (a charge, a stare) keep their own memory on the blackboard / the cryptid.
//
//   sel(name, ...children)   Selector: first child that doesn't FAIL wins
//   seq(name, ...children)   Sequence: all children must succeed, in order
//   when(name, fn)           Condition: fn(ctx) truthy -> OK, else FAIL
//   act(name, fn)            Action: fn(ctx) returns OK / RUN / FAIL (true = OK, false = FAIL)
//   tier(n, child)           Only exists from escalation level n upward (else FAIL)
//
// tick() also records the path of named nodes that ran, for the debug overlay.
export const OK = 'ok', RUN = 'running', FAIL = 'fail';

const norm = (r) => (r === true || r === undefined ? OK : r === false ? FAIL : r);

export const sel = (name, ...children) => ({ name, kind: 'sel', children });
export const seq = (name, ...children) => ({ name, kind: 'seq', children });
export const when = (name, fn) => ({ name, kind: 'cond', fn });
export const act = (name, fn) => ({ name, kind: 'act', fn });
export const tier = (n, child) => ({ name: child.name, kind: 'tier', n, child });

export function tick(node, ctx, path = []) {
  switch (node.kind) {
    case 'cond': return node.fn(ctx) ? OK : FAIL;
    case 'act': {
      const r = norm(node.fn(ctx));
      if (r !== FAIL) path.push(node.name);
      return r;
    }
    case 'tier': return ctx.level >= node.n ? tick(node.child, ctx, path) : FAIL;
    case 'sel': {
      for (const c of node.children) {
        const mark = path.length;
        const r = tick(c, ctx, path);
        if (r !== FAIL) { path.splice(mark, 0, node.name); return r; }
        path.length = mark;
      }
      return FAIL;
    }
    case 'seq': {
      const mark = path.length;
      for (const c of node.children) {
        const r = tick(c, ctx, path);
        if (r !== OK) { if (r === FAIL) path.length = mark; else path.splice(mark, 0, node.name); return r; }
      }
      path.splice(mark, 0, node.name);
      return OK;
    }
  }
  return FAIL;
}

/** Runs a tree and keeps the last active path ("Bigfoot > Threatened > Warn") for debugging. */
export class Brain {
  constructor(root, ctx) { this.root = root; this.ctx = ctx; this.path = []; }
  tick() {
    const path = [];
    tick(this.root, this.ctx, path);
    this.path = path.filter((n, i) => n && n !== path[i - 1]);
    return this.path;
  }
  get pathText() { return this.path.join(' › '); }
}

/** Escalation levels: each hunting ground is a step up in challenge. */
export const LEVELS = Object.freeze({
  1: 'Level 1 · Pine Hollow (forgiving: warnings before danger)',
  2: 'Level 2 · Black Water Swamp (lights and lingering are punished)',
  3: 'Level 3 · Ranch country (relentless: few warnings)',
});
