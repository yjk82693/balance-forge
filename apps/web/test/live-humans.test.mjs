import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLiveHumans } from "../src/lib/liveHumans.ts";

test("live human rows: only human rows, null for a bad body", () => {
  const rows = [{ dimension: "human: Ana vs Bo" }, { dimension: "bari vs daewi" }, { nope: 1 }];
  assert.deepEqual(parseLiveHumans({ rows, humanMatches: 1 }), [{ dimension: "human: Ana vs Bo" }]);
  assert.deepEqual(parseLiveHumans({ rows: [] }), []);
  assert.equal(parseLiveHumans(null), null);
  assert.equal(parseLiveHumans({ rows: "x" }), null);
});
