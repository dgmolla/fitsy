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

The driver executes fixed host commands outside candidate Codex's sandbox.
Set the host's existing `FITSY_XCTEST_SIM_UDID` to an explicitly owned compatible device.
Prepare a clean merge-base checkout and set optional `FITSY_LOOP_MAIN_CHECKOUT` for differential replay.
Use the canonical backend resolver so Metro, fixtures and Maestro target the PR's Ready preview where required.
Keep `dev.fitsy.org` pinned to `dev`.
Every simulator command must hold `lockf -t 3600 ~/fitsy-refactor/loop/sim.lock`.
Native repairs need a real local Maestro pass before push; never remove or skip assertions to obtain it.
The driver attaches failure screenshots or extracted video frames through Codex's image argument and includes failing commands, logs, diff and prior outcomes in the prompt.

Task frontmatter requires `branch`, `title`, a closing `---` and a body.
Legacy metadata followed by `---` remains supported.
Put human ordering notes under `tasks/notes/`; both planner prompts and driver ordering consume them.
Use `#583 BEFORE #547` or `order: #608 > #583 > #547` for deterministic ordering among eligible tasks.

Park with a concrete condition such as `PR#587`, `check:Simulator` or `env:api-config`.
Re-triage every fifteen minutes or when main advances.
Only changed evidence or a resolved dependency/check can requeue work, with three requeues per rolling day.
Reset active repair counters on unpark and retain additive historical attempts.
Parking comments go to the PR and issue once per episode; failed publication stays pending for the same owner.
Human or release approval boundaries remain unchanged.

Run `python3 -B scripts/delivery/loop/loop.test.py` after any recovery-policy change.
Install the reviewed source using `python3 scripts/delivery/loop/install.py --directory ~/fitsy-refactor/loop --apply` at an idle owner restart.
The default command only plans the installation.
The installer preserves state and evidence, backs up old entrypoints and refuses an active or uncertain owner.
Verify `source-receipt.json` and replay the actual compatibility entrypoint before reporting adoption.
The canonical verifier runs this behavior suite through `scripts/verify/test.sh`; focused selection uses the same Python test runner.
