#!/usr/bin/env python3
"""Render the fitsy Reels content-ethos board and phone-frame mockups.

Usage: python3 docs/gtm/claude-content-ethos/render.py              # geometric placeholders + board
       python3 docs/gtm/claude-content-ethos/render.py --real-photos # real-photo variants A and B

Dependencies: Python 3, Pillow (dimension check, photo crops and cutout), and a local Chrome
(Google Chrome.app or the Playwright chromium headless shell). Inter 400/600
is embedded from the repo's installed Prisma assets when node_modules exists;
otherwise the system sans-serif fallback is used and a warning is printed.

The default run draws original geometric placeholder plates. `--real-photos`
renders two variants of the same three beats from one Google Maps owner-upload
photo of the actual dish (source-photos/michelangelo-ristorante/photo-02.jpg):
variant A full-bleed cover crops, variant B an elliptical cutout of the plate on
the ethos table field. Those frames are internal mockups only; the Maps photo is
not cleared for posting. No live-app value was verified; numbers are the draft
placeholders from docs/gtm/silver-lake-reel-scripts.md and are always labeled
as fitsy's AI estimate.
"""
from __future__ import annotations

import base64
import glob
import io
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]

# ---------------------------------------------------------------- source data
# Silver Lake orders #4 from docs/gtm/silver-lake-reel-scripts.md (draft placeholders).
EPISODE = {
    "series": "Silver Lake orders",
    "number": 4,
    "dish": "Fillet of Sole",
    "venue": "Michelangelo Ristorante",
    "address": "2742 Rowena Ave, Silver Lake",
    "hook": "Silver Lake order:<br>not a salad.",
    "hook_numeric": "Silver Lake order: fitsy's AI estimate ~48g protein, not a salad.",
    "protein": "~48g protein",
    "kcal": "~475 kcal",
    "estimate_label": "fitsy's AI estimate",
    "caveat": "estimate for this plate",
    "save": "Save this<br>Silver Lake order",
}

# Palette: charcoal cards and a mint series bug from the merged scripts; the
# cream secondary text and board background reuse fitsy app tokens
# (apps/mobile/lib/theme.tsx: bgElevated #EDE6DE, bg #FDFBF7, textPrimary #0F1F15).
PALETTE = {
    "charcoal": "#14181A",
    "card": "rgba(20,24,26,0.90)",
    "mint": "#A7F3D0",
    "white": "#FFFFFF",
    "cream": "#EDE6DE",
    "muted": "#C7CFCA",
    "table": "#1C1613",
    "board_bg": "#FDFBF7",
    "board_ink": "#0F1F15",
    "board_ink2": "#3A4F41",
    "board_line": "#E8E2D8",
}

SAFE = {"x0": 90, "x1": 900, "y0": 250, "y1": 1450}

# Real photo for the --real-photos variants: Google Maps owner upload, see
# source-photos/README.md and source-photos/michelangelo-ristorante/manifest.json.
PHOTO = HERE / "source-photos" / "michelangelo-ristorante" / "photo-02.jpg"
PHOTO_CREDIT = "Photo: Michelangelo Ristorante via Google Maps"
REAL_DIR = HERE / "real-photo-variants"
# Outer plate edge in 1600 x 1600 photo pixels (center x, center y, radius x, radius y).
PLATE_ELLIPSE = (800, 1048, 796, 450)


def font_css() -> tuple[str, bool]:
    """Embed Inter 400/600 (latin) from node_modules as data URIs when present."""
    assets = REPO / "node_modules" / "prisma" / "build" / "public" / "assets"
    faces = []
    for weight in ("400", "600"):
        hits = sorted(glob.glob(str(assets / f"inter-latin-{weight}-normal.*.woff2")))
        if not hits:
            return "", False
        data = base64.b64encode(Path(hits[0]).read_bytes()).decode("ascii")
        faces.append(
            "@font-face{font-family:'Inter';font-style:normal;font-weight:%s;"
            "src:url(data:font/woff2;base64,%s) format('woff2');}" % (weight, data)
        )
    return "\n".join(faces), True


FONT_CSS, HAVE_INTER = font_css()
FAMILY = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"


