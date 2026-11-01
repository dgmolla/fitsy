---
name: loop-recovery
description: Diagnose and recover a stopped Fitsy loop task through its existing host owner without weakening delivery gates.
---

# Recover the existing loop

Use this procedure when the existing loop records an environment failure, exhausted repair strategy or parked task.
Keep its current host owner, state, evidence and two delivery lanes.
Do not start a second dispatcher or scheduler.

Read `state.json`, the affected task, its parking comment and source-bound simulator artifacts before acting.
The driver triages errors before code repair; an `error` status, missing API configuration, low disk or unbooted simulator belongs to host recovery.
Assess the installed `verify-fitsy` skill for simulator/backend recovery and `cleanup-agent-resources` for measured disk or memory pressure.
Use available service connectors or the existing network-enabled owner for external configuration; do not widen the candidate sandbox or expose credentials.
If worker permissions exclude CoreSimulator, databases or the live loop, finish the concrete source repair and tests locally and leave installation/replay with that same host owner.
The canonical media gate also requires host process ownership inspection with `ps`.
If that inspection is denied, retain the failed check and source identity, then have the existing authorized host owner run `bash scripts/verify/media-integration.sh` against the same candidate.
Do not replace the gate's receipt with a manual pass or rerun it in the unchanged restricted worker.
Retain the concrete blocker, selected skill/tool, attempted recovery and next action in the task's existing evidence.

Install reviewed recovery controls and their imports outside every candidate's writable roots before starting workers.
The installer freezes the canonical simulator controls, policy files and JavaScript dependencies alongside the Python driver.
It records canonical dependency directories in the installed `controls/dependency-roots.json` before workers start and refuses linked installation directories.
Candidate dependency links may resolve only within their workspace or to those exact recorded roots; a missing manifest requires reviewed reinstallation, never a candidate-derived grant.
Privileged backend selection runs only that installed snapshot, with core environment and Vercel authentication; it never evaluates candidate JavaScript or inherits startup selectors.
Coverage selection runs only installed controls and treats candidate source as data.
Native replay uses the installed controls with an explicit DEV environment and an enforced macOS sandbox, including every Metro, Expo and fixture child.
Deployment metadata reaches native checks through a read-only local adapter; GitHub, deployment, production database and provider credentials stay outside candidate execution.
Keep host fixture configuration outside candidate writable roots; a candidate-owned file cannot grant access to additional host paths.
The sandbox denies host credential files, other processes' environments, Keychain access and writes outside the owned DEV workspace and simulator resources.
Atomic simulator claims stage only `.fitsy-sim-claim.json.<random>.tmp` in HOME, on the claim's filesystem.
The profile permits those staging names and read access to the HOME directory for fsync; it does not grant access to HOME's other files.
An unavailable sandbox is an environment error with no unsandboxed fallback; use the existing host owner for the exact-source replay.
The canonical host media lane exercises credential-file, dotenv, dependency-link and child-process isolation plus actual simulator claim, renewal and release before writing its source-bound receipt.
Model workers receive only core environment variables and Codex provider authentication, matching `local-dispatcher.py`'s worker allowlist.
Set the host's existing `FITSY_XCTEST_SIM_UDID` to an explicitly owned compatible device.
Prepare a clean merge-base checkout and set optional `FITSY_LOOP_MAIN_CHECKOUT` for differential replay.
Use the canonical backend resolver so Metro, fixtures and Maestro target the PR's Ready preview where required.
Keep `dev.fitsy.org` pinned to `dev`.
Every simulator command must hold `lockf -t 3600 ~/fitsy-refactor/loop/sim.lock`.
Native repairs need a real local Maestro pass before push; never remove or skip assertions to obtain it.
Every push entrypoint reselects native coverage for changed source, including general review fixes, conflict resolution and hook repairs, independently of simulator attempt counters.
Host Git operations, including commit and merge preparation, use the installed owner's private hook directory outside candidate writable roots.
That hook runs both canonical pre-push verifier selections inside the same enforced isolation with allowlisted DEV configuration.
Never execute the candidate hook or verifier with host credentials, skip either required selection, or fall back to unsandboxed verification.
Only trusted scope `none` permits publication without native execution; a pending failed journey still requires a real replay.
Keep validation bound to the current source after requeue, merges and hook repairs.
The driver attaches failure screenshots or extracted video frames through Codex's image argument and includes failing commands, logs, diff and prior outcomes in the prompt.

Task frontmatter requires `branch`, `title`, a closing `---` and a body.
Legacy metadata followed by `---` remains supported.
Put human ordering notes under `tasks/notes/`; both planner prompts and driver ordering consume them.
Use `#583 BEFORE #547` or `order: #608 > #583 > #547` for deterministic ordering among eligible tasks.

