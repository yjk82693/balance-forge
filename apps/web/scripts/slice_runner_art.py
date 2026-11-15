#!/usr/bin/env python3
"""Turn the Chairman's GPT images of Sepia Tentacle Run into the pieces the game loads.

    python3 apps/web/scripts/slice_runner_art.py [--src DIR] [--out DIR]

--src is apps/web/public/assets/sepia_tentacle_run/runner/src (the originals, copied there from ~/Downloads, never edited).
Two sets exist: setA_* (GPT names, RGB with a PAINTED checkerboard, off-spec sizes) and setB_* (our names, RGBA). Per piece
the cleaner one is used: run frames and the three backgrounds from B, the action poses, hook structures, tiles and
buttons from A (B's action cells are cut at the cell borders, its hook alpha is dithered, its tile cells straddle).
For set A:
  * the near-white neutral checker is keyed out to real alpha (a global key plus a two-step halo clean-up; the dark
    outlines of the art protect the figure),
  * pieces are found by connected components (not a fixed grid) and assigned to their cell by position,
  * the character frames share ONE scale, the feet on one baseline (472 of 512), centred on their centre of mass;
    the hanging pose hangs from the top edge,
  * the hook structures are trimmed and their ring centre is measured (meta.json),
  * the three backgrounds are scaled to 1024 high and mirrored into a seamless double-width tile,
  * tiles and the four buttons come from the atlas image (only source), cropped by component, label text left out.
Pure Pillow, no other dependency. Prints what it found.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

CELL, FEET_Y, BODY_TARGET = 512, 472, 400


# ---- keying the painted checkerboard ------------------------------------------------------------------------------
def clean_alpha(img: Image.Image) -> Image.Image:
    """An RGBA image (set B): its own alpha, with the dithered faint pixels dropped."""
    out = img.convert("RGBA")
    out.putalpha(out.getchannel("A").point(lambda v: 0 if v < 70 else v))
    return out


def key_alpha(img: Image.Image) -> Image.Image:
    rgb = img.convert("RGB")
    r, g, b = rgb.split()
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    spread = ImageChops.subtract(mx, mn)
    def both(a, c):
        return ImageChops.multiply(a, c)
    bg = both(mn.point(lambda v: 255 if v >= 243 else 0), spread.point(lambda v: 255 if v <= 8 else 0))
    soft = both(mn.point(lambda v: 255 if v >= 220 else 0), spread.point(lambda v: 255 if v <= 16 else 0))
    for _ in range(2):  # the halo: lighter neutral pixels that touch the background go too
        bg = ImageChops.lighter(bg, both(soft, bg.filter(ImageFilter.MaxFilter(3))))
    alpha = ImageChops.invert(bg).filter(ImageFilter.GaussianBlur(0.6))
    alpha = alpha.point(lambda v: 0 if v < 40 else 255 if v > 215 else v)
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


# ---- connected components on a reduced mask --------------------------------------------------------------------------
def components(img: Image.Image, step=4, grow=6, min_area=400):
    """Boxes (x0,y0,x1,y1 in full-res pixels) and the mask of each piece of the image's alpha, joined within `grow` px."""
    a = img.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    small = a.resize((a.width // step, a.height // step), Image.BOX).point(lambda v: 255 if v > 20 else 0)
    k = max(3, (grow // step) * 2 + 1)
    small = small.filter(ImageFilter.MaxFilter(k))
    w, h = small.size
    px = small.load()
    seen = [[False] * w for _ in range(h)]
    found = []
    for y in range(h):
        for x in range(w):
            if px[x, y] and not seen[y][x]:
                stack, cells = [(x, y)], []
                seen[y][x] = True
                while stack:
                    cx, cy = stack.pop()
                    cells.append((cx, cy))
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not seen[ny][nx]:
                                seen[ny][nx] = True
                                stack.append((nx, ny))
                if len(cells) * step * step >= min_area:
                    xs = [c[0] for c in cells]
                    ys = [c[1] for c in cells]
                    found.append(((min(xs) * step, min(ys) * step, (max(xs) + 1) * step, (max(ys) + 1) * step), cells))
    return found


def piece(img: Image.Image, box, cells, step=4, grow=6) -> Image.Image:
    """The part of `img` inside `box`, with every pixel outside this component's mask made transparent."""
    mask = Image.new("L", (img.width // step, img.height // step), 0)
    mp = mask.load()
    for cx, cy in cells:
        mp[cx, cy] = 255
    mask = mask.resize(img.size, Image.NEAREST).filter(ImageFilter.MaxFilter(grow | 1))
    crop = img.crop(box)
    m = mask.crop(box)
    a = ImageChops.multiply(crop.getchannel("A"), m)
    crop.putalpha(a)
    return crop


def split_row(img: Image.Image, n: int, name: str, notes: list):
    """The n figures of a one-row sheet, left to right: components grouped into n equal-width bins by their centre."""
    found = components(img)
    bins = [[] for _ in range(n)]
    for box, cells in found:
        i = min(n - 1, int(((box[0] + box[2]) / 2) / (img.width / n)))
        bins[i].append((box, cells))
    out = []
    for i, group in enumerate(bins):
        if not group:
            notes.append(f"{name}: nothing found in cell {i + 1}")
            out.append(None)
            continue
        x0 = min(b[0][0] for b in group)
        y0 = min(b[0][1] for b in group)
        x1 = max(b[0][2] for b in group)
        y1 = max(b[0][3] for b in group)
        merged = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        for box, cells in group:
            part = piece(img, box, cells)
            merged.alpha_composite(part, (box[0] - x0, box[1] - y0))
        out.append(merged)
    return out


def centroid_x(im: Image.Image) -> float:
    a = im.getchannel("A").resize((im.width // 4 or 1, im.height // 4 or 1), Image.BOX)
    px, total, acc = a.load(), 0, 0.0
    for y in range(a.height):
        for x in range(a.width):
            v = px[x, y]
            total += v
            acc += v * (x + 0.5)
    return (acc / total) * 4 if total else im.width / 2


def place(sprite: Image.Image, scale: float, baseline: str) -> Image.Image:
    """A 512 cell: the sprite scaled, centred on its centre of mass, feet on the baseline (or hanging from the top edge)."""
    sc = sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.LANCZOS)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    x = round(CELL / 2 - centroid_x(sc))
    y = FEET_Y - sc.height if baseline == "feet" else 0
    cell.alpha_composite(sc, (x, y)) if x >= 0 and y >= 0 else cell.paste(sc, (x, y), sc)
    return cell


def trim(im: Image.Image) -> Image.Image:
    box = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    return im.crop(box) if box else im


# ---- the sources --------------------------------------------------------------------------------------------------
def ring_centre(im: Image.Image):
    """Centre of the teal hook ring: the biggest bright-teal blob."""
    px = im.convert("RGBA").load()
    pts = [(x, y) for y in range(0, im.height, 2) for x in range(0, im.width, 2)
           if px[x, y][3] > 200 and px[x, y][0] < 120 and px[x, y][1] > 185 and px[x, y][2] > 165]
    if not pts:
        return None
    # the blob around the topmost-or-rightmost teal point: take the densest 90 px neighbourhood
    best, best_n = pts[0], 0
    for p in pts[:: max(1, len(pts) // 400)]:
        n = sum(1 for q in pts if abs(q[0] - p[0]) < 45 and abs(q[1] - p[1]) < 45)
        if n > best_n:
            best, best_n = p, n
    near = [q for q in pts if abs(q[0] - best[0]) < 60 and abs(q[1] - best[1]) < 60]
    return sum(q[0] for q in near) / len(near), sum(q[1] for q in near) / len(near)


def mirror_tile(im: Image.Image) -> Image.Image:
    """Width doubled with a mirrored copy, so the left and right edges always meet."""
    out = Image.new("RGBA", (im.width * 2, im.height), (0, 0, 0, 0))
    out.paste(im, (0, 0))
    out.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (im.width, 0))
    return out


def main():
    root = Path(__file__).resolve().parents[1] / "public/assets/sepia_tentacle_run/runner"
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(root / "src"))
    ap.add_argument("--out", default=str(root))
    a = ap.parse_args()
    src, out = Path(a.src), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    notes, written, meta = [], [], {"canvas": CELL, "feetY": FEET_Y}

    def need(name):
        p = src / name
        if not p.exists():
            notes.append(f"{name}: not found, skipped")
        return p if p.exists() else None

    # characters: B's run frames, A's action poses; each set has its own scale so the body is 400 high in both
    run_p, act_p, runA_p = need("setB_sepia_run_sheet.png"), need("setA_actions.png"), need("setA_run_cycle.png")
    run = split_row(clean_alpha(Image.open(run_p)), 6, "setB run", notes) if run_p else []
    heights = [r.height for r in run if r]
    scale = BODY_TARGET / max(heights) if heights else 1.0
    meta["bodyHeight"] = round(max(heights) * scale) if heights else BODY_TARGET
    meta["sourceScale"] = round(scale, 4)
    for i, r in enumerate(run):
        if r:
            place(r, scale, "feet").save(out / f"sepia_run_{i + 1}.png")
            written.append(f"sepia_run_{i + 1}")
    if act_p and runA_p:
        runA = split_row(key_alpha(Image.open(runA_p)), 6, "setA run", notes)
        scaleA = BODY_TARGET / max(r.height for r in runA if r)
        acts = split_row(key_alpha(Image.open(act_p)), 6, "setA actions", notes)
        names = ["sepia_jump_up", "sepia_jump_fall", "sepia_slide", "sepia_hook_throw", "sepia_swing", "sepia_down"]
        for n, im in zip(names, acts):
            if im:
                place(im, scaleA, "top" if n == "sepia_swing" else "feet").save(out / f"{n}.png")
                written.append(n)

    # hook structures: trimmed, the ring centre measured
    hp = need("setA_hooks.png")
    if hp:
        hooks = split_row(key_alpha(Image.open(hp)), 3, "hooks", notes)
        meta["hooks"] = {}
        for i, h in enumerate(hooks):
            if not h:
                continue
            h = trim(h)
            if h.height > 1024:
                h = h.resize((round(h.width * 1024 / h.height), 1024), Image.LANCZOS)
            name = f"hook_building_{i + 1}"
            rc = ring_centre(h)
            if rc is None:
                notes.append(f"{name}: no teal ring found, using the top centre")
                rc = (h.width / 2, h.height * 0.08)
            h.save(out / f"{name}.png")
            meta["hooks"][name] = {"w": h.width, "h": h.height, "ringX": round(rc[0]), "ringY": round(rc[1])}
            written.append(name)

    # backgrounds (set B, exact size and real alpha): far opaque, mid, near; 1024 high, mirrored to tile
    for src_name, name, keyed in [("setB_bg_far.png", "bg_far", False), ("setB_bg_mid.png", "bg_mid", False),
                                  ("setB_bg_near.png", "bg_near", False)]:
        p = need(src_name)
        if not p:
            continue
        im = Image.open(p)
        im = key_alpha(im) if keyed else clean_alpha(im)
        im = im.resize((round(im.width * 1024 / im.height), 1024), Image.LANCZOS)
        mirror_tile(im).save(out / f"{name}.png")
        written.append(name)

    # tiles and buttons: only in the atlas (its lower right block), found by component, label text dropped
    ap_ = need("setA_atlas.png")
    if ap_:
        atlas = key_alpha(Image.open(ap_))
        block = atlas.crop((930, 420, atlas.width, atlas.height))
        found = [(b, c) for b, c in components(block, grow=4, min_area=6000)]
        top = sorted([f for f in found if (f[0][1] + f[0][3]) / 2 < 140], key=lambda f: f[0][0])
        bottom = sorted([f for f in found if (f[0][1] + f[0][3]) / 2 >= 140], key=lambda f: f[0][0])
        meta["tiles"] = {}
        for names_, group in [(["ground_tile", "pit_edge", "low_bar", "wall"], top),
                              (["btn_jump", "btn_jump_pressed", "btn_slide", "btn_slide_pressed"], bottom)]:
            if len(group) != 4:
                notes.append(f"atlas: found {len(group)} pieces in a row of 4: {[g[0] for g in group]}")
            for n, (box, cells) in zip(names_, group):
                im = trim(piece(block, box, cells, grow=4))
                if n == "ground_tile":  # the keyed edge columns are faint: crop them so repeats leave no seam
                    im = im.crop((3, 0, im.width - 3, im.height))
                im.save(out / f"{n}.png")
                meta["tiles"][n] = {"w": im.width, "h": im.height}
                written.append(n)
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {len(written)} pieces to {out}")
    print("meta:", json.dumps(meta))
    for n in notes:
        print("note:", n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