# ---------------------------------------------------------------- food plate
def plate_svg(transform: str, idx: str) -> str:
    """Original geometric placeholder plate: sole fillet, lemon, capers, parsley."""
    return f"""
<svg class="food" viewBox="0 0 1080 1920" width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="table{idx}" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="#3A2C22"/><stop offset="1" stop-color="#140F0C"/>
    </radialGradient>
    <linearGradient id="fillet{idx}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E5B36A"/><stop offset="1" stop-color="#C98A42"/>
    </linearGradient>
    <linearGradient id="fillet2{idx}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#DDA55B"/><stop offset="1" stop-color="#B97A36"/>
    </linearGradient>
    <radialGradient id="plate{idx}" cx="45%" cy="40%" r="70%">
      <stop offset="0" stop-color="#F7F1E7"/><stop offset="1" stop-color="#E3D9CA"/>
    </radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#table{idx})"/>
  <g opacity="0.10" stroke="#000" stroke-width="2">
    <line x1="0" y1="300" x2="1080" y2="420"/><line x1="0" y1="640" x2="1080" y2="760"/>
    <line x1="0" y1="980" x2="1080" y2="1100"/><line x1="0" y1="1320" x2="1080" y2="1440"/>
    <line x1="0" y1="1660" x2="1080" y2="1780"/>
  </g>
  <g transform="{transform}">
    <ellipse cx="552" cy="990" rx="432" ry="432" fill="#000" opacity="0.28"/>
    <circle cx="540" cy="960" r="420" fill="url(#plate{idx})" stroke="#D5CAB9" stroke-width="6"/>
    <circle cx="540" cy="960" r="350" fill="none" stroke="#D9CFBF" stroke-width="3" opacity="0.8"/>
    <!-- fork -->
    <g transform="rotate(-28 250 1180)" fill="#C4C7CB" stroke="#8E9298" stroke-width="3">
      <rect x="236" y="1040" width="28" height="330" rx="12"/>
      <rect x="206" y="950" width="88" height="110" rx="26"/>
      <g fill="#C4C7CB" stroke="none">
        <rect x="208" y="880" width="12" height="90" rx="6"/><rect x="230" y="872" width="12" height="98" rx="6"/>
        <rect x="256" y="872" width="12" height="98" rx="6"/><rect x="278" y="880" width="12" height="90" rx="6"/>
      </g>
    </g>
    <!-- butter sauce pool -->
    <ellipse cx="560" cy="1010" rx="268" ry="150" fill="#EBD58F" opacity="0.85"/>
    <ellipse cx="520" cy="1000" rx="190" ry="96" fill="#F3E3A8" opacity="0.8"/>
    <!-- sole fillets -->
    <g transform="rotate(-18 540 960)">
      <ellipse cx="520" cy="1000" rx="286" ry="98" fill="url(#fillet2{idx})" stroke="#9C6428" stroke-width="5"/>
      <ellipse cx="500" cy="985" rx="200" ry="52" fill="#EEC27E" opacity="0.65"/>
    </g>
    <g transform="rotate(-10 540 960)">
      <ellipse cx="575" cy="920" rx="276" ry="92" fill="url(#fillet{idx})" stroke="#A86E2E" stroke-width="5"/>
      <ellipse cx="545" cy="905" rx="190" ry="46" fill="#F2CC8A" opacity="0.7"/>
      <path d="M380 915 q60 -14 120 0 t120 0 t120 0" fill="none" stroke="#B57A36" stroke-width="5" opacity="0.7"/>
      <path d="M400 945 q60 -14 120 0 t120 0 t100 0" fill="none" stroke="#B57A36" stroke-width="4" opacity="0.5"/>
    </g>
    <!-- capers -->
    <g fill="#4E6F3A" stroke="#35512A" stroke-width="2">
      <circle cx="470" cy="930" r="12"/><circle cx="560" cy="905" r="11"/><circle cx="650" cy="925" r="12"/>
      <circle cx="600" cy="985" r="11"/><circle cx="505" cy="1010" r="12"/><circle cx="700" cy="960" r="10"/>
    </g>
    <!-- parsley -->
    <g fill="#4F8A4A" stroke="#2F6A34" stroke-width="2">
      <ellipse cx="690" cy="1060" rx="34" ry="16" transform="rotate(-30 690 1060)"/>
      <ellipse cx="722" cy="1040" rx="30" ry="14" transform="rotate(20 722 1040)"/>
      <ellipse cx="412" cy="870" rx="30" ry="14" transform="rotate(-50 412 870)"/>
    </g>
    <!-- lemon wedge -->
    <g transform="translate(790 780)">
      <circle r="78" fill="#F6D64A" stroke="#E0B828" stroke-width="6"/>
      <circle r="64" fill="none" stroke="#FBF0B0" stroke-width="6" opacity="0.9"/>
      <g stroke="#E7C23A" stroke-width="4">
        <line x1="0" y1="0" x2="0" y2="-64"/><line x1="0" y1="0" x2="55" y2="-32"/><line x1="0" y1="0" x2="55" y2="32"/>
        <line x1="0" y1="0" x2="0" y2="64"/><line x1="0" y1="0" x2="-55" y2="32"/><line x1="0" y1="0" x2="-55" y2="-32"/>
      </g>
    </g>
  </g>
  <rect width="1080" height="1920" fill="url(#vig{idx})" opacity="0"/>
</svg>"""