Branch preparation and terminal cleanup use the installed `worktrees.py` helper through `execute_task`.
Hold its branch lease across preparation, execution and cleanup so the two lanes cannot reuse one branch concurrently.
Discover the fetched origin branch and open same-repository PR even when task headers omit `existing` and `pr`; adopt the PR, preserve local commits and merge main without resetting any branch.
An unavailable GitHub lookup stops preparation rather than establishing that a branch is new.
Remove clean loop-owned holders of the branch or its legacy `loop/` alias before a successor starts and after merged, blocked or errored execution.
Only the untracked regular root `.infra-blocked` marker is disposable; retain tracked changes, other untracked or ignored files, linked markers, unfinished Git operations, locked checkouts and active workers, and report the concrete path.
Keep branch refs and external evidence; a removed parked checkout is recreated for current-head re-triage before main is merged for implementation.
This explicit task-lifecycle cleanup is separate from historical resource cleanup and its four-hour cutoff.
For missing dependencies in a restricted worker, use the [documented same-lock installation recovery](../../../docs/engineering/devops/performance.md#restricted-worker-recovery) without changing peer policy or the lockfile.

Park with a concrete condition such as `PR#587`, `check:Simulator`, `env:api-config` or `env:preparation`.
Re-triage every fifteen minutes or when main advances.
Only changed evidence or a resolved dependency/check can requeue work, with three requeues per rolling day.
Environment re-triage runs one bounded host replay of the current PR head so a stale Simulator error cannot hide repaired dependencies.
Bind failed replays to unchanged source and the observed PR head as well as passing replays.
Merge fresh assertion status, flow, media and logs into retained evidence before reclassifying and requeueing.
Recheck the merge-base before authorizing code repair, and consume retained replay evidence only while its head and source still match.
Before collecting evidence, fast-forward a clean owned checkout to the observed PR head and verify its identity.
Preserve dirty and unpublished divergent work; record the prerequisite failure and retry interval instead of replaying an old head or discarding edits.
Preparation failures retry the bounded fetch and checkout setup from the existing `wt3` checkout before resolving a task HEAD, including legacy parks without a worktree.
Only successful preparation clears that blocker; failed prerequisites retain the retry interval and rolling requeue cap.
An empty host replay response is an environment error with its exit code and redacted stderr; it must not stop recovery for other tasks.
An unavailable merge-base comparison parks on `baseline`; preparing the checkout permits periodic re-triage without requiring main to advance.
Reset active repair counters on unpark and retain additive historical attempts.
Parking comments go to the PR and issue once per episode; failed publication stays pending for the same owner.
Read worker `.infra-blocked` diagnoses through a bounded, nonblocking, no-follow descriptor and accept only regular files with one link.
Linked or nonregular markers produce a fixed rejection diagnosis without reading or publishing their contents.
Human or release approval boundaries remain unchanged.

Record shipping lessons in [the existing domain document](../../../docs/engineering/devops/shipping-lessons.md); do not create files directly under `docs/`.
Run `node scripts/verify/run.mjs --only=structural --scope=changed --runs=local` after documentation changes before the ordinary pre-push verification.

Run `python3 -B scripts/delivery/loop/loop.test.py` after any recovery-policy change.
Run `python3 -B scripts/delivery/loop/worktrees.test.py` for the real Git branch and terminal-cleanup journeys.
Run `python3 -B scripts/delivery/loop/open_prs.test.py` for open-PR ownership, update, merge, conflict-task and pacing behavior.
Install the reviewed source and load its LaunchAgent using `python3 scripts/delivery/loop/install.py --directory ~/fitsy-refactor/loop --apply` at a stopped owner boundary.
The default command only plans the installation.
The installer preserves state and evidence, backs up old entrypoints and refuses source changes under an active or uncertain owner; repeating an unchanged installation is safe.
Verify `source-receipt.json` and replay the actual compatibility entrypoint before reporting adoption.
The canonical verifier runs all three behavior suites through `scripts/verify/test.sh`; focused selection uses the same Python test runner.

For an empty queue or unexpected driver exit, follow [driver lifecycle and LaunchAgent installation](../../../docs/engineering/devops/loop-driver.md).
The installed `lifecycle.py` idles for three minutes and re-scans even with planning disabled or unavailable.
The installed `open_prs.py` sweeps recorded original-task PRs every three minutes, including finished or parked originals, while leaving active branch leases with their workers.
Require matching branch and persisted PR number plus a creation marker or legacy PR-creation log event; an adopted PR is ineligible.
Preserve the existing check-failure, simulator and GitHub merge gates, and retain one pending or blocked existing-branch conflict follow-up per PR.
Install the helper with the driver through the frozen source installer; do not run candidate-controlled sweep code with host credentials.
`STOP`, `SIGINT` and `SIGTERM` stop new dispatch, drain current workers under the owner lock and exit zero.
Merged loop runtime changes request installation through both merge paths, drain workers under the owner lock, sync fetched main and exit 75 for the LaunchAgent to restart the original entrypoint.
Self-install preserves the frozen controls and dependency grants; use manual reviewed installation for changes to those controls outside the loop directory.
On installation failure, retain the pending request and its logged cause; the scheduler retries after three minutes while normal task dispatch continues.
Use the source installer's one-command LaunchAgent setup; verify its PID, idle log and later task pickup through the original entrypoint.
Retire the old restart command at that owner boundary, keep both log streams in `loop/driver.log`, and preserve clean stops and all merge gates.
