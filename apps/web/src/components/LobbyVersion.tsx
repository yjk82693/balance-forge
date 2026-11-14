import { useEffect, useRef, useState } from "react";
import { fetchVersions, sampleVersions } from "../lib/versions";
import { isMockMode } from "../mock/types";
import { setDemoVersion } from "../lib/demo";
import {
  patchedVersion,
  rootVersion,
  selectRoomVersion,
  versionLine,
  type RoomMode,
  type RoomVersion,
  type RoomVersionList,
  type Sender,
} from "../lib/roomVersion";

interface Props {
  transport: Sender | null;
  gameId: string;
  /** the room is connected and has sent its status, so a select will be heard */
  ready: boolean;
  /** a version chosen on the Versions screen (?hash=): the room already has it */
  fixed?: boolean;
}

/**
 * Broken | Patched for the room: "Broken" plays the root version, "Patched" the newest accepted one, and the choice
 * is sent to the room as game.select. Names the version next to the toggle, or says why Patched is not there.
 */
export function LobbyVersion({ transport, gameId, ready, fixed = false }: Props) {
  const [list, setList] = useState<RoomVersionList | null>(null);
  const [mode, setMode] = useState<RoomMode>("broken");
  const [chosen, setChosen] = useState<RoomVersion | null>(null);
  const [failed, setFailed] = useState(false);
  const synced = useRef(false);

  useEffect(() => {
    if (isMockMode()) return setList(sampleVersions());
    const controller = new AbortController();
    fetchVersions(controller.signal, gameId)
      .then((l) => (l ? setList(l) : setFailed(true)))
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, [gameId]);

  // The toggle starts on Broken, so the room is put on the root version once, as soon as both are there.
  useEffect(() => {
    if (synced.current || fixed || !list || !ready || !transport) return;
    synced.current = true;
    setChosen(selectRoomVersion(transport, gameId, list, "broken"));
  }, [list, ready, transport, gameId, fixed]);

  const patched = list ? patchedVersion(list) : null;
  const hint = failed
    ? "Couldn't read the versions from the server."
    : !list
      ? "Reading the versions…"
      : "No accepted version yet: run the balance check first.";
  const pick = (next: RoomMode) => {
    if (!transport || !list || !ready || (next === "patched" && !patched)) return;
    const version = selectRoomVersion(transport, gameId, list, next);
    if (!version) return;
    setMode(next);
    setChosen(version);
    setDemoVersion(next);
  };
  const shown = chosen ?? (mode === "patched" ? patched : list ? rootVersion(list) : null);
  return (
    <div className="lobby-version">
      <div className="seg" role="radiogroup" aria-label="Game data for this room">
        {(["broken", "patched"] as const).map((m) => {
          const off = m === "patched" && !patched;
          return (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              aria-disabled={off || !ready}
              title={off ? hint : undefined}
              className={`seg-btn${mode === m ? " on" : ""}`}
              onClick={() => pick(m)}
            >
              {m === "broken" ? "Broken" : "Patched"}
            </button>
          );
        })}
      </div>
      {!fixed && shown && !(mode === "broken" && !chosen) && (
        <span className="caption lobby-version-line">{versionLine(shown)}</span>
      )}
      {!patched && list && <span className="caption lobby-version-line">{hint}</span>}
    </div>
  );
}