# ---------------------------------------------------------------- frame html
BASE_CSS = f"""
{FONT_CSS}
html,body{{margin:0;padding:0;width:1080px;height:1920px;overflow:hidden;background:{PALETTE['table']};}}
.frame{{position:relative;width:1080px;height:1920px;overflow:hidden;font-family:{FAMILY};font-weight:600;color:{PALETTE['white']};-webkit-font-smoothing:antialiased;}}
.food{{position:absolute;left:0;top:0;}}
.shade-top{{position:absolute;left:0;right:0;top:0;height:720px;background:linear-gradient(180deg,rgba(0,0,0,.50) 0%,rgba(0,0,0,0) 100%);}}
.shade-bottom{{position:absolute;left:0;right:0;bottom:0;height:760px;background:linear-gradient(0deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 100%);}}
.bug{{position:absolute;left:{SAFE['x0']}px;top:{SAFE['y0']}px;background:{PALETTE['mint']};color:{PALETTE['charcoal']};font-size:34px;line-height:40px;padding:10px 22px;border-radius:14px;letter-spacing:-0.01em;}}
.card{{background:{PALETTE['card']};border-radius:20px;padding:24px 30px;display:inline-block;box-sizing:border-box;}}
.hook{{position:absolute;left:{SAFE['x0']}px;top:338px;max-width:810px;font-size:60px;line-height:70px;letter-spacing:-0.015em;}}
.identity-center{{position:absolute;left:{SAFE['x0']}px;width:810px;top:0;text-align:center;}}
.identity-center .card{{text-align:left;}}
.dish{{font-size:44px;line-height:54px;}}
.venue{{font-size:44px;line-height:54px;color:{PALETTE['cream']};}}
.sub{{font-size:34px;line-height:42px;color:{PALETTE['muted']};font-weight:400;margin-top:6px;}}
.reveal{{position:absolute;left:{SAFE['x0']}px;max-width:810px;}}
.reveal .who{{font-size:34px;line-height:42px;color:{PALETTE['cream']};margin-bottom:10px;}}
.reveal .label{{font-size:34px;line-height:42px;color:{PALETTE['cream']};}}
.reveal .num{{font-size:48px;line-height:58px;margin:4px 0 6px;letter-spacing:-0.01em;white-space:nowrap;}}
.reveal .caveat{{font-size:34px;line-height:42px;color:{PALETTE['muted']};font-weight:400;}}
.save{{position:absolute;left:{SAFE['x0']}px;top:338px;max-width:810px;}}
.save .series{{font-size:34px;line-height:42px;color:{PALETTE['cream']};margin-bottom:6px;}}
.save .cta{{font-size:60px;line-height:70px;letter-spacing:-0.015em;display:flex;align-items:center;gap:22px;}}
.save svg{{flex:none;}}
.tag{{position:absolute;left:{SAFE['x0']}px;top:1790px;font-size:24px;line-height:30px;font-weight:400;color:rgba(255,255,255,.78);border:2px dashed rgba(255,255,255,.5);border-radius:10px;padding:8px 14px;letter-spacing:.04em;}}
.tag b{{font-weight:600;color:#fff;}}
"""


REAL_CSS = f"""
.photo{{position:absolute;left:0;top:0;width:1080px;height:1920px;display:block;}}
.shade-top.soft{{background:linear-gradient(180deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,0) 100%);}}
.table{{position:absolute;left:0;top:0;width:1080px;height:1920px;background:radial-gradient(75% 75% at 50% 45%,#3A2C22 0%,#140F0C 100%);}}
.table svg{{position:absolute;left:0;top:0;}}
.cutout{{position:absolute;left:0;top:0;transform-origin:0 0;display:block;filter:drop-shadow(0 36px 44px rgba(0,0,0,.62));}}
.credit{{position:absolute;right:{1080 - SAFE['x1']}px;top:{SAFE['y0']}px;max-width:360px;text-align:right;font-size:22px;line-height:26px;font-weight:400;color:rgba(255,255,255,.88);background:rgba(20,24,26,.62);border-radius:10px;padding:6px 12px;}}
.hook.tight{{top:330px;}}
.stack{{position:absolute;left:{SAFE['x0']}px;max-width:810px;}}
.stack .who{{font-size:34px;line-height:42px;color:{PALETTE['cream']};margin-bottom:10px;}}
.stack .label{{font-size:34px;line-height:42px;color:{PALETTE['cream']};}}
.stack .num{{font-size:48px;line-height:58px;margin:4px 0 6px;letter-spacing:-0.01em;white-space:nowrap;}}
.stack .caveat{{font-size:34px;line-height:42px;color:{PALETTE['muted']};font-weight:400;}}
.stack.big .card{{padding:30px 36px;}}
.stack.big .who,.stack.big .label{{font-size:36px;line-height:44px;}}
.stack.big .num{{font-size:64px;line-height:76px;margin:6px 0 8px;}}
.stack.big .caveat{{font-size:36px;line-height:44px;}}
.save.tight{{top:326px;}}
"""

