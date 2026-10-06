# Local delivery dispatcher

The GitHub project is the only delivery queue.
An issue is eligible when it is Queued, priority Now or Next, labeled `dispatch-ready`, lacks `dispatch-hold`, and every strict `#ID` dependency is Done on the same board.
Readiness starts at the label event or first observation when historical event time is unavailable.

One local host holds an exclusive file lock and writes a durable claim before touching the board or starting a worker.
A claim snapshots the issue acceptance, implementation provider/model/effort, independent reviewer settings, advisory classifier response, and process identity.
A first claim creates an owned Git worktree; an authorized same-issue successor reuses the latest unfinished ended checkout and branch after fresh registration, terminal-receipt, process/group, open-file and source-identity checks.
Tracked and untracked unfinished work stay in place, and the new claim records its creation claim, predecessor and exact resume identity.
An uncertain retained checkout parks preparation rather than making a second dependency environment.
Durable claim receipts preserve discovery after the compact in-memory history rolls over.
The worker follows the existing shipping gates and unchanged issue-bound review history.
A live or uncertain worker retains the lane; a proven stopped worker without verified Done is parked with a reason so independent ready work may proceed.

Jev classification is advisory and cached by bounded issue content, model, prompt version and configured profiles.
Low-confidence answers remain unknown, and deterministic risk floors cannot be lowered.
Provider errors fall back deterministically; neither Jev nor issue text can choose executable commands or alter review gates.
The current default implementation profile is Codex with Sol; a trusted configuration can select the supported Claude adapter for a future claim.

The installer starts paused from a clean, current main revision.
Enabling requires that revision's main Verify and Deploy success and no active claim.
The dispatcher posts actionable blocker incidents through the shared Slack limiter with a stable key, history reconciliation and confirmed receipt.
It does not publish the periodic digest.

Before admitting the next claim, an idle dispatcher makes one bounded simulator-retirement attempt for a terminal-verified issue.
The exact claim checkout, build receipt, passing product-flow report, exported app digest, and device UDID must agree; a dedicated device name alone proves nothing.
The report must match the checkout's current source and build recipe, and Metro-dependent Test Store builds keep their devices because their exported app cannot run by itself after Metro stops.
The device must be shut down, unclaimed, and free of open files or referencing processes, including processes working from the claim checkout.
Simulator CLI commands and retirement share the local claim lock through the final owner check and exact device deletion.
Every raw XCTest attachment is cloned outside the device and hash-checked before `simctl delete` names that one device; the shared runtime and exported app remain.
An interrupted pre-delete copy is rebuilt from the still-present device and checked before the mapping is committed.
The delete intent also binds archived build and report proof so an interrupted deletion can finish its receipt even if the checkout changes afterward.
The private retirement receipt records the source-to-archive mapping, checks, and measured free space, while incomplete or blocked claims retain their devices.
The scan rotates past held devices, and a durable delete intent lets the next tick reconcile an interrupted deletion without guessing that an absent device was retired.
An absent simulator listing remains retryable until the directory is also gone and a matching durable deletion intent proves retirement.
If a held device outlives the bounded in-memory history, the dispatcher resolves its exact verified claim from the durable claim receipt.
This deliberately retains all raw attachments, including files not referenced by the final report, so retirement does not also become an evidence-pruning policy.
A simulator with no InternalDaemon attachment directory has an empty raw inventory and remains eligible when its other proofs pass.

## Resource lifetime and admission

Before admitting another owner, the idle dispatcher assesses one ended claim's compiler scratch under dispatcher.lock.
It removes only owned inactive compiler intermediates and module/compiler/SDK/API caches; retained app products, source, raw reviews/logs, screenshots, receipts and budget history remain.
Exact removal intent and completion paths, original issue/claim and host free bytes persist in resource_releases without rewriting original failure receipts.
An ownership failure records a deferred assessment and a concrete next action rather than repeatedly searching the same exhausted candidate.
A persisted deletion intent is reconciled on the next idle tick with fresh terminal-receipt and path/process/open-file checks; an already absent output is recorded as uncertain reconciliation, not a newly measured deletion.
Retention assessments persist even when disk admission returns a hold.

Admission preserves min_free_bytes plus scratch_reserve_bytes.
The default floor remains 8 GiB and the initial configurable reserve is 4 GiB.
The reserve is a provisional allowance motivated by recent floor flapping, not an attributed peak-growth measurement or a guarantee; replace it with measured owner-specific demand when available.
This check does not interrupt an owner already running.

The configurable resource_ttl_seconds policy separates expiration from permission to discard data.
Known owner execution/release and explicit owner/action leases supply its clock; polling and filesystem atime do not renew it.
Legacy timestamps missing from trusted receipts remain unknown and require ownership backfill.

