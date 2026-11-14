import { test } from "node:test";
import assert from "node:assert/strict";
import { heroToSend, syncHero } from "../src/lib/heroSync.ts";

const base = { phase: "lobby", seatHero: "bari", wanted: "real_armor", online: true, seated: true };
const fake = () => { const log = []; return { log, send: (type, payload) => log.push({ type, payload }) }; };

test("changing the hero while seated in the lobby sends room.hero", () => {
  const t = fake();
  assert.equal(syncHero(t, base), "real_armor");
  assert.deepEqual(t.log, [{ type: "room.hero", payload: { hero: "real_armor" } }]);
});

test("a resumed seat sends the hero the phone shows, not the stored one", () => {
  // the room still has Bari, the phone shows Real Armor
  const t = fake();
  syncHero(t, { ...base, seatHero: "bari", wanted: "real_armor" });
  assert.equal(t.log[0].payload.hero, "real_armor");
});

test("nothing is sent when the hero already matches, or was just sent", () => {
  assert.equal(heroToSend({ ...base, seatHero: "real_armor" }), null);
  assert.equal(heroToSend({ ...base, lastSent: "real_armor" }), null);
});

test("nothing is sent outside the lobby, without a seat or while offline", () => {
  assert.equal(heroToSend({ ...base, phase: "playing" }), null);
  assert.equal(heroToSend({ ...base, seated: false }), null);
  assert.equal(heroToSend({ ...base, online: false }), null);
  const t = fake();
  assert.equal(syncHero(t, { ...base, phase: "ended" }), null);
  assert.deepEqual(t.log, []);
});
