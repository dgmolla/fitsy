# Chain catalog reconciliation

<!-- Generated from the immutable full production audit. -->

**Every existing row with a currently approved exact match is wired consistently.**
The September 13 production audit checked all 59 active stored chain identities, including the earlier WaBa/Yoshinoya rollout.

| Check | Result |
|---|---:|
| Restaurants checked | 1,365 |
| Existing menu rows checked | 131,664 |
| Approved facts in the catalog | 1,958 |
| Approved exact matches | 40,505 |
| Consistent matched rows | 40,505 |
| Inconsistent or ambiguous matches | 0 |
| Restaurant identity holds | 0 |
| Rows without an approved exact match | 91,159 |

The audit compared each match's official facts, approval proof, official estimate, winning estimate, and stored serving macros.
The matches comprise 39,847 rows from the [completed batches](chain-production-rollout-2026-09-12.md) plus 658 from the earlier WaBa/Yoshinoya work.
Counts include attribution-only updates and do not mean every row's numeric values changed.

The remaining 91,159 rows need additional facts or a defensible item-and-serving match.
This audit proves consistency against the current catalog; it does not establish complete chain coverage or measured restaurant nutrition.
It used the released runtime in a read-only, repeatable-read transaction and added no hexes.
Its [receipt](chain-catalog-reconciliation-2026-09-13.json) records the audit time, totals and full evidence hash.
