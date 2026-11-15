import { test } from "node:test";
import assert from "node:assert/strict";
import { recordText } from "../src/lib/groups.ts";
import { parseLiveHumans } from "../src/lib/liveHumans.ts";

test("live human rows: only human rows, null for a bad body", () => {
  const rows = [{ dimension: "human: Ana vs Bo" }, { dimension: "bari vs daewi" }, { nope: 1 }];
  assert.deepEqual(parseLiveHumans({ rows, humanMatches: 1 }), [{ dimension: "human: Ana vs Bo" }]);
  assert.deepEqual(parseLiveHumans({ rows: [] }), []);
  assert.equal(parseLiveHumans(null), null);
  assert.equal(parseLiveHumans({ rows: "x" }), null);
});

test("a small human sample shows its record", () => {
  assert.equal(recordText(9, 12), "9–3 (n=12)");
  assert.equal(recordText(1, 1), "1–0 (n=1)");
});
