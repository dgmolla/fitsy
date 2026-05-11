#!/usr/bin/env python3
"""
Re-bake a static Fraunces display cut for React Native.

React Native 0.81 can't drive variable-font axes at runtime, so we ship a
pre-instanced static TTF that matches the webapp's hero rendering:
`font-family: Fraunces; font-weight: 400` with `opsz` axis auto-engaged at
display size — i.e. opsz=144, wght=400.

Run:
  python3 apps/mobile/scripts/bake-fraunces-display.py \\
      --src /path/to/Fraunces[SOFT,WONK,opsz,wght].ttf

The source variable TTF lives in undercasetype/Fraunces on GitHub
(fonts/variable/). Re-download if the asset ever needs re-baking.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = Path(__file__).resolve().parents[1] / "assets" / "fonts" / "Fraunces-Display144-450-Wonk.ttf"
# WONK=1 keeps the playful curved alternates on n/h/m that give Fraunces its
# editorial character. The webapp inherits WONK=1 because browsers only drive
# the opsz axis and leave the rest at default.
AXES = {"opsz": 144, "wght": 450, "SOFT": 50, "WONK": 1}
FAMILY = "FrauncesDisplayWonk"
SUBFAMILY = "Regular"
FULL_NAME = "FrauncesDisplayWonk Regular"
POSTSCRIPT = "FrauncesDisplayWonk-Regular"


def _set_name(font: TTFont, name_id: int, value: str) -> None:
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID == name_id:
            name.removeNames(nameID=name_id, platformID=rec.platformID, platEncID=rec.platEncID, langID=rec.langID)
    name.setName(value, name_id, 3, 1, 0x409)  # Windows / Unicode / English
    name.setName(value, name_id, 1, 0, 0)      # Mac / Roman / English


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Path to Fraunces variable TTF")
    args = ap.parse_args()

    src = Path(args.src)
    font = TTFont(str(src))
    instance = instantiateVariableFont(font, AXES, inplace=False, optimize=True)

    # Rewrite the name table so iOS registers this as a distinct family rather
    # than colliding with any other Fraunces variant the OS may know about.
    _set_name(instance, 1, FAMILY)          # Family
    _set_name(instance, 2, SUBFAMILY)       # Subfamily
    _set_name(instance, 4, FULL_NAME)       # Full name
    _set_name(instance, 6, POSTSCRIPT)      # PostScript name
    _set_name(instance, 16, FAMILY)         # Typographic family
    _set_name(instance, 17, SUBFAMILY)      # Typographic subfamily

    OUT.parent.mkdir(parents=True, exist_ok=True)
    instance.save(str(OUT))
    print(f"Wrote {OUT} (axes baked: {AXES}, family: {FAMILY!r})")


if __name__ == "__main__":
    main()
