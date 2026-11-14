import { useRef, useState } from "react";
import { FitStage } from "../components/FitStage";
import { FitnessCurve } from "../components/FitnessCurve";
import { HeroPortrait } from "../components/HeroPortrait";
import { RateRow } from "../components/HeroProfile";
import { MatchupPicker } from "../components/MatchupPicker";
import { TopBar } from "../components/TopBar";
import { rowStats } from "../components/WinRateChart";
import { ApiError, runPlaytest } from "../lib/api";
import { useManifest } from "../lib/assets";
import type { HeldOut } from "../lib/botPolicy";
import {
  BOT_SKILLS,
  availableSkills,
  generalization,
  learnedHeroes,
  policyFor,
  skillLabel,
  type BotSkill,
} from "../lib/botPolicy";
import { MATCHES } from "../lib/dashboardData";
import { botRows } from "../lib/groups";
import { heroName } from "../lib/heroes";
import { loadJustPlayed } from "../lib/justPlayed";
import { currentMatchup, saveChosen, type Matchup } from "../lib/matchup";
import { isMockMode } from "../mock/types";

interface Measured {
  skill: BotSkill;
  state: "waiting" | "running" | "done" | "error";
  rate?: number;
  ci?: [number, number];
  games?: number;
  bots?: string;
  error?: string;
}

