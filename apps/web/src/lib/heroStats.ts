import { useEffect, useState } from "react";
import { isMockMode } from "../mock/types";

/**
 * The hero stats the web needs to describe a `/characters/N/<stat>` change, read from the server so nothing is copied
 * and nothing goes stale when a patch is applied: the hero ids by position N (from the current data), and the base
 * values (from the root version of the data) that the ±40% range is measured against.
 */
export interface HeroStats {
  /** hero id at position N, from `data.characters[N].id` */
  heroes: string[];
  /** health and speed of the root version, at the same positions */
  base: { health: number; speed: number }[];
}

let loaded: HeroStats | null = null;

/** The stats read so far, or null before they arrive (or when there is no server to ask). */
export const getHeroStats = () => loaded;

interface Character {
  id: string;
  health: number;
  speed: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** `GET /v1/data/hero_arena[?dataHash=]` answers { data: { characters: [...] }, dataHash }. */
async function fetchCharacters(hash: string | undefined, signal?: AbortSignal): Promise<Character[] | null> {
  const res = await fetch(`/v1/data/hero_arena${hash ? `?dataHash=${encodeURIComponent(hash)}` : ""}`, { signal });
  if (!res.ok) return null;
  const body: unknown = await res.json();
  const list = isObject(body) && isObject(body.data) ? body.data.characters : null;
  if (!Array.isArray(list)) return null;
  const out = list.filter(
    (c): c is Character =>
      isObject(c) && typeof c.id === "string" && Number.isFinite(c.health) && Number.isFinite(c.speed),
  );
  return out.length === list.length ? out : null;
}

/** The hash of the root version (the record with no parent) in the versions list, if the server has a history. */
async function fetchRootHash(signal?: AbortSignal): Promise<string | undefined> {
  const res = await fetch("/v1/versions/hero_arena", { signal });
  if (!res.ok) return undefined;
  const body: unknown = await res.json();
  const list = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.versions) ? body.versions : [];
  const root = list.find((v) => isObject(v) && (v.parentHash === null || v.parentHash === undefined));
  return isObject(root) && typeof root.dataHash === "string" ? root.dataHash : undefined;
}

export async function loadHeroStats(signal?: AbortSignal): Promise<HeroStats | null> {
  try {
    const current = await fetchCharacters(undefined, signal);
    if (!current) return null;
    const rootHash = await fetchRootHash(signal).catch(() => undefined);
    const root = rootHash ? await fetchCharacters(rootHash, signal).catch(() => null) : null;
    const base = root && root.length === current.length ? root : current; // no history: the current data is the base
    return { heroes: current.map((c) => c.id), base: base.map((c) => ({ health: c.health, speed: c.speed })) };
  } catch {
    return null;
  }
}

/** Reads the hero stats once when a screen mounts (not in `?mock=1`) and re-renders it when they arrive. */
export function useHeroStats(): HeroStats | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (isMockMode()) return;
    const controller = new AbortController();
    loadHeroStats(controller.signal).then((s) => {
      if (s && !controller.signal.aborted) {
        loaded = s;
        setTick((n) => n + 1);
      }
    });
    return () => controller.abort();
  }, []);
  return loaded;
}