BOOKMARK = """<svg width="52" height="64" viewBox="0 0 26 32" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linejoin="round"><path d="M4 2h18v28l-9-7-9 7z"/></svg>"""


def tag(label: str) -> str:
    return f'<div class="tag"><b>UNFILMED PLACEHOLDER PLATE</b> · {label} · layout proof only, not a live-app value</div>'


def reveal_card(top: int, with_identity: bool) -> str:
    who = (f'<div class="who">{EPISODE["dish"]} · {EPISODE["venue"]}</div>' if with_identity else "")
    return f"""
<div class="reveal" style="top:{top}px"><div class="card">
  {who}
  <div class="label">{EPISODE['estimate_label']}</div>
  <div class="num">{EPISODE['protein']} · {EPISODE['kcal']}</div>
  <div class="caveat">{EPISODE['caveat']}</div>
</div></div>"""


def frame_doc(body: str, extra_css: str = "") -> str:
    return f"<!doctype html><html><head><meta charset='utf-8'><style>{BASE_CSS}{extra_css}</style></head><body>{body}</body></html>"


def bug() -> str:
    return f'<div class="bug">{EPISODE["series"]} #{EPISODE["number"]}</div>'


def frame_hook() -> str:
    body = f"""<div class="frame">
  {plate_svg('translate(-616 -803) scale(2.1)', 'a')}
  <div class="shade-top"></div><div class="shade-bottom"></div>
  {bug()}
  <div class="hook"><div class="card">{EPISODE['hook']}</div></div>
  {tag('0-1s hook frame')}
</div>"""
    return frame_doc(body)


def frame_name() -> str:
    body = f"""<div class="frame">
  {plate_svg('translate(-189 -166) scale(1.35)', 'b')}
  <div class="shade-top"></div><div class="shade-bottom"></div>
  {bug()}
  <div class="identity-center" style="top:640px"><div class="card">
    <div class="dish">{EPISODE['dish']}</div>
    <div class="venue">{EPISODE['venue']}</div>
    <div class="sub">{EPISODE['address']}</div>
  </div></div>
  {tag('1-2s dish and restaurant frame')}
</div>"""
    return frame_doc(body)


def frame_reveal() -> str:
    body = f"""<div class="frame">
  {plate_svg('translate(81 134) scale(0.85)', 'c')}
  <div class="shade-top"></div><div class="shade-bottom"></div>
  {bug()}
  {reveal_card(1150, True)}
  {tag('7-10s estimate reveal frame · draft placeholder numbers')}
</div>"""
    return frame_doc(body)


def frame_end() -> str:
    body = f"""<div class="frame">
  {plate_svg('translate(81 134) scale(0.85)', 'd')}
  <div class="shade-top"></div><div class="shade-bottom"></div>
  {bug()}
  <div class="save"><div class="card">
    <div class="series">{EPISODE['series']} #{EPISODE['number']}</div>
    <div class="cta">{BOOKMARK}<div>{EPISODE['save']}</div></div>
  </div></div>
  {reveal_card(1150, True)}
  {tag('10-12s save end card · draft placeholder numbers')}
</div>"""
    return frame_doc(body)



# ---------------------------------------------------------------- real photo
def data_uri(im, fmt: str) -> str:
    buf = io.BytesIO()
    if fmt == "JPEG":
        im.save(buf, "JPEG", quality=92, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def load_photo():
    from PIL import Image

    im = Image.open(PHOTO).convert("RGB")
    if im.size != (1600, 1600):
        sys.exit(f"{PHOTO.name}: expected 1600x1600, got {im.size}")
    return im


def cover_crop(im, left: int, top: int, width: int) -> str:
    """Cover-crop a 9:16 window (photo pixels) and resample it to 1080x1920."""
    from PIL import Image

    height = round(width * 16 / 9)
    if left < 0 or top < 0 or left + width > im.width or top + height > im.height:
        sys.exit(f"crop {left},{top},{width}x{height} leaves the {im.width}x{im.height} photo")
    out = im.crop((left, top, left + width, top + height)).resize((1080, 1920), Image.LANCZOS)
    return data_uri(out, "JPEG")


def plate_cutout(im) -> str:
    """Cut the plate out of the photo along its outer edge with a 3 px feather."""
    from PIL import Image, ImageDraw, ImageFilter

    cx, cy, rx, ry = PLATE_ELLIPSE
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(3))
    rgba = im.convert("RGBA")
    rgba.putalpha(mask)
    return data_uri(rgba.crop((0, cy - ry - 8, 1600, cy + ry + 8)), "PNG")


