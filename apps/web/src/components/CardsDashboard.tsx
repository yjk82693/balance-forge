import { useMemo, useState, type ReactNode } from "react";
import { DEFAULT_DECKS, loadDecks, saveDecks, type DeckPair } from "../lib/dashGame";
import { headlineFor, pickTargetDimension } from "../lib/dashboardData";
import { botRows } from "../lib/groups";
import { heroName } from "../lib/heroes";
import { buildFacts } from "../lib/resultCard";
import { useDemoVersion } from "../lib/demo";
import { useManifest } from "../lib/assets";
import { useRunner } from "../lib/useRunner";
import { isMockMode } from "../mock/types";
import { CardTable, LeverList } from "./CardsPanels";
import { Collapsible } from "./Collapsible";
import { DeckPicker } from "./DeckPicker";
import { EmptyResult } from "./EmptyResult";
import { FitStage } from "./FitStage";
import { GameSwitch } from "./GameSwitch";
import { HeadlineStrip } from "./HeadlineStrip";
import { CopyButton, HoldoutColumn, PatchColumn, TargetRows } from "./ResultCard";
import { ResultSkeleton } from "./ResultSkeleton";
import { RunMenu } from "./RunMenu";
import { SinkChip } from "./SinkChip";
import { TopBar } from "./TopBar";
import { VersionToggle } from "./VersionToggle";
import { CHART_FOOT, WinRateChart, rowStats } from "./WinRateChart";

const none = (text: string) => <p className="text-2">{text}</p>;

interface Props {
  theme: "dark" | "light";
  onTheme: () => void;
}

/** The Hero Cards dashboard: the same headline strip as the arena, then the card table, levers, patch and targets. */
export function CardsDashboard({ theme, onTheme }: Props) {
  useManifest();
  const mock = isMockMode();
  const version = useDemoVersion();
  const { run, busy, live, error, notice, elapsed, start } = useRunner("hero_cards");
  const [decks, setDecks] = useState<DeckPair>(loadDecks);
  const choose = (m: DeckPair) => {
    saveDecks(m);
    setDecks(m);
  };
  const go = () => void start(decks, false, undefined);
  const facts = useMemo(() => (run ? buildFacts(run, null) : null), [run]);
  const canPatch = !!run?.patched;
  const report = run ? (canPatch && version === "patched" ? run.patched! : run.baseline) : null;
  const stats = report ? botRows(report.rows).map(rowStats) : [];
  const shown = stats.find((s) => s.row.dimension === pickTargetDimension(stats));
  const diagnosis = run?.cardDiagnosis;
  const measured: DeckPair | null = shown && shown.matchup.b ? [shown.matchup.a, shown.matchup.b] : null;
  const stale =
    !mock && measured && [...measured].sort().join() !== [...decks].sort().join()
      ? `Showing the last run (${heroName(measured[0])} vs ${heroName(measured[1])}). Run again for the new pick.`
      : null;
  const detail = facts?.sourceDetail ? ` · ${facts.sourceDetail}` : "";
  const source = facts ? `${facts.source}${detail}` : mock ? "sample data" : "";
  const status: ReactNode = (
    <>
      {source && (
        <span className={`badge status-chip${facts?.source === "live run" ? " live" : " recorded"}`}>{source}</span>
      )}
      {stale && <span className="badge status-chip stale">{stale}</span>}
    </>
  );
  const targets = facts?.verdict?.targets ?? [];
  const patchBody = (
    <div className="d2-patch">
      <div className="d2-cols">
        {facts && !facts.fair ? (
          <PatchColumn patch={facts.patch} fallbackNote={facts.fallbackNote} />
        ) : (
          none("No patch for this run.")
        )}
        {facts && !facts.fair && <HoldoutColumn holdout={facts.holdout} verdict={facts.verdict} />}
      </div>
      <div className="d2-toggle">
        <VersionToggle disabled={!canPatch} hint="This run has no patched data to switch to." />
      </div>
    </div>
  );
  const sections: { id: string; title: string; note?: string; body: ReactNode; open?: boolean }[] = [
    {
      id: "cards",
      title: "Card table",
      note: diagnosis?.cards.length ? `${diagnosis.cards.length} cards` : undefined,
      body: diagnosis ? <CardTable diagnosis={diagnosis} /> : none("No card table in this run."),
      open: true,
    },
    {
      id: "levers",
      title: "Levers",
      note: diagnosis?.levers.length ? `${diagnosis.significantLevers} significant` : undefined,
      body: diagnosis ? <LeverList diagnosis={diagnosis} /> : none("No card levers in this run."),
    },
    {
      id: "patch",
      title: "Patch",
      note: facts?.patch.length ? `${facts.patch.length} change${facts.patch.length > 1 ? "s" : ""}` : undefined,
      body: patchBody,
      open: true,
    },
    {
      id: "targets",
      title: "Targets",
      note: targets.length ? String(targets.length) : undefined,
      body: targets.length ? <TargetRows targets={targets} /> : none("This verdict has no per-target rows."),
    },
  ];
  return (
    <FitStage>
      <div className="screen dash2 dash-cards">
        <TopBar>
          <GameSwitch disabled={busy} />
          <span className="spacer" />
          <DeckPicker value={mock ? (measured ?? DEFAULT_DECKS) : decks} onChange={choose} disabled={busy || mock} />
          <SinkChip />
          <RunMenu>
            <button className="btn secondary" onClick={onTheme}>
              {theme === "dark" ? "Light theme" : "Dark theme"}
            </button>
            <a className="btn secondary" href="#/versions">
              Versions
            </a>
            <a className="btn secondary" href="#/present">
              Present
            </a>
          </RunMenu>
          <button className="btn primary" onClick={go} aria-busy={busy} aria-disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "Bots are playing…" : "Let the bots play"}
          </button>
        </TopBar>
        <HeadlineStrip
          shown={shown}
          headline={shown ? headlineFor(shown) : ""}
          facts={facts}
          busy={busy}
          live={live}
          elapsed={elapsed}
          cards
          status={status}
          actions={facts ? <CopyButton facts={facts} /> : null}
          empty={
            <>
              <p className="strip-mid">Pick two decks above.</p>
              <p>The win rate, what was intended and the verdict appear here.</p>
            </>
          }
        />
        {!busy && notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
          </div>
        )}
        {!busy && error && (
          <div className="err" role="alert">
            <p>{error}</p>
            <button className="btn secondary" onClick={go}>
              Try again
            </button>
          </div>
        )}
        <main className="d2-main d2-split">
          <div className="d2-left">
            {busy ? (
              <ResultSkeleton live={live} elapsed={elapsed} cards />
            ) : !run ? (
              <EmptyResult onRun={go} />
            ) : (
              sections.map((sec) => (
                <Collapsible key={sec.id} title={sec.title} note={sec.note} defaultOpen={sec.open}>
                  {sec.body}
                </Collapsible>
              ))
            )}
          </div>
          <aside className="d2-right panel" aria-label="Deck matchup">
            <p className="eyebrow">Deck matchup</p>
            {report && report.rows.length > 0 ? (
              <WinRateChart rows={botRows(report.rows)} dense foot={false} />
            ) : (
              none("The deck matchup appears here once the bots have played.")
            )}
            <p className="caption viz-foot">{CHART_FOOT}</p>
          </aside>
        </main>
      </div>
    </FitStage>
  );
}
