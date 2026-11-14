// Which data the lobby's room plays on. "Broken" is the root version, "Patched" the newest accepted one; pressing
// either sends game.select to the room, so the match really runs on that data (the old toggle only set a flag).

/** The part of a version record this needs (the full VersionRecord has more). */
export interface RoomVersion {
  dataHash: string;
  parentHash: string | null;
  createdAt: string;
  origin: string;
  changes: { path: string; label?: string; old: number; new: number }[];
  verdict: { verdict: string } | null;
  approved: boolean;
}

export interface RoomVersionList {
  versions: RoomVersion[];
  currentHash?: string;
}

export type RoomMode = "broken" | "patched";

const isRoot = (v: RoomVersion) => v.origin === "base" || v.parentHash === null;
const accepted = (v: RoomVersion) => !isRoot(v) && (v.verdict?.verdict === "accepted" || v.approved);

/** The root version: the one made from the data the game ships with. */
export function rootVersion(list: RoomVersionList): RoomVersion | null {
  const roots = list.versions.filter(isRoot);
  return roots.find((v) => v.origin === "base") ?? roots[0] ?? null;
}

/**
 * The version "Patched" plays: the server's current version when it is not the root, else the newest accepted one.
 * Null when there is none (the toggle then disables "Patched").
 */
export function patchedVersion(list: RoomVersionList): RoomVersion | null {
  const current = list.versions.find((v) => v.dataHash === list.currentHash);
  if (current && !isRoot(current)) return current;
  const newest = [...list.versions].filter(accepted).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return newest[0] ?? null;
}

/** "version 2dec43b · Bari · Health 540 → 480, Real Armor · Health 700 → 750" */
export function versionLine(v: RoomVersion): string {
  const changes = v.changes.map((c) => `${c.label ?? c.path} ${c.old} → ${c.new}`).join(", ");
  return `version ${v.dataHash.slice(0, 7)}${changes ? ` · ${changes}` : ""}`;
}

/** Whatever has send(type, payload): the room transport. */
export interface Sender {
  send(type: string, payload: unknown): void;
}

/**
 * Selects the mode's data in the room: game.select { gameId, dataHash }. Returns the version chosen, or null when the
 * mode has none (nothing is sent).
 */
export function selectRoomVersion(
  transport: Sender,
  gameId: string,
  list: RoomVersionList,
  mode: RoomMode,
): RoomVersion | null {
  const version = mode === "patched" ? patchedVersion(list) : rootVersion(list);
  if (!version) return null;
  transport.send("game.select", { gameId, dataHash: version.dataHash });
  return version;
}
