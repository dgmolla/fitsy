import { readFileSync } from 'node:fs';

export const evidenceModes = ['development', 'final-candidate', 'requested-video'];

export function readPreviousReportForReuse(file) {
  try { return { report: JSON.parse(readFileSync(file, 'utf8')), error: null }; }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { report: null, error: `invalid JSON in prior report: ${error.message}` };
  }
}

export function evidenceMode(value = 'development', requestedRecording = false) {
  if (!evidenceModes.includes(value)) throw new Error(`Unknown evidence mode ${value}; use development, final-candidate, or requested-video`);
  return { name: value, recordVideo: requestedRecording || value === 'requested-video', publishable: value === 'final-candidate' };
}

export function runSelection(args) {
  const [udid, ...rawRest] = args;
  // #860: same opt-in, auditable contract as publish-product-flow.mjs -
  // never default-on, both required together.
  const reasonIndex = rawRest.indexOf('--reason');
  const skipBillingReason = reasonIndex === -1 ? undefined : rawRest[reasonIndex + 1];
  const rest = reasonIndex === -1 ? rawRest : [...rawRest.slice(0, reasonIndex), ...rawRest.slice(reasonIndex + 2)];
  const modes = rest.filter(arg => arg.startsWith('--mode='));
  const recording = rest.filter(arg => arg === '--record-video');
  const exceptions = rest.filter(arg => arg.startsWith('--release-exception='));
  const noRetry = rest.filter(arg => arg === '--no-environment-retry');
  const skipPersonas = rest.filter(arg => arg === '--skip-billing-personas');
  if (modes.length > 1) throw new Error('Pass exactly one --mode option');
  if (recording.length > 1) throw new Error('Pass --record-video at most once');
  if (exceptions.length > 1 || (exceptions.length && exceptions[0] !== '--release-exception=6716597294'))
    throw new Error('Unknown or repeated native release exception');
  if (noRetry.length > 1) throw new Error('Pass --no-environment-retry at most once');
  if (skipPersonas.length > 1) throw new Error('Pass --skip-billing-personas at most once');
  if ((skipPersonas.length === 1) !== (reasonIndex !== -1)) throw new Error('--skip-billing-personas requires --reason "<text>"');
  if (rest.some(arg => arg.startsWith('--') && !arg.startsWith('--mode=') &&
      !arg.startsWith('--release-exception=') && !['--record-video', '--no-environment-retry', '--skip-billing-personas'].includes(arg)))
    throw new Error('Unknown run option');
  const mode = evidenceMode(modes[0]?.slice('--mode='.length), recording.length === 1);
  return { udid, names: rest.filter(arg => !arg.startsWith('--')), mode,
    approvalId: exceptions[0]?.slice('--release-exception='.length), environmentRetryAllowed: !noRetry.length,
    skipBillingPersonas: skipPersonas.length === 1, skipBillingReason };
}

export function matchesFinalCandidate(report, { udid, appHash, configHash, backendDeployment, fixture, flows, recordVideo = false }) {
  const previousRecording = report?.videoRequested ?? (report?.flows?.length > 0 && report.flows.every(flow => flow.video && flow.videoHash));
  return report?.result === 'pass' && report.evidenceMode === 'final-candidate' &&
    Boolean(previousRecording) === recordVideo &&
    report.simulator === udid && report.appHash === appHash && report.configHash === configHash &&
    report.backendDeployment === backendDeployment && report.fixture === fixture &&
    Array.isArray(report.flows) && Array.isArray(flows) && flows.length > 0 &&
    new Set(report.flows.map(flow => flow?.name)).size === report.flows.length &&
    new Set(flows.map(flow => flow?.name)).size === flows.length &&
    flows.every(flow => flow?.name && flow.sourceHash && report.flows.some(previous =>
      previous?.name === flow.name && previous.sourceHash === flow.sourceHash));
}
