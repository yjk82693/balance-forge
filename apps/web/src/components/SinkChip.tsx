import { sinkName, useSinks } from "../lib/sinks";

/** "Stored in MongoDB Atlas · Tiger Data" when the server writes to them; nothing when it does not. */
export function SinkChip() {
  const sinks = useSinks();
  if (!sinks || sinks.enabled.length === 0) return null;
  const failed = sinks.enabled.filter((id) => sinks.status[id]?.failed > 0);
  const detail = sinks.enabled.map((id) => {
    const s = sinks.status[id];
    return `${sinkName(id)}: ${s.written} written, ${s.failed} failed`;
  });
  return (
    <span className={`badge sink-chip${failed.length ? " warn" : ""}`} title={detail.join("\n")}>
      Stored in {sinks.enabled.map(sinkName).join(" · ")}
      {failed.length > 0 && ` (${failed.map(sinkName).join(", ")}: some writes failed)`}
    </span>
  );
}
