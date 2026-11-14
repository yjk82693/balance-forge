import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isServerRequest } from "../src/lib/staticMode.ts";
import { pickRecordedVersion, staticRaw } from "../src/lib/staticRaw.ts";

const json = (name) => JSON.parse(readFileSync(new URL(`../../../services/runner/${name}`, import.meta.url), "utf8"));

test("the static build refuses every request for the room server, and only those", () => {
  const server = [
    "/v1/versions/hero_arena",
    "v1/sinks",
    "./v1/design/hero_arena/intent",
    "http://x.test/v1/playtest/full",
    "/ws",
    "/ws/room",
    "http://localhost:3000/v1/health?x=1",
  ];
  const other = ["assets/manifest.json", "./assets/hero_arena/a.png", "/assets/index-1.js", "https://fonts.test/a.css"];
  for (const u of server) assert.equal(isServerRequest(u), true, u);
  for (const u of other) assert.equal(isServerRequest(u), false, u);
});

test("the recorded patch is an accepted version with a measured target, the approved one first", () => {
  const history = json("recorded-auto-history.json");
  const v = pickRecordedVersion(history.versions);
  assert.ok(v);
  assert.equal(v.verdict.verdict, "accepted");
  assert.equal(v.approved, true);
  assert.equal(pickRecordedVersion([]), null);
  assert.equal(pickRecordedVersion([{ origin: "base", verdict: { verdict: "accepted" } }]), null);
});

test("the static result is made only of recorded numbers: one matchup, its patch and verdict", () => {
  const roster = json("recorded-roster-report.json");
  const history = json("recorded-auto-history.json");
  const raw = staticRaw(roster, history);
  const v = pickRecordedVersion(history.versions);
  assert.equal(raw.baseline.rows.length, 1);
  assert.equal(raw.baseline.rows[0].dimension, v.target.matchup);
  const rosterRow = roster.rows.find((r) => r.dimension === v.target.matchup);
  assert.equal(raw.baseline.rows[0].wins, rosterRow.wins);
  assert.equal(raw.patched.rows[0].winRate, v.target.after.rate);
  assert.equal(raw.proposal.origin, v.origin);
  assert.deepEqual(raw.proposal.replacements, v.changes.map((c) => ({ path: c.path, value: c.new })));
  assert.equal(raw.verdict.verdict, "accepted");
  assert.equal(raw.patchedDataHash, v.dataHash);
});

test("without a recorded patch the result is the roster alone", () => {
  const roster = json("recorded-roster-report.json");
  const raw = staticRaw(roster, { versions: [] });
  assert.equal(raw.baseline.rows.length, roster.rows.length);
  assert.equal(raw.patched, undefined);
});
