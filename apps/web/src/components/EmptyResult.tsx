interface Props {
  onRun: () => void;
}

/** The whole result area before there is a run: one calm line and the Run button, none of the per-section empties. */
export function EmptyResult({ onRun }: Props) {
  return (
    <section className="panel empty-result" aria-label="No result yet">
      <p className="h3">Run the bots to see the verdict</p>
      <button className="btn primary" onClick={onRun}>
        Let the bots play
      </button>
    </section>
  );
}
