// #1092: the flags a native run was started with (skip billing personas, excluded flows, walkthrough waiver and the reason) are recorded in
// its report, and finish, check and publish inherit them when none are passed. Forgetting the flags on a later command (an unquoted shell
// variable dropped them for #839) used to fail late or force a whole second native run. Explicit flags still win, so a waiver can be applied
// to an unwaived run, and with nothing recorded and nothing passed the walkthrough stays required.
const active = selection => Boolean(selection && (selection.skipBillingPersonas || (selection.excludeFlows || []).length || selection.waiveWalkthrough));
const normalize = selection => ({
  skipBillingPersonas: Boolean(selection?.skipBillingPersonas),
  skipBillingReason: typeof selection?.skipBillingReason === 'string' ? selection.skipBillingReason : undefined,
  excludeFlows: [...(selection?.excludeFlows || [])],
  waiveWalkthrough: Boolean(selection?.waiveWalkthrough),
});

export const recordedRunSelection = normalize;

export function resolveSelection(explicit, recorded) {
  if (active(explicit)) return normalize(explicit);
  // A recorded selection needs the reason the run was validated with; without one it cannot be applied.
  if (active(recorded) && typeof recorded.skipBillingReason === 'string' && recorded.skipBillingReason.length > 0) return normalize(recorded);
  return normalize(explicit);
}

// The selection recorded in a report may only be inherited by the candidate that report belongs to (review of #1094): a stale report on disk
// must never narrow acceptance for a different candidate. It has to be a final-candidate report, for the same source hash, with a completed
// result, and preflight (which plans a run that has not happened yet) never inherits.
export function selectionFromReport(report, { currentInputHash, preflight = false } = {}) {
  if (preflight || !report || report.evidenceMode !== 'final-candidate') return undefined;
  if (!currentInputHash || report.inputHash !== currentInputHash) return undefined;
  if (!['pass', 'awaiting-walkthrough'].includes(report.result)) return undefined;
  return report.runSelection;
}
