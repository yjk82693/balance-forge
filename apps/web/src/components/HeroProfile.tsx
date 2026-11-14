import type { Classification, Diagnosis, HeroProfileData, OpponentRate, Recommendation, VerdictRate } from "../lib/api";
import { heroName } from "../lib/heroes";
import { pct } from "../lib/stats";
import { HeroPortrait } from "./HeroPortrait";
import { BAND, MIN_GAMES } from "./WinRateChart";
import { describePath } from "./PatchCompare";

/** Which side of the fair band the whole interval sits on, if either (and only with enough games to say). */
function outside(r: VerdictRate): "win" | "lose" | null {
  if (r.games < MIN_GAMES) return null;
  return r.ci95[0] > BAND[1] ? "win" : r.ci95[1] < BAND[0] ? "lose" : null;
}

const nameList = (heroes: string[]) => heroes.map(heroName).join(", ");

/** The hero the classification is about: the strong one, the weak one, or the focus hero for a specific counter. */
export function applicableHero(d: Diagnosis): string | undefined {
  const role = (r: "winner" | "loser") => d.heroes.find((h) => h.strength?.role === r)?.hero;
  const byClass: Record<Classification, string | undefined> = {
    overall_strong: role("winner"),
    overall_weak: role("loser"),
    counter_specific: d.focusHero,
  };
  return (d.classification && byClass[d.classification]) || d.focusHero || d.heroes[0]?.hero;
}

/** One line in plain words, e.g. "Daewi is weak against everyone" or "Bari only beats Real Armor". Null if unknown. */
export function classificationLine(d: Diagnosis): string | null {
  const who = applicableHero(d);
  const profile = d.heroes.find((h) => h.hero === who);
  if (!d.classification || !who || !profile) return null;
  if (d.classification === "overall_strong") return `${heroName(who)} is strong against everyone`;
  if (d.classification === "overall_weak") return `${heroName(who)} is weak against everyone`;
  const wins = profile.opponents.filter((o) => outside(o) === "win").map((o) => o.opponent);
  const loses = profile.opponents.filter((o) => outside(o) === "lose").map((o) => o.opponent);
  if (wins.length && !loses.length) return `${heroName(who)} only beats ${nameList(wins)}`;
  if (loses.length && !wins.length) return `${heroName(who)} only loses to ${nameList(loses)}`;
  return `${heroName(who)} is unbalanced against specific opponents`;
}

/** The hero's headline: how far from even, and against how many opponents it is outside the fair band. */
function headline(p: HeroProfileData): string {
  const name = heroName(p.hero);
  const s = p.strength;
  if (!s) return p.overall ? `${name} wins ${pct(p.overall.rate)}% overall` : name;
  const margin = s.marginPts !== undefined ? Math.round(Math.abs(s.marginPts)) : undefined;
  const k = s.opponentsOutsideBand ?? p.opponents.filter((o) => outside(o) !== null).length;
  const of = p.opponents.length ? ` of ${p.opponents.length}` : "";
  return s.role === "winner"
    ? `${name} is ${margin !== undefined ? `+${margin} pts above even, ` : ""}beats ${k}${of} outside the fair band`
    : `${name} is ${margin !== undefined ? `−${margin} pts, ` : ""}loses ${k}${of}`;
}

const place = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;

/** One row: label, a 0-100% track with the 45-55% band, the interval and the rate. */
function RateRow({ label, rate, strong }: { label: string; rate: VerdictRate; strong?: boolean }) {
  const [lo, hi] = rate.ci95;
  return (
    <li className={`rate-row${strong ? " strong" : ""}`}>
      <span className="small rate-label">{label}</span>
      <span className="rate-track" role="img" aria-label={`${pct(rate.rate)}%, interval ${pct(lo)} to ${pct(hi)}%`}>
        <span className="rate-band" />
        <span className="rate-ci" style={{ left: place(lo), width: `${Math.max(0, hi - lo) * 100}%` }} />
        <span className="rate-dot" style={{ left: place(rate.rate) }} />
      </span>
      <span className="small rate-pct">{pct(rate.rate)}%</span>
    </li>
  );
}

function RecommendationItem({ r, first, used }: { r: Recommendation; first: boolean; used: boolean }) {
  return (
    <li className="reco">
      <p className="small">
        <strong>
          {r.direction === "down" ? "Lower" : "Raise"} {describePath(r.path)} by {Math.round(r.sizePct)}%
        </strong>{" "}
        {first && <span className="badge after">first choice</span>}{" "}
        {used && <span className="badge origin">used by the AI patch</span>}
      </p>
      {r.why && <p className="caption">{r.why}</p>}
      {r.expected && <p className="caption">Expected: {r.expected}</p>}
    </li>
  );
}

function ProfileCard({ p, d, patchPaths }: { p: HeroProfileData; d: Diagnosis; patchPaths: string[] }) {
  const mine = d.recommendations.filter((r) => r.hero === p.hero);
  const isApplicable = applicableHero(d) === p.hero;
  const opponents: OpponentRate[] = [...p.opponents].sort((a, b) => b.rate - a.rate);
  return (
    <article className="profile-card">
      <header className="profile-head">
        <HeroPortrait hero={p.hero} size={28} />
        <span className="small profile-name">{heroName(p.hero)}</span>
        {p.strength && <span className="badge">{p.strength.role}</span>}
        {isApplicable && d.classification && <span className="badge after">the finding is about this hero</span>}
      </header>
      <p className="small">{headline(p)}</p>
      <ul className="rate-rows">
        {p.overall && <RateRow label="Overall" rate={p.overall} strong />}
        {opponents.map((o) => (
          <RateRow key={o.opponent} label={`vs ${heroName(o.opponent)}`} rate={o} />
        ))}
      </ul>
      {mine.length > 0 && (
        <ul className="reco-list" aria-label={`Suggested changes for ${heroName(p.hero)}`}>
          {mine.map((r, i) => (
            <RecommendationItem
              key={`${r.path}-${i}`}
              r={r}
              first={isApplicable && i === 0}
              used={patchPaths.includes(r.path)}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

/** The two heroes side by side (the winner first): how each does against every opponent, and what to change. */
export function HeroProfile({ diagnosis, patchPaths }: { diagnosis: Diagnosis; patchPaths: string[] }) {
  const line = classificationLine(diagnosis);
  const heroes = [...diagnosis.heroes].sort(
    (a, b) => Number(b.strength?.role === "winner") - Number(a.strength?.role === "winner"),
  );
  return (
    <section className="hero-profile" aria-label="Hero profile">
      <p className="caption">Hero profile</p>
      {line && <p className="profile-line">{line}</p>}
      <div className="profile-grid">
        {heroes.map((p) => (
          <ProfileCard key={p.hero} p={p} d={diagnosis} patchPaths={patchPaths} />
        ))}
      </div>
    </section>
  );
}