def credit() -> str:
    return f'<div class="credit">{PHOTO_CREDIT.replace(" via ", "<br>via ")}</div>'


def real_tag(label: str) -> str:
    return f'<div class="tag"><b>INTERNAL MOCKUP</b> · Maps photo not cleared for posting · {label}</div>'


def stack(top: int, big: bool = False) -> str:
    return f"""
<div class="stack{' big' if big else ''}" style="top:{top}px"><div class="card">
  <div class="who">{EPISODE['dish']} · {EPISODE['venue']}</div>
  <div class="label">{EPISODE['estimate_label']}</div>
  <div class="num">{EPISODE['protein']} · {EPISODE['kcal']}</div>
  <div class="caveat">{EPISODE['caveat']}</div>
</div></div>"""


def save_card(tight: bool) -> str:
    return f"""
<div class="save{' tight' if tight else ''}"><div class="card">
  <div class="series">{EPISODE['series']} #{EPISODE['number']}</div>
  <div class="cta">{BOOKMARK}<div>{EPISODE['save']}</div></div>
</div></div>"""


# Variant A: the photo fills the frame. The square source only allows a 900 px
# wide 9:16 window, which puts the fillet in the lower band, so every card sits
# in the dark background and napkin band above the vegetables.
def frame_a(beat: str, photo_uri: str) -> str:
    if beat == "hook":
        text = f'<div class="hook tight"><div class="card">{EPISODE["hook"]}</div></div>' + stack(546)
        label = "0-1s hook · draft numbers"
    elif beat == "reveal":
        text = stack(384, big=True)
        label = "7-10s estimate reveal · draft numbers"
    else:
        text = save_card(True) + stack(578)
        label = "10-12s save end card · draft numbers"
    body = f"""<div class="frame">
  <img class="photo" src="{photo_uri}" alt="">
  <div class="shade-top soft"></div><div class="shade-bottom"></div>
  {bug()}{credit()}
  {text}
  {real_tag(label)}
</div>"""
    return frame_doc(body, REAL_CSS)


# Variant B: the same plate cut out along its edge and set on the ethos table
# field, so the cards keep the original top-third / lower-third positions.
def frame_b(beat: str, cutout_uri: str) -> str:
    cy, ry = PLATE_ELLIPSE[1], PLATE_ELLIPSE[3]
    crop_top = cy - ry - 8  # cutout image row 0 in photo pixels
    if beat == "hook":
        scale, left, plate_top = 0.80, -100, 520
        text = f'<div class="hook"><div class="card">{EPISODE["hook"]}</div></div>' + stack(1180)
        label = "0-1s hook · draft numbers"
    else:
        scale, left, plate_top = 0.62, 44, 580
        if beat == "reveal":
            text = stack(1150, big=True)
            label = "7-10s estimate reveal · draft numbers"
        else:
            text = save_card(False) + stack(1170)
            label = "10-12s save end card · draft numbers"
    top = plate_top - round((cy - ry - crop_top) * scale)
    body = f"""<div class="frame">
  <div class="table"><svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
    <g opacity="0.10" stroke="#000" stroke-width="2">
      <line x1="0" y1="300" x2="1080" y2="420"/><line x1="0" y1="640" x2="1080" y2="760"/>
      <line x1="0" y1="980" x2="1080" y2="1100"/><line x1="0" y1="1320" x2="1080" y2="1440"/>
      <line x1="0" y1="1660" x2="1080" y2="1780"/>
    </g></svg></div>
  <img class="cutout" src="{cutout_uri}" alt="" style="transform:translate({left}px,{top}px) scale({scale})">
  <div class="shade-top"></div><div class="shade-bottom"></div>
  {bug()}{credit()}
  {text}
  {real_tag(label)}
</div>"""
    return frame_doc(body, REAL_CSS)


def real_frames() -> dict[str, str]:
    photo = load_photo()
    # Hook: slightly tighter window on the fillet; reveal and end: the widest full-plate window.
    hook_uri = cover_crop(photo, 190, 60, 820)
    plate_uri = cover_crop(photo, 350, 0, 900)
    cutout_uri = plate_cutout(photo)
    return {
        "a-01-hook.png": frame_a("hook", hook_uri),
        "a-02-reveal.png": frame_a("reveal", plate_uri),
        "a-03-end.png": frame_a("end", plate_uri),
        "b-01-hook.png": frame_b("hook", cutout_uri),
        "b-02-reveal.png": frame_b("reveal", cutout_uri),
        "b-03-end.png": frame_b("end", cutout_uri),
    }


