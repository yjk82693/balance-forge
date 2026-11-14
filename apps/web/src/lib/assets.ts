import { useEffect, useState } from "react";

interface ManifestAsset {
  path: string;
  width: number;
  height: number;
  role: string;
  pivot?: { x: number; y: number; origin: string };
  nine_slice?: { left: number; right: number; top: number; bottom: number };
}

export interface Manifest {
  assets: ManifestAsset[];
}

const base = import.meta.env.BASE_URL;
export const assetUrl = (path: string) => `${base}${path}`;

let manifest: Manifest | null = null;
let pending: Promise<Manifest | null> | null = null;

export function loadManifest(): Promise<Manifest | null> {
  if (manifest) return Promise.resolve(manifest);
  pending ??= fetch(assetUrl("assets/manifest.json"))
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .then((m) => (manifest = m))
    .catch(() => null);
  return pending;
}

export function findAsset(path: string): ManifestAsset | undefined {
  return manifest?.assets.find((a) => a.path === path);
}

/** URL for an asset path, only if the manifest lists it. */
export function manifestUrl(path: string): string | undefined {
  return findAsset(path) ? assetUrl(path) : undefined;
}

export const heroPortraitPath = (hero: string) => `assets/common/heroes/${hero}/portrait.png`;
export const heroFullBodyPath = (hero: string) => `assets/common/heroes/${hero}/full_body.png`;

export function useManifest(): Manifest | null {
  const [m, setM] = useState<Manifest | null>(manifest);
  useEffect(() => {
    let alive = true;
    loadManifest().then((x) => alive && setM(x));
    return () => {
      alive = false;
    };
  }, []);
  return m;
}
