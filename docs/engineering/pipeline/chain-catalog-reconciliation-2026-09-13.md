# Chain catalog reconciliation

**Every existing menu row with a currently approved exact match is wired consistently.**
A read-only production audit on September 13 checked all 56 active stored chain identities, including the earlier WaBa/Yoshinoya rollout.

| Check | Result |
|---|---:|
| Restaurants checked | 1,297 |
| Existing menu rows checked | 124,576 |
| Approved facts in the catalog | 1,859 |
| Menu rows with an approved exact match | 39,169 |
| Matched rows consistent with the current approval | 39,169 |
| Unwired or inconsistent matched rows | **0** |
| Ambiguous matches or restaurant identity holds | **0** |
| Rows without an approved exact match | 85,407 |

For every matched row, the audit compared the current official facts, approval proof, official estimate, winning estimate and stored serving macros.
The 39,169 matches comprise 38,511 rows from the [39 completed batches](chain-production-rollout-2026-09-12.md) plus 658 from the earlier WaBa/Yoshinoya work.
These counts include attribution-only updates; they do not mean every row's numeric values changed.

The remaining 85,407 rows need additional source facts or a defensible item-and-serving match.
They are outside the currently approved exact bindings, so this audit does not authorize replacing their estimates.
A separate fresh inventory found no unlinked restaurants that already satisfy the qualified exact brand-identity rules.

The audit used the released regional matcher at `e805ee2c63ec4e0f19563c6b8ff9fc4a8a3c121d` in a read-only, repeatable-read database transaction.
It made no production changes and added no hexes.
Its [machine-readable receipt](chain-catalog-reconciliation-2026-09-13.json) records the snapshot, totals and full audit hash.

This proves consistency and completion against the current catalog.
Published sources and approved serving assumptions remain the reference; the audit does not measure actual prepared portions or establish complete chain-menu coverage.
The earlier batch reports retain authenticated API verification and local new-hex replay evidence.