# ---------------------------------------------------------------- ethos board
def board_html(thumbs: dict[str, str]) -> str:
    p = PALETTE
    css = f"""
{FONT_CSS}
html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:{p['board_bg']};}}
.board{{position:relative;width:1920px;height:1080px;box-sizing:border-box;padding:44px 56px;font-family:{FAMILY};color:{p['board_ink']};font-weight:400;-webkit-font-smoothing:antialiased;}}
h1{{margin:0;font-size:40px;line-height:46px;font-weight:600;letter-spacing:-0.02em;}}
.kicker{{font-size:18px;line-height:24px;color:{p['board_ink2']};margin-top:6px;}}
.grid{{display:grid;grid-template-columns:560px 540px minmax(0,1fr);gap:36px;margin-top:22px;}}
h2{{margin:0 0 10px;font-size:15px;line-height:20px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:{p['board_ink2']};}}
.block{{margin-bottom:18px;}}
ol{{margin:0;padding-left:22px;font-size:18px;line-height:25px;}}
ol li{{margin-bottom:7px;}}
ol b{{font-weight:600;}}
.sw{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}}
.sw div{{border-radius:12px;height:84px;padding:10px 12px;box-sizing:border-box;font-size:14px;line-height:18px;font-weight:600;border:1px solid {p['board_line']};}}
.type{{border:1px solid {p['board_line']};border-radius:16px;padding:14px 18px;background:#fff;}}
.type .row{{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px dashed {p['board_line']};padding:6px 0;}}
.type .row:last-child{{border-bottom:0;}}
.type .s{{font-weight:600;letter-spacing:-0.01em;}}
.type .m{{font-size:14px;color:{p['board_ink2']};white-space:nowrap;margin-left:14px;}}
.dd{{display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:15px;line-height:20px;}}
.dd div{{border-radius:14px;padding:10px 12px;}}
.do{{background:#EFF6F1;border:1px solid rgba(27,58,38,.18);}}
.dont{{background:#FBEFEA;border:1px solid rgba(220,38,38,.18);}}
.dd h3{{margin:0 0 6px;font-size:15px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;}}
.dd ul{{margin:0;padding-left:18px;}}
.dd li{{margin-bottom:3px;}}
.phones{{display:flex;gap:12px;}}
.phones figure{{margin:0;width:140px;}}
.phones img{{width:140px;height:249px;border-radius:16px;display:block;border:1px solid {p['board_line']};}}
.phones figcaption{{font-size:13px;line-height:17px;color:{p['board_ink2']};margin-top:6px;}}
.timeline{{display:grid;grid-template-columns:2fr 3fr 2fr 3fr 2fr;gap:4px;font-size:14px;line-height:18px;}}
.timeline div{{background:#fff;border:1px solid {p['board_line']};border-radius:10px;padding:8px 10px;min-height:84px;}}
.timeline b{{display:block;font-weight:600;font-size:15px;margin-bottom:4px;}}
.layout{{display:flex;gap:18px;align-items:flex-start;}}
.layout svg{{flex:none;}}
.layout ul{{margin:0;padding-left:18px;font-size:15px;line-height:21px;color:{p['board_ink']};}}
.layout li{{margin-bottom:5px;}}
.hooks{{font-size:15px;line-height:21px;}}
.hooks div{{border:1px solid {p['board_line']};border-radius:12px;padding:10px 12px;background:#fff;margin-bottom:8px;}}
.hooks b{{font-weight:600;}}
.foot{{position:absolute;left:56px;right:56px;bottom:26px;font-size:13px;line-height:18px;color:{p['board_ink2']};border-top:1px solid {p['board_line']};padding-top:10px;}}
"""
    layout_svg = f"""
<svg width="190" height="338" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1920" rx="90" fill="{p['charcoal']}"/>
  <rect x="90" y="250" width="810" height="1200" fill="none" stroke="{p['mint']}" stroke-width="10" stroke-dasharray="40 30"/>
  <rect x="90" y="250" width="360" height="90" rx="26" fill="{p['mint']}"/>
  <rect x="90" y="370" width="700" height="250" rx="30" fill="#FFFFFF" opacity=".92"/>
  <rect x="200" y="780" width="600" height="220" rx="30" fill="#FFFFFF" opacity=".55"/>
  <rect x="90" y="1150" width="700" height="280" rx="30" fill="#FFFFFF" opacity=".92"/>
  <rect x="920" y="1050" width="120" height="400" rx="40" fill="#FFFFFF" opacity=".18"/>
  <rect x="60" y="1500" width="960" height="330" rx="40" fill="#FFFFFF" opacity=".18"/>
</svg>"""
    sw = "".join(
        f'<div style="background:{bg};color:{fg}">{name}<br>{hexv}</div>'
        for name, bg, fg, hexv in [
            ("Charcoal card", p["charcoal"], "#fff", "#14181A at 90%"),
            ("Mint bug only", p["mint"], p["charcoal"], "#A7F3D0"),
            ("White headline", "#FFFFFF", p["charcoal"], "#FFFFFF"),
            ("Cream secondary", p["cream"], p["charcoal"], "#EDE6DE"),
        ]
    )
    thumbs_html = "".join(
        f'<figure><img src="{src}" alt="{cap}"><figcaption>{cap}</figcaption></figure>'
        for cap, src in thumbs.items()
    )
    body = f"""
<div class="board">
  <h1>fitsy Reels content ethos · Silver Lake orders that secretly hit your protein goal</h1>
  <div class="kicker">Faceless, food-first, readable without sound. One series look across every episode; the neighborhood is the brand, not the restaurant. Draft for Dawit's review; mockups use unfilmed geometric plates and draft placeholder numbers labeled as fitsy's AI estimate.</div>
  <div class="grid">
    <div>
      <div class="block"><h2>Principles</h2>
        <ol>
          <li><b>Food first, number second.</b> Open on the plate arriving; the hook names the neighborhood and the order, never a venue-wide health claim.</li>
          <li><b>One series, one chrome.</b> Same Inter weights, charcoal cards, mint "Silver Lake orders #N" bug and save card every episode, so a save feels like collecting the set.</li>
          <li><b>Every number carries its label.</b> "fitsy's AI estimate" above, "estimate for this plate" below, on the same card. No bare "46g" style figures, no verification ticks.</li>
          <li><b>Quiet middle.</b> Three food beats with no new text; the eye rests on the dish until the lower-third reveal.</li>
          <li><b>Save, not install.</b> The ending asks for one easy action tied to the neighborhood list; the app never gets a demo cut.</li>
          <li><b>No faces, no clutter.</b> Hands only; at most one card on screen; text inside the safe area away from controls and caption.</li>
        </ol>
      </div>
      <div class="block"><h2>Do / Don't</h2>
        <div class="dd">
          <div class="do"><h3>Do</h3><ul><li>Hook over the arriving plate in the top third</li><li>Dish and restaurant centered at 1-2s</li><li>Reveal as one lower-third card with label and caveat</li><li>"Save this Silver Lake order" plus series number</li><li>Exact dish and venue names, real addresses</li></ul></div>
          <div class="dont"><h3>Don't</h3><ul><li>"Healthiest spot in LA" or "healthy restaurant"</li><li>Unexplained numbers or unlabeled grams</li><li>App screens, loading spinners, install pushes</li><li>Dense ingredient stacks or two cards at once</li><li>Faces, mirrors, hidden sides or sauces</li></ul></div>
        </div>
      </div>
    </div>
    <div>
      <div class="block"><h2>Palette</h2><div class="sw">{sw}</div></div>
      <div class="block"><h2>Type · Inter semibold, white on charcoal (shown at half size)</h2>
        <div class="type">
          <div class="row"><span class="s" style="font-size:30px">Hook 60 px</span><span class="m">2 lines max, top third</span></div>
          <div class="row"><span class="s" style="font-size:24px">Estimate 48 px</span><span class="m">one line, lower third</span></div>
          <div class="row"><span class="s" style="font-size:22px">Dish / restaurant 44 px</span><span class="m">wrap long names, never truncate</span></div>
          <div class="row"><span class="s" style="font-size:18px">Caveat and bug 34 px</span><span class="m">cream or muted, regular weight for caveat</span></div>
        </div>
      </div>
      <div class="block"><h2>Layout · 1080 × 1920 safe area</h2>
        <div class="layout">{layout_svg}
          <ul>
            <li>Text lives inside x 90-900, y 250-1450 (dashed). Right rail and bottom caption stay empty.</li>
            <li>Top third: mint bug, then the hook card or the save card.</li>
            <li>Center: identity card at 1-2s only.</li>
            <li>Lower third: the single estimate card, cards 20 px radius, 24 px padding, 90% charcoal.</li>
            <li>Food stays unobstructed between the cards; close-ups sit under the hook, the full plate under the reveal.</li>
          </ul>
        </div>
      </div>
    </div>
    <div>
      <div class="block"><h2>Frames · #4 Fillet of Sole at Michelangelo Ristorante</h2><div class="phones">{thumbs_html}</div></div>
      <div class="block"><h2>Motion and pacing · 12 s, hard cuts at 2 and 5 s</h2>
        <div class="timeline">
          <div><b>0-2 s</b>Plate lands, close-up. Hook card in.</div>
          <div><b>2-5 s</b>Fork lifts one piece. Identity centered, then fades. No new text.</div>
          <div><b>5-7 s</b>Overhead full plate. Quiet.</div>
          <div><b>7-10 s</b>Lower-third estimate card eases in; food unchanged.</div>
          <div><b>10-12 s</b>Save card replaces hook; estimate stays.</div>
        </div>
      </div>
      <div class="block"><h2>Hook number: two options</h2>
        <div class="hooks">
          <div><b>A · No number until the reveal (used in these frames).</b> "Silver Lake order: not a salad." Matches the later #743 direction and Template D; the reveal becomes the payoff, like the Panda Express end-card example.</div>
          <div><b>B · Labeled number in the hook.</b> "Silver Lake order: fitsy's AI estimate ~48g protein, not a salad." Follows the CAVA macro-stack-first clip and the scripts' estimate-from-frame-0; only with the label and a full reveal card later.</div>
        </div>
      </div>
    </div>
  </div>
  <div class="foot">Sources: docs/gtm/faceless-reels-research.md and faceless-reels-dataset.csv (115 inspected faceless examples), docs/gtm/silver-lake-reel-scripts.md (type sizes, card spec, safe area, draft values), issue #743 hierarchy. Numbers are draft fitsy AI estimates pending exact live-app item and filmed-plate checks; nothing here is restaurant nutrition data. Plates are original geometric placeholders, not photographs.</div>
</div>"""
    return f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{body}</body></html>"


