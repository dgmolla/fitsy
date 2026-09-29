# Local delivery dispatcher

The GitHub project is the only delivery queue.
An issue is eligible when it is Queued, priority Now or Next, labeled `dispatch-ready`, lacks `dispatch-hold`, and every strict `#ID` dependency is Done on the same board.
Readiness starts at the label event or first observation when historical event time is unavailable.

One local host holds an exclusive file lock and writes a durable claim before touching the board or starting a worker.
A claim snapshots the issue acceptance, implementation provider/model/effort, independent reviewer settings, advisory classifier response, and process identity.
The worker uses a fresh Git worktree and follows the existing shipping gates and review budget.
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
The delete intent also binds archived build and report proof so an interrupted deletion can finish its receipt even if the checkout changes afterward.
The private retirement receipt records the source-to-archive mapping, checks, and measured free space, while incomplete or blocked claims retain their devices.
The scan rotates past held devices, and a durable delete intent lets the next tick reconcile an interrupted deletion without guessing that an absent device was retired.
If a held device outlives the bounded in-memory history, the dispatcher resolves its exact verified claim from the durable claim receipt.
This deliberately retains all raw attachments, including files not referenced by the final report, so retirement does not also become an evidence-pruning policy.
