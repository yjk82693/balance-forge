import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
function sourceFiles(directory) {
  return readdirSync(directory, {
    withFileTypes: true
  }).flatMap(entry => {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) return sourceFiles(new URL(entry.name + '/', directory));
    return /\.(js|ts|md)$/.test(entry.name) ? [path] : [];
  });
}
test('contract and service sources and documentation stay within 120 columns', () => {
  const roots = [new URL('../../packages/contracts/', import.meta.url), new URL('../', import.meta.url)];
  for (const file of roots.flatMap(sourceFiles)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      assert.ok(line.length <= 120, `${file.pathname}:${index + 1}: ${line.length} columns`);
    });
  }
});
