// Disk backend for the SaveService (Node only: tests and any future desktop build).
// Atomic write: the JSON goes to "<file>.tmp" first, then is renamed over the real file, so a
// crash mid-write can never leave a half-written save.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function fileBackend(path) {
  return {
    read() {
      try { return readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    write(text) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, path);
    },
  };
}
