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
  // the outcome and band are the example's own (the engine regenerates it: on target / accepted today)
  assert.equal(r.targets[0].outcome, body.verdict.targets[0].outcome);
  assert.deepEqual(r.targets[0].band, body.verdict.targets[0].band);
  assert.ok(["improved", "on target", "overshot", "unchanged", "worse"].includes(r.targets[0].outcome));
  assert.equal(r.flagged.wave, body.flaggedWave.wave);
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

import { entryScript, isNewBuild } from "../src/lib/staleBuild.ts";

test("a tab reloads only when the server's entry script differs from its own", () => {
  const page = (h) => `<script type="module" crossorigin src="./assets/index-${h}.js"></script>`;
  assert.equal(entryScript(page("AbC-123")), "assets/index-AbC-123.js");
  assert.equal(entryScript("<html></html>"), null);
  assert.equal(isNewBuild(page("new"), "./assets/index-old.js"), true);
  assert.equal(isNewBuild(page("same"), "./assets/index-same.js"), false);
  assert.equal(isNewBuild("<html></html>", "./assets/index-old.js"), false);
  assert.equal(isNewBuild(page("new"), null), false);
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

import {
  DEFAULT_META,
  RUNNER_SLOTS,
  buildingSlot,
  feetOrigin,
  hookDisplay,
  runFrameIndex,
  sepiaSlot,
  spriteDisplay,
} from "../src/lib/runnerArt.ts";

test("the run cycle follows the distance travelled and the right sprite is chosen for each state", () => {
  assert.equal(runFrameIndex(0), 0);
  assert.equal(runFrameIndex(699), 0);
  assert.equal(runFrameIndex(700), 1);
  assert.equal(runFrameIndex(700 * 6), 0);
  assert.equal(runFrameIndex(700 * 13), 1);
  const s = { state: "running", vy: 0, x: 1400, hooking: false, down: false };
  assert.equal(sepiaSlot(s), "sepia_run_3");
  assert.equal(sepiaSlot({ ...s, state: "jumping", vy: 5 }), "sepia_jump_up");
  assert.equal(sepiaSlot({ ...s, state: "jumping", vy: -5 }), "sepia_jump_fall");
  assert.equal(sepiaSlot({ ...s, state: "jumping", hooking: true }), "sepia_hook_throw");
  assert.equal(sepiaSlot({ ...s, state: "sliding" }), "sepia_slide");
  assert.equal(sepiaSlot({ ...s, state: "swinging" }), "sepia_swing");
  assert.equal(sepiaSlot({ ...s, down: true }), "sepia_down");
  for (const slot of ["sepia_run_1", "sepia_run_6", "sepia_swing", "bg_near", "btn_slide_pressed"]) {
    assert.ok(RUNNER_SLOTS.includes(slot), slot);
  }
});

test("hook buildings are stable per anchor and drawn so the ring sits on the anchor", () => {
  assert.equal(buildingSlot("a1"), buildingSlot("a1"));
  assert.ok(["hook_building_1", "hook_building_2", "hook_building_3"].includes(buildingSlot("anchor-7")));
  // the ring is 80 of 1024 below the top: a cell 1024 tall puts it 944 above the ground
  assert.equal(Math.round(hookDisplay(944)), 1024);
  assert.ok(hookDisplay(0) > 0);
  assert.equal(DEFAULT_META.feetY, 472);
  assert.equal(feetOrigin(), 472 / 512);
  assert.equal(spriteDisplay(400), 512);
});

test("an overshoot with its band is read from the verdict, whatever the example holds", () => {
  const file = new URL("../../../packages/games/tentacle/example-full.json", import.meta.url);
  const body = JSON.parse(readFileSync(file, "utf8"));
  const target = { ...body.verdict.targets[0], outcome: "overshot", band: [0.6, 0.7] };
  const r = tentacleResultFrom({ ...body, verdict: { ...body.verdict, verdict: "rejected", targets: [target] } });
  assert.equal(r.targets[0].outcome, "overshot");
  assert.deepEqual(r.targets[0].band, [0.6, 0.7]);
  assert.equal(outcomeClass(r.targets[0].outcome), "status warn");
});

import { hookPlacement } from "../src/lib/runnerArt.ts";

test("a measured hook building is placed with its ring on the anchor and its base on the ground", () => {
  const meta = { ...DEFAULT_META, hooks: { hook_building_1: { w: 544, h: 688, ringX: 272, ringY: 36 } } };
  const p = hookPlacement("hook_building_1", 326, meta); // 326 px from the anchor down to the ground
  assert.equal(Math.round(p.height), Math.round((688 / (688 - 36)) * 326));
  assert.equal(p.originX, 0.5);
  assert.equal(p.originY, 36 / 688);
  // the ring is p.originY of the height below the top, so the base is (1 - originY) * height below the ring = ground
  assert.equal(Math.round((1 - p.originY) * p.height), 326);
  assert.equal(hookPlacement("hook_building_2", 100, meta), null);
  assert.equal(hookPlacement("hook_building_1", 100, DEFAULT_META), null);
});
