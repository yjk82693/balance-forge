import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tentacleResultFrom, waveChangeLabel, waveName } from "../src/lib/tentacleDash.ts";
import { activePips, isTentaclePayload, segmentCount, toCanvas, waveLabel } from "../src/lib/tentacle.ts";

test("a patch path is said in words, counting waves from 1", () => {
  assert.equal(waveChangeLabel("/gameRules/waves/3/enemyDamage"), "Wave 4 · Enemy damage");
  assert.equal(waveChangeLabel("/gameRules/waves/0/sentries"), "Wave 1 · Sentries");
  assert.equal(waveChangeLabel("/gameRules/cards/4/cost"), null);
  assert.equal(waveName(6), "Man-Shark");
  assert.equal(waveName(4), "Wave 4");
});

test("the /full body of the engine is read: wave table, flagged wave, per-wave verdict", () => {
  const file = new URL("../../../packages/games/tentacle/example-full.json", import.meta.url);
  const body = JSON.parse(readFileSync(file, "utf8"));
  const r = tentacleResultFrom(body);
  assert.ok(r);
  assert.deepEqual(r.waves.map((w) => w.wave), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.waves[3].outlier, true);
  assert.equal(r.waves[3].deaths, 50);
  assert.equal(r.flagged.wave, 4);
  assert.equal(r.patchedWaves.length, 6);
  assert.equal(r.targets[0].wave, 4);
  assert.equal(r.targets[0].outcome, "improved");
  assert.equal(r.runs, body.runs);
  assert.equal(tentacleResultFrom({ baseline: {} }), null);
  assert.equal(tentacleResultFrom(null), null);
});

test("the scene reads the engine payload, and draws arena points on the canvas", () => {
  const p = { wave: 3, waveCount: 5, entities: [], posts: [], projectiles: [], boss: null };
  assert.equal(isTentaclePayload(p), true);
  assert.equal(isTentaclePayload({ wave: 3 }), false);
  assert.equal(waveLabel({ wave: 0, waveCount: 5 }), "Get ready");
  assert.equal(waveLabel({ wave: 3, waveCount: 5 }), "Wave 3 of 5");
  assert.equal(waveLabel({ wave: 6, waveCount: 5 }), "Man-Shark");
  assert.deepEqual(toCanvas({ x: 8000, y: 4500 }, 1152, 648), { x: 576, y: 324 });
  assert.equal(segmentCount(0, 28), 1);
  assert.equal(segmentCount(10000, 28), 24);
  assert.equal(activePips(0, 3), 3);
  assert.equal(activePips(2, 3), 1);
});
