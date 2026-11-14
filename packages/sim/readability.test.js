import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
function files(directory) {
  return readdirSync(directory, {
    withFileTypes: true
  }).flatMap(entry => entry.isDirectory() ? files(new URL(entry.name + '/', directory)) : [new URL(entry.name,
    directory)]);
}
test('game and simulation sources and documentation stay within 120 columns', () => {
  for (const file of [...files(new URL('../games/', import.meta.url)), ...files(new URL('./', import.meta.url))]) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      assert.ok(line.length <= 120, `${file.pathname}:${index + 1}: ${line.length} columns`);
    });
  }
});
