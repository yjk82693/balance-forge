import type { PlaytestRun } from "./api";
import type { Report } from "./contract";
import { wilson } from "./stats";
import type { WaveRow } from "./tentacleDash";

/**
 * Sample data for ?mock=1 with Sepia Tentacle Run only: hand-picked wave numbers around a nearly unbeatable wave 4.
 * Never shown as results; the screen labels it "sample data".
 */
const row = (wave: number, reached: number, cleared: number, outlier = false): WaveRow => {
  const target = wave === 6 ? 0.5 : 0.7 - (wave - 1) * 0.04;
  const rate = reached ? cleared / reached : null;
  return {
    wave,
    reached,
    reachRate: reached / 200,
    cleared,
    clearRate: rate,
    ci95: reached ? wilson(cleared, reached) : null,
    target,
    deltaToTarget: rate === null ? null : rate - target,
    deaths: reached - cleared,
    outlier,
  };
};

const BROKEN = [
  row(1, 200, 182),
  row(2, 182, 140),
  row(3, 140, 101),
  row(4, 101, 17, true),
  row(5, 17, 12),
  row(6, 12, 5),
];
const PATCHED = [
  row(1, 200, 181),
  row(2, 181, 139),
  row(3, 139, 100),
  row(4, 100, 63),
  row(5, 63, 41),
  row(6, 41, 15),
];

export function mockTentacleReport(version: "broken" | "patched"): Report {
  return {
    reportId: `sample-tentacle-${version}`,
    gameId: "tentacle_run",
    simVersion: "sample",
    dataHash: "",
    botPolicyVersion: "sample",
    seedSetId: "sample",
    validMatches: 200,
    invalidMatches: 0,
    draws: 0,
    rows: [],
  };
}

export function mockTentacleRun(): PlaytestRun {
  const flagged = BROKEN[3];
  return {
    sample: true,
    baseline: mockTentacleReport("broken"),
    patched: mockTentacleReport("patched"),
    tentacle: {
      runs: 200,
      holdoutRuns: 200,
      winRate: 0.025,
      winCi95: wilson(5, 200),
      meanTicks: 2600,
      waves: BROKEN,
      patchedWaves: PATCHED,
      flagged: {
        wave: 4,
        clearRate: flagged.clearRate ?? 0,
        ci95: flagged.ci95,
        target: flagged.target ?? 0.6,
        deltaToTarget: flagged.deltaToTarget ?? 0,
      },
      targets: [
        {
          wave: 4,
          before: { rate: 17 / 101, ci95: flagged.ci95, games: 101 },
          after: { rate: 0.63, ci95: PATCHED[3].ci95, games: 100 },
          outcome: "improved",
          band: [0.5, 0.7],
        },
      ],
      elapsedMs: null,
    },
    proposal: {
      patch: {
        baseDataHash: "",
        replacements: [{ path: "/gameRules/sections/3/pits", value: 3 }],
        rationale: "Sample: section 4 has fewer pits so it can be cleared about as often as the other sections.",
      },
      origin: "fake",
      changes: [{ path: "/gameRules/sections/3/pits", label: "Section 4 · Pits", old: 8, new: 3 }],
      validation: { ok: true, errors: [] },
    },
    verdict: { verdict: "accepted", reasons: ["sample verdict; not computed"] },
  };
}
