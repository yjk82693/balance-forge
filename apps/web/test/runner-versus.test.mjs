import { test } from "node:test";
import assert from "node:assert/strict";
import { barFill, versusEnd, versusEndWords, versusHeadline, versusOf } from "../src/lib/runnerVersus.ts";

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
  assert.equal(versusHeadline([]), "DRAW");
  assert.equal(barFill(5000, 20000), 0.25);
  assert.equal(barFill(-5, 20000), 0);
  assert.equal(barFill(30000, 20000), 1);
  assert.equal(barFill(1, 0), 0);
});