const seconds = (s?: number) =>
  s === undefined ? "—" : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`;

/** The same matchup measured with each bot type, side by side with intervals. */
function Comparison() {
  const mock = isMockMode();
  const skills = availableSkills();
  const [matchup, setMatchup] = useState<Matchup>(() => currentMatchup(loadJustPlayed(), null));
  const [rows, setRows] = useState<Measured[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const patch = (skill: BotSkill, next: Partial<Measured>) =>
    setRows((all) => all.map((r) => (r.skill === skill ? { ...r, ...next } : r)));

  const run = async () => {
    setBusy(true);
    setRows(skills.map((skill) => ({ skill, state: "waiting" })));
    const controller = new AbortController();
    abort.current = controller;
    const [a, b] = [...matchup].sort();
    for (const skill of skills) {
      patch(skill, { state: "running" });
      try {
        const result = await runPlaytest(MATCHES, controller.signal, undefined, matchup, false, policyFor(skill));
        const row = botRows(result.baseline.rows).find((r) => r.dimension === `${a} vs ${b}`);
        if (!row) throw new ApiError("The run had no row for this matchup.", "shape");
        const s = rowStats(row);
        // the row's rate is for the hero named first in the dimension (ids sorted), so say whose it is below
        const bots = result.baseline.botPolicyVersion;
        patch(skill, { state: "done", rate: s.rate, ci: [s.lo, s.hi], games: row.games, bots });
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
        patch(skill, { state: "error", error: e instanceof ApiError ? e.message : "Something went wrong." });
      }
    }
    setBusy(false);
  };
  const first = [...matchup].sort()[0];

  return (
    <section className="panel" aria-labelledby="compare-title">
      <div className="panel-head">
        <span id="compare-title" className="eyebrow">
          Same matchup, different bots
        </span>
      </div>
      <div className="balance-bar">
        <MatchupPicker
          value={matchup}
          onChange={(m) => {
            saveChosen(m);
            setMatchup(m);
          }}
          disabled={busy}
        />
        <button className="btn primary" aria-disabled={busy || mock} onClick={() => !busy && !mock && run()}>
          {busy ? "Measuring…" : "Compare bot skill"}
        </button>
      </div>
      {mock && <p className="caption">Sample data: this needs the live server.</p>}
      {skills.length === 1 && (
        <p className="caption">Only the scripted bot exists so far; trained bots appear here once trained.</p>
      )}
      <p className="caption">Win rate of {heroName(first)} against {heroName([...matchup].sort()[1])}, 95% interval.</p>
      <ul className="rate-rows">
        {(rows.length ? rows : skills.map((skill): Measured => ({ skill, state: "waiting" }))).map((r) => (
          <li key={r.skill} className="skill-row">
            {r.state === "done" && r.rate !== undefined && r.ci && r.games !== undefined ? (
              <ul className="rate-rows">
                <RateRow label={skillLabel(r.skill)} rate={{ rate: r.rate, ci95: r.ci, games: r.games }} strong />
              </ul>
            ) : (
              <p className="small">
                <strong>{skillLabel(r.skill)}</strong>{" "}
                {r.state === "running" ? "measuring…" : r.state === "error" ? r.error : "not measured yet"}
              </p>
            )}
            {r.bots && <p className="caption">{r.bots} · {r.games} games</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const VERDICT_TEXT = {
  better: { cls: "status ok", text: "Generalizes: better than its starting parameters" },
  worse: { cls: "status warn", text: "Generalizes worse than its starting parameters" },
  same: { cls: "badge", text: "No clear difference from its starting parameters" },
} as const;

/** The result on an opponent training never saw. Shown as it is, including when it is worse than the start. */
function HeldOutBlock({ h, hero, trainedAgainst }: { h: HeldOut; hero: string; trainedAgainst?: string[] }) {
  const g = generalization(h);
  return (
    <div className="held-out">
      <p className="caption">
        Held out: {heroName(hero)} against {heroName(h.opponent)}, never trained against
        {trainedAgainst?.length ? ` (it trained against ${trainedAgainst.map(heroName).join(", ")})` : ""}
      </p>
      <ul className="rate-rows">
        <RateRow label="Learned" rate={h.learned} strong />
        {h.defaults && <RateRow label="Start" rate={h.defaults} />}
        {h.scripted && <RateRow label="Scripted" rate={h.scripted} />}
      </ul>
      {g && (
        <p className={`small ${VERDICT_TEXT[g].cls}`}>
          {g !== "same" && <span className="dot" />}
          {VERDICT_TEXT[g].text}
        </p>
      )}
    </div>
  );
}

/** Each trained hero: its fitness curve, how long it trained and on what. */
function TrainingPanel() {
  const heroes = learnedHeroes();
  return (
    <section className="panel" aria-labelledby="training-title">
      <div className="panel-head">
        <span id="training-title" className="eyebrow">
          Training
        </span>
        <span className="badge recorded">recorded</span>
      </div>
      {heroes.length > 0 && (
        <p className="caption">
          Each bot trained against the other heroes in turn. A hero left out of training is tested on seeds it never
          saw; that held-out line is the honest one.
        </p>
      )}
      {heroes.length === 0 && (
        <p className="small text-2">No trained bots yet. The trainer writes one file per hero; they show up here.</p>
      )}
      <div className="training-grid">
        {heroes.map((h) => (
          <article key={h.hero} className="profile-card">
            <header className="profile-head">
              <HeroPortrait hero={h.hero} size={28} />
              <span className="small profile-name">{heroName(h.hero)}</span>
              <span className="badge">{h.policy}</span>
            </header>
            <FitnessCurve points={h.curve} label={heroName(h.hero)} />
            <p className="caption">
              {h.generations !== undefined && `${h.generations} generations · `}trained in {seconds(h.trainingSeconds)}
            </p>
            {h.seeds && <p className="caption">{h.seeds}</p>}
            {h.dataHash && <p className="caption">data {h.dataHash.slice(0, 7)}</p>}
            {h.heldOut && <HeldOutBlock h={h.heldOut} hero={h.hero} trainedAgainst={h.trainedAgainst} />}
          </article>
        ))}
      </div>
    </section>
  );
}

export function Skill() {
  useManifest();
  const offered = BOT_SKILLS.filter((s) => availableSkills().includes(s.id));
  return (
    <FitStage>
      <div className="screen">
        <TopBar>
          <a className="link-back" href="#/dashboard">
            ← Dashboard
          </a>
          <span className="eyebrow" style={{ color: "var(--game-arena)" }}>
            HERO ARENA
          </span>
          <span className="small text-2">Bot skill: {offered.map((s) => s.label).join(" · ")}</span>
        </TopBar>
        <main className="versions-grid">
          <Comparison />
          <TrainingPanel />
        </main>
      </div>
    </FitStage>
  );
}
