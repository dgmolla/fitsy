# PDF finder demo, 2026-10-26

**TL;DR:** Three chains absent from local inventories yielded 2,942 unverified rows, with all thirty sampled macro tuples matching.

| Chain | Source found | Complete rows | Skipped diagnostics | Random spot checks |
| --- | --- | ---: | ---: | ---: |
| Wahoo's Fish Taco | [Official June 2026 PDF](https://www.wahoos.com/wp-content/uploads/2026/06/Wahoos-Nutritional-info-6-26.pdf) | 1,523 | 3 | 10/10 |
| Claim Jumper | [Official nutrition PDF](https://www.claimjumper.com/files/nutrition-guide-pdf.pdf) | 1,244 | 17 | 10/10 |
| The Old Spaghetti Factory | [Official nutrition page](https://www.osf.com/about/nutrition/) | 175 | 5 | 10/10 |

Every row remains `unverified`, including the sampled rows.
Counts cover complete published configurations, components, regional variants and catering/banquet portions, not distinct currently available LA meals.
Claim Jumper's document is an indexed older source; source currency remains unresolved, and a successful parse does not settle it.
Old Spaghetti Factory uses the supported static HTML-card fallback because its official source is a page rather than a PDF.

## Selection and LA context

[eligibility.json](eligibility.json) pins seven local inventories and reviewed fact/binding files by SHA-256 and records no matches for these three chain names.
The inspected sets include `scripts/phase0-chains.json`, the reviewed WaBa/Yoshinoya and manufacturer catalogs, independent truth fixtures, production rollout receipts, and the Jev macro truth set.
Habit Burger, El Pollo Loco and Panda Express were excluded because local chain lists and rollout records already contain them.
This establishes absence from the checked repository snapshots; the live database was not queried.

These chains have Greater LA presence: Wahoo's lists Torrance in its [official Southern California locations](https://www.wahoos.com/socal-search/), Claim Jumper publishes its [Buena Park location](https://www.claimjumper.com/buena-park), and Old Spaghetti Factory publishes its [Duarte location](https://www.osf.com/location/duarte-ca/).
In-N-Out was considered but excluded when its official PDF URL returned a challenge page instead of PDF bytes.
No challenge bypass or substitute third-party nutrition data was used.

## Spot checks and reproducibility

[spot-checks.json](spot-checks.json) stores one independently generated random seed per chain, the ten sampled canonical keys, physical page/text line locators, source excerpts, manually transcribed observed macros, extracted macros and match results.
Selection sorts canonical keys by SHA-256 of the seed, a newline, and the key; the first ten form the sample.
Selection never depends on calories or other macro values.
The four compared values are calories, protein grams, carbohydrate grams and total fat grams.
For the PDFs, the source header order was visually inspected and each sampled raw text row was reread.
For the HTML source, the original downloaded label/value cards were independently reread using Python's `html.parser`, rather than trusting the finder's normalized output.
All thirty sampled tuples match exactly; this is agent spot inspection, not human approval or a claim of full-file accuracy.

The final source hashes are:

| Chain | Raw SHA-256 |
| --- | --- |
| Wahoo's | `105423afbefb12ae06fd368596ec974a8ce9935b73c474663432c54f5fee3c21` |
| Claim Jumper | `e754c6727379534fec0fff36055933c13730dbc2cc9adb4f5f279cb01f766835` |
| Old Spaghetti Factory | `9411da161c5582c9384078da84b413574f60774d5e93968c07f13d67ccdfc020` |

Run the same discovery commands into new directories, or use the [offline replay commands](../README.md#run) to reproduce extraction from these exact bytes.
The three canonical result directories are `wahoos/`, `claim-jumper/`, and `old-spaghetti-factory/`.
Earlier `*-attempt-1/` directories retain the actual discovery/parse attempt history and are not final results.
The corrected parser also preserves digit-prefixed names such as Claim Jumper's `3 Layer Chocolate Motherlode Cake`, preventing its nutrients from being combined with the next item name.
