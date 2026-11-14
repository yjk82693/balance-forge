import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { humanStyleNumbers, parseHumanStyle } from "../src/lib/humanStyle.ts";

const file = JSON.parse(readFileSync(new URL("../../../services/runner/learned/human-style.json", import.meta.url), "utf8"));

test("the committed human-style file reads as exploratory, not ready", () => {
  const h = parseHumanStyle(file);
  assert.ok(h);
  assert.equal(h.ready, file.readiness.ready);
  assert.equal(h.policy, "cloned-lr-1");
  assert.equal(h.matches, 9);
  assert.match(h.caveat, /handful of matches/);
});

test("its numbers are the file's own, with the baselines beside them", () => {
  const lines = humanStyleNumbers(parseHumanStyle(file)).join(" | ");
  assert.match(lines, /Held-out accuracy 21\.0% against 23\.4%/);
  assert.match(lines, /Cross-validation 31\.4% against 19\.8%/);
});

test("anything but an explicit ready: true is not ready", () => {
  assert.equal(parseHumanStyle({ policy: "p" }).ready, false);
  assert.equal(parseHumanStyle({ policy: "p", readiness: { ready: "yes" } }).ready, false);
  assert.equal(parseHumanStyle({ policy: "p", readiness: { ready: true } }).ready, true);
  assert.equal(parseHumanStyle({ nope: 1 }), null);
});
