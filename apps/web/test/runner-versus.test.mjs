import { test } from "node:test";
import assert from "node:assert/strict";
import * as v from "../src/lib/runnerVersus.ts";

const { versusCameraLeft, laneColorName, versusCause, withBotNames, barFill, laneLabel } = v;
const { versusEnd, versusEndWords, versusHeadline, versusOf } = v;

test("versus block is read, or null", () => {
  assert.equal(versusOf({}), null);
  assert.equal(versusOf({ versus: { you: "p1", runners: [{ id: "p1" }] } }), null);
  const r = { id: "p2", x: 500, state: "jumping", alive: false, section: 2 };
  assert.deepEqual(versusOf({ versus: { you: null, leader: "p2", runners: [r] } }), {
    you: null,
    leader: "p2",
    runners: [r],
  });
});

test("a runner's pose and wire are kept when sent", () => {
  const wire = { anchorId: "a1", anchorX: 900, anchorY: 2000, length: 800 };
  const v = versusOf({ versus: { runners: [{ id: "p2", x: 1, y: 300, height: 500, wire }] } });
  assert.deepEqual(v.runners[0], { id: "p2", x: 1, state: "running", alive: true, section: 1, y: 300, height: 500, wire });
});

test("end of match from the seat's side", () => {
  assert.equal(versusEnd(["p1"], "p1"), "win");
  assert.equal(versusEnd(["p2"], "p1"), "lose");
  assert.equal(versusEnd([], "p1"), "draw");
  assert.equal(versusEnd(["p1"], undefined), "lose");
  assert.equal(versusEndWords("win"), "YOU WIN");
  assert.equal(versusEndWords("lose"), "YOU LOSE");
  assert.equal(versusEndWords("draw"), "DRAW");
});

test("big screen headline and bars", () => {
  assert.equal(versusHeadline(["p2"]), "P2 WINS");
  assert.equal(versusHeadline(["p2"], { p1: "Ana", p2: "  Bo " }), "BO WINS");
  assert.equal(versusHeadline(["p1"], { p1: "" }), "P1 WINS");
  assert.equal(laneLabel("p1", { p1: "Ana" }), "Ana");
  assert.equal(laneLabel("p2", {}), "P2");
  assert.equal(versusHeadline([]), "DRAW");
  assert.equal(barFill(5000, 20000), 0.25);
  assert.equal(barFill(-5, 20000), 0);
  assert.equal(barFill(30000, 20000), 1);
  assert.equal(barFill(1, 0), 0);
});

test("a runner without a seat is the bot", () => {
  const runners = [{ id: "p1" }, { id: "p2" }];
  assert.deepEqual(withBotNames({ p1: "Ana" }, runners, ["p1"]), { p1: "Ana", p2: "Bot" });
  assert.deepEqual(withBotNames({ p1: "Ana", p2: "Bo" }, runners, ["p1", "p2"]), { p1: "Ana", p2: "Bo" });
});

test("the cause line", () => {
  const ids = ["p1", "p2"];
  const names = { p1: "Ana", p2: "Bo" };
  const down = { reason: "opponent_down", winners: ["p1"] };
  assert.equal(versusCause(down, ids, "p1", names), "Bo fell");
  assert.equal(versusCause(down, ids, "p2", names), "You fell");
  assert.equal(versusCause(down, ids, null, names), "Bo fell");
  const fin = { reason: "finish", winners: ["p2"] };
  assert.equal(versusCause(fin, ids, "p2", names), "You crossed the finish first");
  assert.equal(versusCause(fin, ids, "p1", names), "Bo crossed the finish first");
  assert.equal(versusCause({ reason: "draw", winners: [] }, ids, "p1", names), "Both fell together");
  assert.match(versusCause({ reason: "max_ticks", winners: ["p1"] }, ids, null, names), /^Ana got further/);
});

test("camera frames both runners, or follows the leader", () => {
  // span 10000: a gap of 4000 fits, so the view is centred between them
  assert.equal(versusCameraLeft([20000, 24000], 10000, 0.25), 22000 - 5000);
  // a gap of 9000 does not: the leader keeps a quarter of the view behind them
  assert.equal(versusCameraLeft([20000, 29000], 10000, 0.25), 29000 - 2500);
  assert.equal(laneColorName("p1"), "RED");
  assert.equal(laneColorName("p2"), "BLUE");
});
