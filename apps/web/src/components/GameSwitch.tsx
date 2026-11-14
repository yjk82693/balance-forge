import { GAME_LABEL, setGame, useDashGame, type DashGame } from "../lib/dashGame";

const GAMES: DashGame[] = ["hero_arena", "hero_cards"];

/** Hero Arena | Hero Cards: the one genre switch of the dashboard's top bar. */
export function GameSwitch({ disabled = false }: { disabled?: boolean }) {
  const game = useDashGame();
  return (
    <div className="seg game-switch" role="radiogroup" aria-label="Game">
      {GAMES.map((g) => (
        <button
          key={g}
          role="radio"
          aria-checked={game === g}
          aria-disabled={disabled}
          className={`seg-btn${game === g ? " on" : ""}`}
          onClick={() => !disabled && setGame(g)}
        >
          {GAME_LABEL[g]}
        </button>
      ))}
    </div>
  );
}
