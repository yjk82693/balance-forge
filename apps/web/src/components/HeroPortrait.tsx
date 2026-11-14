import { heroColorVar, heroName } from "../lib/heroes";
import { THUMB_MAX_PX, heroPortraitPath, heroThumbPath, manifestUrl, useManifest } from "../lib/assets";

interface Props {
  hero: string | undefined;
  size: number;
  ring?: boolean;
  dim?: boolean;
}

/** Portrait PNG masked to a circle with a 2px hero-color ring; initial letter if the manifest lacks it. */
export function HeroPortrait({ hero, size, ring = true, dim }: Props) {
  useManifest();
  // Small portraits use the 128 px thumbnail when the manifest lists it (about a third of the bytes).
  const thumb = hero && size <= THUMB_MAX_PX ? manifestUrl(heroThumbPath(hero)) : undefined;
  const src = thumb ?? (hero ? manifestUrl(heroPortraitPath(hero)) : undefined);
  const style = {
    width: size,
    height: size,
    ["--ring" as string]: ring ? heroColorVar(hero) : "transparent",
    opacity: dim ? 0.3 : 1,
  };
  if (!src) {
    return (
      <span
        className="portrait"
        style={{ ...style, display: "inline-grid", placeItems: "center", fontWeight: 700, fontSize: size * 0.4 }}
        aria-hidden="true"
      >
        {hero ? heroName(hero).charAt(0) : "?"}
      </span>
    );
  }
  return <img className="portrait" src={src} style={style} alt="" width={size} height={size} />;
}
