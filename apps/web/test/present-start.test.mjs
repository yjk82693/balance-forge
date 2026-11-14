import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldStartOnMount } from "../src/lib/presentStart.ts";

test("opening #/present on a live server starts no run by itself", () => {
  assert.equal(shouldStartOnMount({ auto: false, mock: false }), false);
});

test("?auto=1 (video recording) starts the run", () => {
  assert.equal(shouldStartOnMount({ auto: true, mock: false }), true);
});

test("?mock=1 has no server, so its sample run may play on its own", () => {
  assert.equal(shouldStartOnMount({ auto: false, mock: true }), true);
});

test("Present only starts a run through shouldStartOnMount, R or the Run live button", () => {
  const src = readFileSync(new URL("../src/screens/Present.tsx", import.meta.url), "utf8");
  const calls = [...src.matchAll(/\bstart\(/g)].length;
  // one call guarded by shouldStartOnMount, one in restart (R / button)
  assert.equal(calls, 2);
  assert.match(src, /if \(shouldStartOnMount\(\{ auto, mock \}\)\) \{\s*void start\(/);
});
