import { test } from "node:test";
import assert from "node:assert/strict";
import { intentBody } from "../src/lib/intentBody.ts";
import { normalizeIntent } from "../../../packages/analysis/src/intent.ts";

// The "Intended?" chips and the intent page save through PUT /v1/design/<game>/intent. The engine's own check
// (normalizeIntent) is what the server runs on that body, so the body is run through it here.

const chosen = { matchups: { "bari vs real_armor": { favored: "bari", strength: "clear" } } };

test("the intent PUT body passes the engine's schema", () => {
  const out = normalizeIntent(intentBody(chosen));
  assert.equal(out.matchups["bari vs real_armor"].favored, "bari");
  assert.equal(out.matchups["bari vs real_armor"].strength, "clear");
});

test("the version is a short string (a number was rejected by the live server)", () => {
  const { version } = intentBody(chosen);
  assert.equal(typeof version, "string");
  assert.ok(version.length > 0 && version.length <= 64);
  assert.throws(() => normalizeIntent({ ...intentBody(chosen), version: 7 }), /short string/);
});

test("all ten pairs are sent, the ones nobody chose as even with no favorite", () => {
  const { matchups } = intentBody({ matchups: {} });
  assert.equal(Object.keys(matchups).length, 10);
  assert.deepEqual(matchups["bari vs daewi"], { strength: "even" });
  normalizeIntent(intentBody({ matchups: {} }));
});

test("every save is a new version", () => {
  assert.notEqual(intentBody(chosen, 1000).version, intentBody(chosen, 2000).version);
});
