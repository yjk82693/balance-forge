import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  outcomeClass,
  outcomeWords,
  targetWords,
  tentacleResultFrom,
  waveChangeLabel,
  waveName,
} from "../src/lib/tentacleDash.ts";
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
  assert.equal(r.waves[3].deaths, body.baseline.waves[3].deaths);
  assert.equal(r.flagged.wave, 4);
  assert.equal(r.patchedWaves.length, 6);
  assert.equal(r.targets[0].wave, 4);
  // the recorded example is an overshoot: the patch made wave 4 too easy and the verdict is rejected
  assert.equal(r.targets[0].outcome, "overshot");
  assert.deepEqual(r.targets[0].band, [0.6, 0.7]);
  assert.equal(body.verdict.verdict, "rejected");
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

import { scenesFor } from "../src/lib/presenter.ts";

test("the solo action scene comes after the card scene and before the history, only with a tentacle result", () => {
  const ids = (o) => scenesFor({ intent: false, profile: false, history: true, ...o }).map((s) => s.id);
  assert.ok(!ids({ cards: true }).includes("solo"));
  const both = ids({ cards: true, solo: true });
  assert.ok(both.indexOf("solo") > both.indexOf("cards"));
  assert.ok(both.indexOf("solo") < both.indexOf("history"));
  assert.ok(ids({ solo: true }).indexOf("solo") > ids({ solo: true }).indexOf("verdict"));
});

import { LONG_PRESS_MS, chargeFraction, pressKind } from "../src/lib/tentacleButton.ts";

test("one tentacle button: a tap whips, a hold of 250 ms or more throws the rope, the ring fills in between", () => {
  assert.equal(LONG_PRESS_MS, 250);
  assert.equal(pressKind(0), "whip");
  assert.equal(pressKind(249), "whip");
  assert.equal(pressKind(250), "latch");
  assert.equal(pressKind(2000), "latch");
  assert.equal(chargeFraction(0), 0);
  assert.equal(chargeFraction(125), 0.5);
  assert.equal(chargeFraction(250), 1);
  assert.equal(chargeFraction(900), 1);
  assert.equal(chargeFraction(-5), 0);
});

test("outcomes are worded and coloured: an overshoot is a warning, never a success; bands read as a range", () => {
  assert.equal(outcomeWords("overshot"), "overshot (too easy)");
  assert.equal(outcomeWords("on target"), "on target");
  assert.equal(outcomeClass("overshot"), "status warn");
  assert.equal(outcomeClass("on target"), "status ok");
  assert.equal(outcomeClass("improved"), "status ok");
  assert.equal(outcomeClass("worse"), "status bad");
  assert.equal(outcomeClass("unchanged"), "badge");
  assert.equal(targetWords([0.6, 0.7], 0.65), "target 60–70%");
  assert.equal(targetWords(null, 0.65), "target 65%");
  assert.equal(targetWords(null, null), null);
});
