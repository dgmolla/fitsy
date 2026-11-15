import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function classifySimulatorFailure(error) {
  // Assertions, unknown failures, watchdogs and lost ownership stay failures.
  // Only positive infrastructure evidence permits a replay.
  if (/source changed|configuration changed/i.test(error?.message || '')) return 'code';
  if (error?.cleanupError || /interrupt|ownership/i.test([error?.message, error?.reason].join(' '))) return 'environment';
  const diagnostic = [error?.code, error?.message, error?.diagnostic, error?.reason].filter(Boolean).join('\n');
  return /\b(?:ENOSPC|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|kAXErrorInvalidUIElement)\b|CoreSimulator[^\n]*(?:unavailable|connection (?:lost|invalid))|(?:simulator|device)[^\n]*(?:not booted|not available)|XCTest[^\n]*(?:hierarchy unavailable|connection lost)|Local fixture .+ is required|Dev Supabase configuration is required|Metro[^\n]*(?:not ready|unavailable|not running)/i.test(diagnostic)
    ? 'environment' : 'code';
}

export function maestroFailure(message, result, failedCommand) {
  return Object.assign(new Error(message), { diagnostic: failedCommand?.error || result.error,
    reason: result.reason, cleanupError: result.cleanupError });
}

export async function withEnvironmentRetry(action, { dir, signal, canRetry = () => true }) {
  mkdirSync(dir, { recursive: true });
  const attempts = [];
  const save = () => writeFileSync(join(dir, 'attempts.json'), JSON.stringify(attempts, null, 2) + '\n');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const evidence = attempt === 1 ? dir : join(dir, 'attempt-2');
    mkdirSync(evidence, { recursive: true });
    try {
      const value = await action(evidence, attempt);
      attempts.push({ attempt, status: 'pass', evidence }); save();
      return value;
    } catch (error) {
      const classification = classifySimulatorFailure(error);
      const row = { attempt, status: 'fail', classification, evidence, summary: error.message, retry: false };
      attempts.push(row); save();
      error.environmentRetries = attempts.filter(row => row.retry).length;
      if (attempt === 2 || classification !== 'environment' || error.cleanupError || /interrupt|ownership/i.test([error.message, error.reason].join(' ')) || signal?.aborted || !await canRetry()) throw error;
      row.retry = true; save();
      console.error(`Simulator environment failure; retrying once. First attempt retained in ${evidence}`);
    }
  }
}

// #888: collect every flow's failure in one pass instead of stopping at the
// first, so one run surfaces everything. Categories (by where the flow failed,
// since an app regression and a stale test cannot be told apart automatically):
//   environment - simulator/infrastructure; later flows would only cascade, so they are not run
//   fixture     - setup before Maestro started (journey, billing/entitlement, Metro, store)
//   flow        - a Maestro command failed: app regression or stale test, a human/agent decides
//   harness     - the runner's own checks after the flow finished
const STAGE_CATEGORY = { preparation: 'fixture', flow: 'flow', 'post-flow': 'harness' };
export function classifyFlowFailure(error) {
  if (classifySimulatorFailure(error) === 'environment') return 'environment';
  return STAGE_CATEGORY[error?.stage] || 'flow';
}
export async function collectFlowFailures(flows, runFlow) {
  const failures = [], notRun = [];
  for (const [index, flow] of flows.entries()) {
    try { await runFlow(flow); }
    catch (error) {
      const classification = classifyFlowFailure(error);
      failures.push({ flow: flow.name, classification, stage: error?.stage || null,
        summary: String(error?.message || error).split('\n')[0].slice(0, 300), error });
      if (classification === 'environment') { notRun.push(...flows.slice(index + 1).map(item => item.name)); break; }
    }
  }
  return { failures, notRun };
}
export const flowFailuresSummary = ({ failures, notRun }) =>
  ({ version: 1, failures: failures.map(({ error, ...row }) => row), notRun });
// One failure keeps its original error (cleanup/diagnostic fields intact); several
// become a single error listing each flow and its category.
export function flowFailuresError(collected) {
  if (collected.failures.length === 1 && !collected.notRun.length) return collected.failures[0].error;
  const lines = collected.failures.map(item => `- ${item.flow} [${item.classification}]: ${item.summary}`);
  if (collected.notRun.length) lines.push(`Not run after an environment failure: ${collected.notRun.join(', ')}`);
  return Object.assign(new Error(`${collected.failures.length} flows failed:\n${lines.join('\n')}`),
    { flowFailures: flowFailuresSummary(collected) });
}