| Resource | Default expiration | Result after fresh ownership checks |
| --- | --- | --- |
| Rebuildable compiler scratch | Ended worker release | Remove inactive exact outputs, retaining app/evidence |
| Integrated, unreferenced terminal checkout | 24 hours after release | Evidence-preserving retirement assessment |
| Paused or unfinished checkout | 72 hours after release | Cold-retention assessment; preserve source, branch and dirty contents |
| Dependency donor | 7 days after its last live consumer releases | Assess rebuildable dependencies; resolve consumer liveness transitively |
| Booted task simulator | 30 minutes after owner release | Assess shutdown only; preserve an active owner or explicit near-term lease |
| Explicit near-term device lease | 24 hours since actual owner use | Reassess planned owner/action; no indefinite polling renewal |
| Inactive owned task simulator | 7 days after release | Existing source-bound evidence-preserving retirement policy |
| Compatible native build cache | 7 days since actual owner use | Assess eviction within build_cache_max_bytes, default 4 GiB; queued pinned apps remain protected |
| Required screenshots, raw reviews and receipts | 30 days since actual owner use | Verified retrievable cold archive; never automatic TTL purge |

The dispatcher records bounded checkout retention assessments and enforces the seven-day device grace before the existing retirement operator.
Other expired resources are explicit assessment actions for the coordinator and existing operators, not blanket deletion loops.
Incoming dependency links protect a donor only through a chain ending in a known live consumer; a historical idle checkout's link alone does not establish current execution.
No source, dirty work, user-owned device, queued pinned app or required historical evidence becomes disposable solely through age.

Paused runtime updates are separate from worker admission.
The installer atomically copies the small reviewed scripts under dispatcher.lock with enough free bytes for the update and reports available and required worker capacity.
It can install recovery code during a resource hold without lowering the worker floor or admitting work.
The installer binds an absolute ownership-tool path, pauses the previous runtime identity, verifies each installed file digest, and publishes the new identity last.
Enabling checks those digests so interrupted or mixed runtime updates remain disabled until reinstalled.
Enable reports resource-hold explicitly when headroom is insufficient; the existing tick still forbids launching any worker below floor plus reserve.
Active claims continue to prevent installation or enabling.

Checkout creation records its exact path and branch intent before invoking Git.
Crash recovery archives that intent with the terminal time and reuses an already-created checkout after the same source and ownership checks.
An intent that created neither a registered checkout nor a branch can retry without inventing retained source.

The shared-lock simulator CLI records exact device use intent before commands and completed use only after successful commands.
The durable device registry survives claim release, and claim renewal preserves the devices used by that owner.
Status polling and denied commands do not renew resource clocks.
Device retirement reevaluates the latest actual owner-use and release clocks under the shared simulator lock immediately before deletion.
Missing legacy clocks or an interrupted pending command retain the device for evidence-based backfill rather than guessing age from an older worker's completion time.

The canonical product-flow runner hands its explicit selected UDID to use-intent after claiming and records completed use after an identified native build or successful install.
Both events run through the existing shared-lock CLI; completion requires an intent under the same active owner claim.
The native lease covers the configured worker wall-clock budget plus five minutes for completion and release, so a permitted phase cannot outlive a shorter fixed lease.
A failed or interrupted runner leaves uncertain intent protected for backfill.
Screenshot and log commands respect another active owner before attributing device use.

Completed named-owner commands without a claim have a bounded command release clock under the same lock.
Anonymous activity remains uncertain and cannot establish task ownership for deletion.
Only renewal of an unexpired same-owner claim retains its session devices; expired claim/release without execution cannot restart a device grace period.
Compiler cleanup scans the whole retained checkout and the exact scratch path immediately before removal, retaining outputs when another process holds source or ownership is uncertain.

Simulator claim updates use atomic fsync and replacement under the existing shared lock.
A malformed legacy claim remains unchanged and blocks device commands with an explicit owner-reconciliation action; corrupt metadata never proves the device is free.
The coordinator preserves its raw bytes, checks live task ownership and command evidence under the existing locks, and restores a verified claim or retires only a positively ended owner claim.

Tick admission rereads and validates the installed configuration inside dispatcher.lock, so a completed installer pause wins over an earlier enabled snapshot.
Device completion consumes one outstanding owner-bound intent; retries without another actual action cannot renew its use clock.

## Pressure recovery and cold checkout retirement

