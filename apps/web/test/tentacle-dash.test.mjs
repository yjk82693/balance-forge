import { test } from "node:test";
import { scenesFor } from "../src/lib/presenter.ts";
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
import { segmentCount } from "../src/lib/tentacle.ts";
import { groundSegments, isRunnerPayload, progress, sectionLabel, toScreenX } from "../src/lib/runner.ts";
import { CONTROL_ACTION, NO_CONTROL, controlParams, withButton } from "../src/lib/runnerInput.ts";

test("a patch path is said in words, counting sections from 1", () => {
  assert.equal(waveChangeLabel("/gameRules/sections/3/pits"), "Section 4 · Pits");
  assert.equal(waveChangeLabel("/gameRules/sections/0/lowBars"), "Section 1 · Low bars");
  assert.equal(waveChangeLabel("/gameRules/sections/5/runSpeed"), "Section 6 · Run speed");
  assert.equal(waveChangeLabel("/gameRules/cards/4/cost"), null);
  assert.equal(waveName(6), "Man-Shark chase");
  assert.equal(waveName(4), "Section 4");
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

const payload = (over = {}) => ({
  section: 3, sectionCount: 6, sectionStartX: 0, sectionEndX: 80000, cameraX: 4000, viewWidth: 16000, finishX: 480000,
  player: { x: 8000, y: 0, vx: 220, vy: 0, state: "running", height: 1200, jumpHeldTicks: 0, wire: null },
  obstacles: [], anchors: [], shark: null, ...over,
});

test("the runner reads the engine payload and draws world points on the screen", () => {
  assert.equal(isRunnerPayload(payload()), true);
  assert.equal(isRunnerPayload({ section: 3 }), false);
  assert.equal(sectionLabel({ section: 3, sectionCount: 6 }), "Section 3 of 6");
  assert.equal(sectionLabel({ section: 6, sectionCount: 6 }), "Man-Shark chase");
  assert.equal(toScreenX(4000, 0, 16000, 1152), 288); // the player stays a quarter of the way in
  assert.equal(toScreenX(8000, 4000, 16000, 1152), 288);
  assert.equal(progress({ finishX: 480000, player: { x: 240000 } }), 0.5);
  assert.equal(progress({ finishX: 0, player: { x: 5 } }), 0);
  assert.equal(segmentCount(0, 28), 1);
  assert.equal(segmentCount(10000, 28), 24);
});

test("the ground has a gap at each pit", () => {
  const pits = [{ x: 1000, w: 500 }, { x: 3000, w: 200 }];
  assert.deepEqual(groundSegments(pits, 0, 4000), [[0, 1000], [1500, 3000], [3200, 4000]]);
  assert.deepEqual(groundSegments([], 0, 100), [[0, 100]]);
  assert.deepEqual(groundSegments([{ x: 0, w: 100 }], 0, 100), []);
});

test("the phone reports held buttons as one control action, only when a button changes", () => {
  assert.equal(CONTROL_ACTION, "control");
  const jump = withButton(NO_CONTROL, "jump", true);
  assert.deepEqual(controlParams(jump), { jump: 1, slide: 0 });
  assert.equal(withButton(jump, "jump", true), null); // no change, nothing sent
  const both = withButton(jump, "slide", true);
  assert.deepEqual(controlParams(both), { jump: 1, slide: 1 });
  assert.deepEqual(controlParams(withButton(both, "jump", false)), { jump: 0, slide: 1 });
  assert.equal(withButton(NO_CONTROL, "slide", false), null);
});

test("the solo action scene comes after the card scene and before the history, only with a tentacle result", () => {
  const ids = (o) => scenesFor({ intent: false, profile: false, history: true, ...o }).map((s) => s.id);
  assert.ok(!ids({ cards: true }).includes("solo"));
  const both = ids({ cards: true, solo: true });
  assert.ok(both.indexOf("solo") > both.indexOf("cards"));
  assert.ok(both.indexOf("solo") < both.indexOf("history"));
  assert.ok(ids({ solo: true }).indexOf("solo") > ids({ solo: true }).indexOf("verdict"));
});

import { RING_MS, chargeFraction } from "../src/lib/tentacleButton.ts";

test("the jump ring fills over the engine's tap length", () => {
  assert.equal(RING_MS, 200);
  assert.equal(chargeFraction(0), 0);
  assert.equal(chargeFraction(100), 0.5);
  assert.equal(chargeFraction(200), 1);
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
