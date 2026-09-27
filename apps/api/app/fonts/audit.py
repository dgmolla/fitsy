"""Check bundled fonts against the archived Google subset coverage and CSS."""

from __future__ import annotations

import json
import re
from pathlib import Path

from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent
API = FONTS.parent.parent
EXPECTED_AXES = {
    "newsreader.woff2": {"wght": (200, 800)},
    "newsreader-italic.woff2": {"wght": (200, 800)},
    "outfit.woff2": {"wght": (100, 900)},
    "fraunces.woff2": {"opsz": (9, 144), "wght": (100, 900)},
    "fraunces-italic.woff2": {"opsz": (9, 144), "wght": (100, 900)},
    "nunito-sans.woff2": {"wght": (200, 1000)},
}


def main() -> None:
    baseline = json.loads((FONTS / "google-subset-baseline.json").read_text())
    assert set(baseline) == set(EXPECTED_AXES)
    for name, record in baseline.items():
        font = TTFont(FONTS / name)
        codepoints = set(font.getBestCmap())
        expected = {
            point
            for first, last in record["codepoint_ranges"]
            for point in range(first, last + 1)
        }
        missing = expected - codepoints
        axes = {
            axis.axisTag: (axis.minValue, axis.maxValue)
            for axis in font["fvar"].axes
        }
        assert not missing, f"{name}: {len(missing)} former Google glyphs missing"
        assert axes == EXPECTED_AXES[name], f"{name}: changed variable axes {axes}"
        print(f"{name}: {len(expected)} former glyphs covered; {len(codepoints)} bundled")

    css = "\n".join(
        path.read_text() for path in (API / ".next/static/css").glob("*.css")
    )
    for family in ("newsreader", "fraunces"):
        face = re.search(rf"@font-face\{{font-family:{family} Fallback;([^}}]+)\}}", css)
        assert face and 'src:local("Times New Roman")' in face.group(1), (
            f"{family}: Times New Roman loading fallback missing from production CSS"
        )
    print("Serif production CSS retains Times New Roman loading fallbacks")


if __name__ == "__main__":
    main()
