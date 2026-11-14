// Hero Cards diagnosis by card: which card change moves a flagged deck matchup, measured by running it.
// A table of play rates cannot say that: every card of a winning deck "wins when played" because the deck wins. So
// each lever (one card's cost or power, one step) is probed on fresh seeds and compared with the unchanged data on
// the SAME seeds. Pure: the server supplies the probe runs (runCardProbe), nothing here simulates.
//   cardVariants(data, deckIds)        the levers to probe: { path, cardId, field, from, to }
//   buildCardDiagnosis({ matchup, target, baselineRate, probes })   ranked levers with the measured effect
import { analyzePhase } from '../pipeline/pipeline.ts';
import { analyzeCardsByDeck } from './cards.ts';
import { round6 } from './wilson.ts';
import { fail } from './errors.ts';

const BOUNDS = { cost: [1, 3], power: [1, 10] }; // contract v0.1.4 (see validator.js)
const Z = 1.96;
export const MAX_LEVERS = 8;

/** Cost and power, one step up and down, for each distinct card of the decks (a peek card has no power). */
export function cardVariants(data, deckIds) {
  const decks = data.gameRules?.decks ?? [];
  const ids = new Set(deckIds.flatMap((id) => decks.find((d) => d.id === id)?.cardIds ?? []));
  const variants = [];
  (data.gameRules?.cards ?? []).forEach((card, index) => {
    if (!ids.has(card.id)) return;
    for (const field of ['power', 'cost']) {
      if (field === 'power' && card.kind === 'peek') continue;
      for (const step of [-1, 1]) {
        const to = card[field] + step;
        if (to < BOUNDS[field][0] || to > BOUNDS[field][1]) continue;
        variants.push({ path: `/gameRules/cards/${index}/${field}`, cardId: card.id, field, from: card[field], to });
      }
    }
  });
  return variants;
}

const rowOf = (results, matchup) => {
  const { report } = analyzePhase(results, { reportId: 'r-probe' });
  return report.rows.find((r) => r.dimension === matchup) ?? null;
};

/**
 * probes: [{ variant: null | variant, results }]; exactly one entry has variant null (the unchanged data on the
 * probe seeds). Resolves { kind: 'cards', matchup, focalDeck, focalRate, target, probeBaseline, levers, cards }.
 * effect = win rate of the first-named deck with the change minus without it, same seeds, in points of 1.0.
 * towardTarget: the change moves the rate toward `target`. significant: the difference is beyond 1.96 standard errors.
 */
export function buildCardDiagnosis({ matchup, target = 0.5, baselineRate, probes, baselineResults = [] }) {
  const base = probes.find((p) => p.variant === null);
  if (!base) fail('INVALID_INPUT', 'probes need one run of the unchanged data');
  const baseRow = rowOf(base.results, matchup);
  if (!baseRow) fail('INVALID_INPUT', `the probe results have no rows for ${matchup}`);
  const focal = baselineRate ?? baseRow.winRate;
  const direction = Math.sign(target - focal) || 1;
  const se = (row) => Math.sqrt((row.winRate * (1 - row.winRate)) / row.games);
  const levers = probes.filter((p) => p.variant !== null).map(({ variant, results }) => {
    const row = rowOf(results, matchup);
    if (!row) return null;
    const effect = round6(row.winRate - baseRow.winRate);
    const noise = Z * Math.sqrt(se(row) ** 2 + se(baseRow) ** 2);
    return { ...variant, rate: row.winRate, games: row.games, effect, significant: Math.abs(effect) > noise,
      towardTarget: effect * direction > 0 };
  }).filter(Boolean);
  const ranked = [...levers].sort((a, b) => b.effect * direction - a.effect * direction
    || (a.path < b.path ? -1 : 1) || a.to - b.to);
  const useful = ranked.filter((l) => l.towardTarget && l.significant);
  return {
    kind: 'cards', matchup, focalDeck: matchup.split(' vs ')[0], focalRate: focal, target,
    direction: direction > 0 ? 'up' : 'down',
    probeBaseline: { rate: baseRow.winRate, games: baseRow.games, ci95: baseRow.ci95 },
    levers: (useful.length ? useful : ranked.slice(0, 3)).slice(0, MAX_LEVERS),
    probed: levers.length, significantLevers: levers.filter((l) => l.significant).length,
    cards: baselineResults.length ? analyzeCardsByDeck(baselineResults) : null,
  };
}
