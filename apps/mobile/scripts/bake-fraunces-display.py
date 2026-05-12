#!/usr/bin/env python3
"""
Re-bake static Fraunces display cuts for React Native.

RN 0.81 can't drive variable-font axes at runtime, so we ship pre-instanced
static TTFs that match the webapp's hero rendering. The browser's
`font-optical-sizing: auto` engages the display cut (opsz=144) at large
sizes; we approximate that here by baking explicit axis values.

Run:
  python3 apps/mobile/scripts/bake-fraunces-display.py \\
      --src /path/to/Fraunces[SOFT,WONK,opsz,wght].ttf

Produces every entry in BAKES. The source variable TTF lives in
undercasetype/Fraunces on GitHub (fonts/variable/).
"""
from __future__ import annotations

import argparse
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"

# WONK=1 keeps the playful curved alternates on n/h/m that give Fraunces its
# editorial character. The webapp inherits WONK=1 because browsers only drive
# the opsz axis and leave the rest at default.
BAKES = [
    {
        "file": "Fraunces-Display144-450-Wonk.ttf",
        "family": "FrauncesDisplayWonk",
        "axes": {"opsz": 144, "wght": 450, "SOFT": 50, "WONK": 1},
    },
    {
        # Heavier display cut for overlay text (white-on-photo splash) where
        # the 450-weight reads too thin against a busy background.
        "file": "Fraunces-Display144-600-Wonk.ttf",
        "family": "FrauncesDisplayWonkBold",
        "axes": {"opsz": 144, "wght": 600, "SOFT": 50, "WONK": 1},
    },
]


def _set_name(font: TTFont, name_id: int, value: str) -> None:
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID == name_id:
            name.removeNames(nameID=name_id, platformID=rec.platformID, platEncID=rec.platEncID, langID=rec.langID)
    name.setName(value, name_id, 3, 1, 0x409)  # Windows / Unicode / English
    name.setName(value, name_id, 1, 0, 0)      # Mac / Roman / English


def bake(src: Path, file: str, family: str, axes: dict) -> None:
    font = TTFont(str(src))
    instance = instantiateVariableFont(font, axes, inplace=False, optimize=True)
    _set_name(instance, 1, family)                # Family
    _set_name(instance, 2, "Regular")             # Subfamily
    _set_name(instance, 4, f"{family} Regular")   # Full name
    _set_name(instance, 6, f"{family}-Regular")   # PostScript name
    _set_name(instance, 16, family)               # Typographic family
    _set_name(instance, 17, "Regular")            # Typographic subfamily
    out = OUT_DIR / file
    out.parent.mkdir(parents=True, exist_ok=True)
    instance.save(str(out))
    print(f"Wrote {out} (axes={axes}, family={family!r})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Path to Fraunces variable TTF")
    args = ap.parse_args()
    src = Path(args.src)
    for cfg in BAKES:
        bake(src, cfg["file"], cfg["family"], cfg["axes"])


if __name__ == "__main__":
    main()
