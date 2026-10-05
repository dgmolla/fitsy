# Local delivery dispatcher

The GitHub project is the only delivery queue.
An issue is eligible when it is Queued, priority Now or Next, labeled `dispatch-ready`, lacks `dispatch-hold`, and every strict `#ID` dependency is Done on the same board.
Readiness starts at the label event or first observation when historical event time is unavailable.

One local host holds an exclusive file lock and writes a durable claim before touching the board or starting a worker.
A claim snapshots the issue acceptance, implementation provider/model/effort, independent reviewer settings, advisory classifier response, and process identity.
A first claim creates an owned Git worktree; an authorized same-issue successor reuses the latest ended checkout and branch after fresh registration, terminal-receipt, process/group, open-file and source-identity checks.
Tracked and untracked unfinished work stay in place, and the new claim records its creation claim, predecessor and exact resume identity.
An uncertain retained checkout parks preparation rather than making a second dependency environment.
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