# ---------------------------------------------------------------- rendering
def find_chrome() -> str:
    env = os.environ.get("CHROME")
    if env and Path(env).exists():
        return env
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        *glob.glob(str(Path.home() / "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell")),
        *glob.glob(str(Path.home() / "Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")),
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    for name in ("chromium", "google-chrome", "chrome"):
        if shutil.which(name):
            return shutil.which(name)
    sys.exit("No Chrome found; set CHROME=/path/to/chrome")


def screenshot(chrome: str, html_path: Path, out: Path, w: int, h: int, profile: Path) -> None:
    cmd = [
        chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
        "--disable-extensions", f"--user-data-dir={profile}", f"--window-size={w},{h}",
        "--force-device-scale-factor=1", "--virtual-time-budget=4000",
        f"--screenshot={out}", html_path.as_uri(),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def verify(path: Path, w: int, h: int) -> None:
    from PIL import Image

    with Image.open(path) as im:
        if im.size != (w, h):
            sys.exit(f"{path.name}: expected {w}x{h}, got {im.size}")
        # Ink check: a rendered frame should contain pure white text pixels.
        rgb = im.convert("RGB")
        px = rgb.getcolors(maxcolors=w * h)
        white = sum(c for c, col in px if col[0] > 245 and col[1] > 245 and col[2] > 245)
        if white < 2000:
            sys.exit(f"{path.name}: too few white pixels ({white}); text may not have rendered")
    print(f"ok {path.relative_to(REPO)} {w}x{h} {path.stat().st_size:,} bytes")


def render_real_photos(chrome: str) -> None:
    REAL_DIR.mkdir(exist_ok=True)
    frames = real_frames()
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        profile = tmpdir / "profile"
        for name, html in frames.items():
            src = tmpdir / name.replace(".png", ".html")
            src.write_text(html, encoding="utf-8")
            screenshot(chrome, src, REAL_DIR / name, 1080, 1920, profile)
            verify(REAL_DIR / name, 1080, 1920)
    print(f"rendered {len(frames)} PNGs into", REAL_DIR.relative_to(REPO))


def main() -> None:
    chrome = find_chrome()
    if not HAVE_INTER:
        print("warning: Inter not found under node_modules; rendering with the system sans-serif fallback")
    if "--real-photos" in sys.argv[1:]:
        render_real_photos(chrome)
        return
    frames = {
        "mockup-01-hook.png": (frame_hook(), "0-1 s hook over close-up"),
        "mockup-02-name.png": (frame_name(), "1-2 s dish and restaurant"),
        "mockup-03-reveal.png": (frame_reveal(), "7-10 s labeled estimate reveal"),
        "mockup-04-end.png": (frame_end(), "10-12 s save end card"),
    }
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        profile = tmpdir / "profile"
        for name, (html, _) in frames.items():
            src = tmpdir / name.replace(".png", ".html")
            src.write_text(html, encoding="utf-8")
            screenshot(chrome, src, HERE / name, 1080, 1920, profile)
            verify(HERE / name, 1080, 1920)
        thumbs = {cap: (HERE / name).as_uri() for name, (_, cap) in frames.items()}
        src = tmpdir / "ethos-board.html"
        src.write_text(board_html(thumbs), encoding="utf-8")
        screenshot(chrome, src, HERE / "ethos-board.png", 1920, 1080, profile)
        verify(HERE / "ethos-board.png", 1920, 1080)
    print("rendered 5 PNGs into", HERE.relative_to(REPO))


if __name__ == "__main__":
    main()
