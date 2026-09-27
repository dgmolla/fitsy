# API font provenance

These full-coverage variable WOFF2 files come from the pinned Google Fonts source files listed below.
They bundle the same font versions used by the former Google Fonts CSS, while retaining all glyphs that its non-Latin subsets served.
The API production build reads only these local files.
Each family is distributed under its corresponding SIL Open Font License 1.1 file in this directory.
The source fonts and license texts came from [`google/fonts` commit 23e54b51ddffbc7713c583748e3bd86f62b1fa4a](https://github.com/google/fonts/commit/23e54b51ddffbc7713c583748e3bd86f62b1fa4a).

| Local asset | Pinned source | Fixed axes | SHA-256 | License |
| --- | --- | --- | --- | --- |
| `newsreader.woff2` | [`Newsreader[opsz,wght].ttf`](https://github.com/google/fonts/blob/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/newsreader/Newsreader%5Bopsz%2Cwght%5D.ttf) | opsz=16 | `ec6f958b59e337180ceda774341a28805aebd3c92e6fa995838a405c4c2f8fdd` | [`newsreader-OFL.txt`](newsreader-OFL.txt) |
| `newsreader-italic.woff2` | [`Newsreader-Italic[opsz,wght].ttf`](https://github.com/google/fonts/blob/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/newsreader/Newsreader-Italic%5Bopsz%2Cwght%5D.ttf) | opsz=16 | `c5d0cd280f960be4df9eaa9f1452708eaba21bbeb6c82dbfabe03bf849fbcdac` | [`newsreader-OFL.txt`](newsreader-OFL.txt) |
| `outfit.woff2` | [`Outfit[wght].ttf`](https://github.com/google/fonts/blob/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/outfit/Outfit%5Bwght%5D.ttf) | none | `ed629d88c2db8ace1b3ac85fbf1fe0223d7272defaa817d1955100101966f0fb` | [`outfit-OFL.txt`](outfit-OFL.txt) |
| `fraunces.woff2` | [`Fraunces[SOFT,WONK,opsz,wght].ttf`](https://github.com/google/fonts/blob/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf) | SOFT=0; WONK=0 | `dfbe96b85c41e09763848e5dd5a73c7ea7758dd99610dc0ef2f4eef029e3d79b` | [`fraunces-OFL.txt`](fraunces-OFL.txt) |
| `fraunces-italic.woff2` | [`Fraunces-Italic[SOFT,WONK,opsz,wght].ttf`](https://github.com/google/fonts/blob/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/fraunces/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf) | SOFT=0; WONK=0 | `ac6ccee9f8ba78dcbe338ca49b32abee8fb78972634b23784b1d1b2395692360` | [`fraunces-OFL.txt`](fraunces-OFL.txt) |
| `nunito-sans.woff2` | [`NunitoSans[YTLC,opsz,wdth,wght].ttf`](https://github.com/google/fonts/blob/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/nunitosans/NunitoSans%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf) | YTLC=500; opsz=12; wdth=100 | `7c14c6a0e0aa5405b911b5ed977eca9d0d2b3c4e61dca80006ff4338e7fb0f5a` | [`nunitosans-OFL.txt`](nunitosans-OFL.txt) |

The source TTF files were converted with FontTools 4.66.0 and Brotli 1.2.0.
Unrequested design axes were fixed at the values selected by the former `next/font/google` requests, leaving the weight axis for every family and the Fraunces optical size axis variable.
Newsreader retains its normal and italic 400 and 700 declarations; Outfit retains its 100-900 variable weight range.
Fraunces retains normal and italic 100-900 weight ranges and its 9-144 optical size axis.
Nunito Sans retains the declared 300, 400, 600 and 700 faces from its full-coverage variable file.
The layout preserves the CSS variable names and `display: swap` behavior.
Newsreader and Fraunces use the original Times New Roman loading fallback.

`google-subset-baseline.json` records the codepoint ranges and response URLs from the former Google Fonts CSS queries.
After `npm run build:api`, run `python apps/api/app/fonts/audit.py` with FontTools 4.66.0 and Brotli 1.2.0 installed.
The audit checks that each bundled file covers every former glyph, retains its expected variable axes, and emits the serif fallback in production CSS.
