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
/** Portraits drawn this small or smaller use the 128 px thumbnail. */
export const THUMB_MAX_PX = 64;

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

let webpOk: boolean | undefined;
const canDecodeWebp = () =>
  (webpOk ??= document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp"));

/** The .webp twin of a .png when the manifest lists it and the browser can decode WebP; otherwise the PNG itself. */
export function preferWebp(pngPath: string): string {
  const webp = pngPath.replace(/\.png$/, ".webp");
  return webp !== pngPath && canDecodeWebp() && findAsset(webp) ? webp : pngPath;
}

export const heroThumbPath = (hero: string) => `assets/common/heroes/${hero}/portrait_128.png`;
export const heroPortraitPath = (hero: string) => `assets/common/heroes/${hero}/portrait.png`;
/** Optional still poses: attack.png, hit.png, ko.png next to full_body.png; used only if the manifest lists them. */
export const heroPosePath = (hero: string, pose: string) => `assets/common/heroes/${hero}/${pose}.png`;
export const heroFullBodyPath = (hero: string) => `assets/common/heroes/${hero}/full_body.png`;

/** 'loading' until the manifest arrives, 'failed' if it can't be fetched. */
export function useManifestState(): "loading" | "ready" | "failed" {
  const [state, setState] = useState<"loading" | "ready" | "failed">(manifest ? "ready" : "loading");
  useEffect(() => {
    let alive = true;
    loadManifest().then((x) => alive && setState(x ? "ready" : "failed"));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

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
