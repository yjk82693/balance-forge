import { test } from "node:test";
import assert from "node:assert/strict";
import { patchedVersion, rootVersion, selectRoomVersion, versionLine } from "../src/lib/roomVersion.ts";

const v = (hash, over = {}) => ({
  dataHash: hash,
  parentHash: "r".repeat(64),
  createdAt: "2026-11-14T10:00:00Z",
  origin: "gemini",
  changes: [],
  verdict: { verdict: "accepted" },
  approved: false,
  ...over,
});
const ROOT = "b".repeat(64);
const root = v(ROOT, { parentHash: null, origin: "base", verdict: null, approved: true });
const older = v("1".repeat(64), {
  createdAt: "2026-11-14T10:00:00Z",
  changes: [{ path: "/characters/0/health", label: "Bari · Health", old: 540, new: 480 }],
});
const newer = v("2".repeat(64), { createdAt: "2026-11-14T11:00:00Z" });
const rejected = v("3".repeat(64), { createdAt: "2026-11-14T12:00:00Z", verdict: { verdict: "rejected" } });
const sent = () => { const log = []; return { log, send: (type, payload) => log.push({ type, payload }) }; };

test("pressing Patched sends game.select with the accepted hash", () => {
  const t = sent();
  const picked = selectRoomVersion(t, "hero_arena", { versions: [root, older, newer, rejected] }, "patched");
  assert.equal(picked.dataHash, newer.dataHash);
  assert.deepEqual(t.log, [{ type: "game.select", payload: { gameId: "hero_arena", dataHash: newer.dataHash } }]);
});

test("pressing Broken selects the root version", () => {
  const t = sent();
  selectRoomVersion(t, "hero_arena", { versions: [older, root, newer] }, "broken");
  assert.deepEqual(t.log[0].payload, { gameId: "hero_arena", dataHash: ROOT });
});

test("the server's current version wins when it is not the root, even if an older one is newer by time", () => {
  const list = { versions: [root, older, newer], currentHash: older.dataHash };
  assert.equal(patchedVersion(list).dataHash, older.dataHash);
  assert.equal(patchedVersion({ ...list, currentHash: ROOT }).dataHash, newer.dataHash);
});

test("with no accepted version Patched has nothing to send", () => {
  const t = sent();
  const list = { versions: [root, rejected] };
  assert.equal(patchedVersion(list), null);
  assert.equal(selectRoomVersion(t, "hero_arena", list, "patched"), null);
  assert.deepEqual(t.log, []);
  assert.equal(rootVersion(list).dataHash, ROOT);
});

test("the version line names the hash and the changes", () => {
  assert.equal(versionLine(older), "version 1111111 · Bari · Health 540 → 480");
  assert.equal(versionLine(newer), "version 2222222");
});
