# API font provenance

These are the Latin WOFF2 responses served by Google Fonts on 2026-09-26 for the families used by the API layout.
The files are bundled with the app so production builds do not request Google Fonts.
Each family remains under its corresponding SIL Open Font License 1.1 file in this directory.
The license texts were copied from `google/fonts` commit [`23e54b51ddffbc7713c583748e3bd86f62b1fa4a`](https://github.com/google/fonts/commit/23e54b51ddffbc7713c583748e3bd86f62b1fa4a).

| Local asset | Google Fonts response | SHA-256 | License |
| --- | --- | --- | --- |
| `newsreader-italic.woff2` | [Latin WOFF2](https://fonts.gstatic.com/s/newsreader/v26/cY9XfjOCX1hbuyalUrK439vogqC9yFZCYg7oRZaLFYYzbARA_n8.woff2) | `19a83cc7ce02aab990c0f5fb8bd8f12f2f8e4f56430d5a3459521cabd852a51c` | [`newsreader-OFL.txt`](newsreader-OFL.txt) |
| `newsreader.woff2` | [Latin WOFF2](https://fonts.gstatic.com/s/newsreader/v26/cY9VfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBAbNJYQ5ayZC.woff2) | `2a69ec1c0fb79a464de0e19957cdb3a65b5f626d85fffd164f9de557d3a64878` | [`newsreader-OFL.txt`](newsreader-OFL.txt) |
| `outfit.woff2` | [Latin WOFF2](https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2) | `92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12` | [`outfit-OFL.txt`](outfit-OFL.txt) |
| `fraunces-italic.woff2` | [Latin WOFF2](https://fonts.gstatic.com/s/fraunces/v38/6NU58FyLNQOQZAnv9ZwNjucMHVn85Ni7emAe9lKqZTnbB-gzTK0K1ChjeveQ7ZXk8g.woff2) | `4af9c759c8059b53923b4b50ba377ba51029876e1af1ea757efb07bc67d97896` | [`fraunces-OFL.txt`](fraunces-OFL.txt) |
| `fraunces.woff2` | [Latin WOFF2](https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeP2Xz5c.woff2) | `48282a415ec22e31beaf0a0666e6fae0c8cbddcd0b1f6e729f27c3ade8a64e43` | [`fraunces-OFL.txt`](fraunces-OFL.txt) |
| `nunito-sans.woff2` | [Latin WOFF2](https://fonts.gstatic.com/s/nunitosans/v19/pe0TMImSLYBIv1o4X1M8ce2xCx3yop4tQpF_MeTm0lfGWVpNn64CL7U8upHZIbMV51Q42ptCp7t1R-tQKr51.woff2) | `39184f4d011106f5bfbe3813d3a8c3673663f04a45a9c9f55b1ed15f4d5b1cc9` | [`nunitosans-OFL.txt`](nunitosans-OFL.txt) |

The requested font CSS used the same `display=swap` setting as the previous `next/font/google` declarations.
Newsreader keeps the normal and italic faces at the declared 400 and 700 weights; the underlying files contain the weight axis.
Outfit retains its 100-900 variable weight range.
Fraunces retains normal and italic 100-900 weight ranges and its 9-144 optical size axis.
Nunito Sans retains the declared 300, 400, 600 and 700 faces; those declarations share one variable file.
The layout preserves the existing CSS variable names, and the page styles continue to select Fraunces optical sizes explicitly where needed.

Source CSS requests:

- newsreader: `https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,700;1,400;1,700&display=swap`
- outfit: `https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap`
- fraunces: `https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&display=swap`
- nunito-sans: `https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;600;700&display=swap`