The cleanup high watermark defaults to 20 GiB and never falls below the worker floor plus scratch reserve.
The unchanged 8 GiB floor plus 4 GiB reserve controls worker admission; the 20 GiB target begins recovery early rather than admitting marginal workers.
At the existing idle tick, the dispatcher assesses one superseded ended checkout before returning any resource hold.
Below the high watermark, a superseded checkout has a one-hour release grace by default; without pressure the default is 24 hours.
Configure cleanup_high_watermark_bytes and superseded_checkout_grace_seconds explicitly when needed; polling never renews owner-use or release clocks.
The latest unfinished checkout for each issue and resource_pinned_checkouts remain protected, along with active owners, incoming donor/artifact references and uncertain process/open-file ownership.
Configured pins resolve aliases and normalized absolute paths; malformed pin configuration retains the candidate.
An unreadable or non-object historical claim receipt records an exact deferred ownership assessment and disables destructive recovery for that tick while allowing otherwise eligible work through ordinary admission.
Original failed receipt bytes remain unchanged; a known successor still needs its exact valid predecessor receipt before reuse.
Completed mobile checkouts retain their hot proof paths until the existing issue-bound simulator retirement completes; missing or malformed build receipts alongside mobile evidence defer archival with a concrete reconciliation action.
The incoming-reference scan traverses nested dependency links without following symlinks and stops after incoming_reference_scan_seconds (30 seconds maximum/default).
A scan deadline or filesystem error preserves the checkout and records the unresolved assessment and next action; it never authorizes removal.
Before normal Git removal, private Gitbundle recovery and every source/environment/app/raw-evidence archive member must pass exact content verification.
Dirty or untracked source is retained in that verified archive; no original branch, terminal receipt, failure, review budget or UI approval is deleted or reset.
One immutable content-addressed source bundle serves covered recoveries instead of copying repository history into every archive.
Identical app files of at least 8 MiB use one private compressed recovery object with compressed and decoded hashes recorded in each manifest.
Restore those objects to their exact manifest paths and recorded file modes, then verify decoded hashes; a damaged object retains the next hot source and cannot satisfy completed-source recovery.
Original app binaries, screenshots and raw proof remain retrievable; only rebuildable Node/Pods are excluded from file archives.
Immediate ended-owner compiler cleanup now includes exact Index.noindex roots alongside compiler intermediates/module caches and API build cache.
Unknown ownership or unresolved file use persists a concrete deferred action; a retry never manufactures a removal or reclaimed-byte receipt.
Measured free bytes and archive overhead are recorded separately from APFS logical sizes.
This uses the existing dispatcher lock and timer; no additional worker, queue or reporting loop is created.

A latest verified completed checkout becomes eligible after its integrated-checkout TTL, default 24 hours, only when the current board and canonical terminal shipping proof still agree.
A local terminal label alone is insufficient.
Its simulator proof paths stay hot until the existing device retirement procedure completes; a disconnected or expired device alone cannot waive those gates.
If a completed issue is explicitly reopened, its new owner starts from current main and never overwrites the earlier accepted checkout or device proof.
An already cold-retired completed source also requires valid retained archive hashes before reopening; unfinished latest work continues to reuse its original checkout.
This never resets original issue budgets, histories, failures or source-bound approval receipts.

Incoming-reference protection recursively includes all registered Git consumer roots, the managed dependency store and explicit absolute resource_reference_roots.
Unavailable roots and scan deadlines preserve the candidate with an owned next action.
An ambiguous Git removal preserves its durable intent, checks all recovery identities and archived objects, and reconciles absence without another deletion or a new byte-gain claim.

Cold recovery preserves a private binary index.patch separately from working files and validates actual staged-source reconstruction before removal.
Restore that patch with git apply --cached at the retained source head before restoring working files; this retains independently staged and unstaged versions.
Legacy archives without verified index recovery remain unreconciled until original index state or explicit original clean-index proof is recovered; neither an absent path nor a valid working-file archive proves staged-source preservation.
Archive preparation budgets incompressible retained files, Git recovery copies, index data and a temporary-write margin before allocation.
Failed preparation removes only its unpublished attempt and temporary pack/object files while the original checkout remains; verified shared objects, archives and removal intents remain protected.
An unresolved merge index remains hot until complete Git-state recovery can be proven.

Superseded verified checkouts use the pressure grace, while the latest accepted checkout keeps the integrated-checkout TTL.
Device retirement walks durable verified claim generations, retaining the exact historical terminal receipt, merged PR and successful main checks plus current Done and owner-release evidence.
A later acceptance pointer cannot erase an older device retirement route, and current failed or reopened issue evidence still prevents retirement.

Unreadable durable ownership parks admission when that issue has a retained registered checkout; an older valid receipt for the same path cannot prove a damaged successor finished.
Already-authorized independent issues without a matching retained checkout remain dispatchable while the owner backfills the damaged metadata.


### Complete queue reads and quota cooldown

The canonical `snapshot` mode reads the same complete live GitHub queue as dispatch admission.
Use `python3 ~/.fitsy-dispatcher/runtime/local-dispatcher.py snapshot --config ~/.fitsy-dispatcher/config.json` for coordination instead of a separate broad project CLI query.
The transport pages at 100 cards and requests only delivery fields and issue labels; total counts, unique IDs and advancing cursors must agree before dispatch.
A truncated label connection fails closed so a hold cannot disappear through truncation.
The private `github-queue-quota.json` stores observed cost and quota reset timing, never board content or launch permission.
Rate exhaustion defers subsequent reads until the server reset, or a bounded 30-minute fallback when GitHub supplies no timing.
A reset requires a fresh complete read; partial GraphQL results never authorize a claim.
The existing timer retries after cooldown without an additional dispatcher or schedule.
