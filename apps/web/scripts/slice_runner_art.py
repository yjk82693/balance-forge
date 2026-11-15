#!/usr/bin/env python3
"""Cut the seven GPT sheets of Sepia Tentacle Run into the pieces the game loads.

    python3 apps/web/scripts/slice_runner_art.py [--in ~/Downloads] [--out apps/web/public/assets/sepia_tentacle_run/runner]

Input (the names GPT gives them): sepia_run_sheet.png, sepia_actions_sheet.png, bg_far.png, bg_mid.png, bg_near.png,
hooks_sheet.png, tiles_ui_sheet.png. A sheet whose size is off is rescaled to its grid (and said so). The character cells
are NOT trimmed per cell: the feet baseline (40 px above the bottom of each cell) must stay where it is. The script
measures the standing body height from the run frames and writes meta.json for the scene. Missing sheets are skipped.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

CELL = 512
BASELINE_FROM_BOTTOM = 40
GRID = {
    "sepia_run_sheet.png": ((3072, 512), [(f"sepia_run_{n}", n - 1, 0) for n in range(1, 7)], 512),
    "sepia_actions_sheet.png": (
        (3072, 512),
        [(n, i, 0) for i, n in enumerate(["sepia_jump_up", "sepia_jump_fall", "sepia_slide", "sepia_hook_throw", "sepia_swing", "sepia_down"])],
        512,
    ),
    "hooks_sheet.png": ((3072, 1024), [(f"hook_building_{n}", n - 1, 0) for n in range(1, 4)], 1024),
    "tiles_ui_sheet.png": (
        (2048, 1024),
        [
            (n, i % 4, i // 4)
            for i, n in enumerate(
                ["ground_tile", "pit_edge", "low_bar", "wall", "btn_jump", "btn_jump_pressed", "btn_slide", "btn_slide_pressed"]
            )
        ],
        512,
    ),
}
BACKGROUNDS = ["bg_far.png", "bg_mid.png", "bg_near.png"]


def load(path: Path, size, notes):
    img = Image.open(path).convert("RGBA")
    if img.size != size:
        notes.append(f"{path.name}: is {img.size[0]}x{img.size[1]}, rescaled to {size[0]}x{size[1]}")
        img = img.resize(size, Image.LANCZOS)
    return img


def alpha_box(img):
    return img.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()


def seam_difference(img):
    """Mean difference between the left-most and right-most pixel columns (0 = a perfect seam)."""
    l, r = img.crop((0, 0, 1, img.height)), img.crop((img.width - 1, 0, img.width, img.height))
    pairs = zip(l.tobytes()[0::4], r.tobytes()[0::4])
    return sum(abs(a - b) for a, b in pairs) / img.height


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default=str(Path.home() / "Downloads"))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "public/assets/sepia_tentacle_run/runner"))
    a = ap.parse_args()
    src, out = Path(a.src).expanduser(), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    notes, written, body = [], [], []
    for sheet, (size, cells, cell) in GRID.items():
        path = src / sheet
        if not path.exists():
            notes.append(f"{sheet}: not found, skipped")
            continue
        img = load(path, size, notes)
        for name, col, row in cells:
            piece = img.crop((col * cell, row * cell, (col + 1) * cell, (row + 1) * cell))
            box = alpha_box(piece)
            if box is None:
                notes.append(f"{name}: the cell is empty")
            elif sheet == "sepia_run_sheet.png":
                body.append(box[3] - box[1])
                feet = box[3]
                if abs(feet - (CELL - BASELINE_FROM_BOTTOM)) > 24:
                    notes.append(f"{name}: feet at y={feet}, expected about {CELL - BASELINE_FROM_BOTTOM}")
            if box and (box[0] <= 1 or box[2] >= cell - 1) and sheet.startswith("sepia"):
                notes.append(f"{name}: touches the cell's side, may be cropped")
            piece.save(out / f"{name}.png")
            written.append(name)
    for name in BACKGROUNDS:
        path = src / name
        if not path.exists():
            notes.append(f"{name}: not found, skipped")
            continue
        img = load(path, (2048, 1024), notes)
        seam = seam_difference(img)
        if seam > 40:
            notes.append(f"{name}: the left and right edges differ (seam {seam:.0f}); it may show a visible join")
        img.save(out / name)
        written.append(name[:-4])
    meta = {"canvas": CELL, "feetY": CELL - BASELINE_FROM_BOTTOM, "bodyHeight": max(body) if body else 400, "ringFromTop": 80}
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {len(written)} pieces to {out}")
    print("meta:", meta)
    for n in notes:
        print("note:", n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
