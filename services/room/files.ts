import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function writeJson(path, value) {
  mkdirSync(dirname(path), {
    recursive: true
  });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
    renameSync(temporary, path);
  } finally {
    try {
      rmSync(temporary, {
        force: true
      });
    } catch {}
  }
}
