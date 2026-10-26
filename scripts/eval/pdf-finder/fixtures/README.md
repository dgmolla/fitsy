# PDF finder fixtures

**TL;DR:** Small official-source text excerpts and synthetic HTML isolate column mapping, search handling and abstention behavior.

`wahoos.txt` contains three rows and the wrapped header from the official June 2026 guide.
The original PDF is [Wahoo's nutrition guide](https://www.wahoos.com/wp-content/uploads/2026/06/Wahoos-Nutritional-info-6-26.pdf), SHA-256 `105423afbefb12ae06fd368596ec974a8ce9935b73c474663432c54f5fee3c21`.
The fixture retains the physical contents-page offset and one wrapped item name.

`claim-jumper.txt` contains the first three rows and complete header from [Claim Jumper's official PDF](https://www.claimjumper.com/files/nutrition-guide-pdf.pdf), SHA-256 `e754c6727379534fec0fff36055933c13730dbc2cc9adb4f5f279cb01f766835`.
These text excerpts come from `pdftotext -layout` and are not independently approved nutrition facts.

`table.html`, `cards.html`, and `search.html` are synthetic documents, requiring neither website access nor Poppler.
They exercise full nutrient labels, missing/less-than values, table spans, regional notes, DDG redirects and Bing base64 wrappers.
The demo directories hold the complete original sources and the separate manual spot-check evidence.
