export const evidenceModes = ['development', 'final-candidate', 'requested-video'];

export function evidenceMode(value = 'development', requestedRecording = false) {
  if (!evidenceModes.includes(value)) throw new Error(`Unknown evidence mode ${value}; use development, final-candidate, or requested-video`);
  return { name: value, recordVideo: requestedRecording || value === 'requested-video', publishable: value === 'final-candidate' };
}

export function runSelection(args) {
  const [udid, ...rest] = args;
  const modes = rest.filter(arg => arg.startsWith('--mode='));
  const recording = rest.filter(arg => arg === '--record-video');
  if (modes.length > 1) throw new Error('Pass exactly one --mode option');
  if (recording.length > 1) throw new Error('Pass --record-video at most once');
  if (rest.some(arg => arg.startsWith('--') && !arg.startsWith('--mode=') && arg !== '--record-video')) throw new Error('Unknown run option');
  const mode = evidenceMode(modes[0]?.slice('--mode='.length), recording.length === 1);
  return { udid, names: rest.filter(arg => !arg.startsWith('--mode=') && arg !== '--record-video'), mode };
}

export function matchesFinalCandidate(report, { udid, appHash, configHash, backendDeployment, fixture, flows, recordVideo = false }) {
  const previousRecording = report?.videoRequested ?? (report?.flows?.length > 0 && report.flows.every(flow => flow.video && flow.videoHash));
  return report?.result === 'pass' && report.evidenceMode === 'final-candidate' &&
    Boolean(previousRecording) === recordVideo &&
    report.simulator === udid && report.appHash === appHash && report.configHash === configHash &&
    report.backendDeployment === backendDeployment && report.fixture === fixture &&
    Array.isArray(report.flows) && report.flows.length === flows.length &&
    report.flows.every((flow, index) => flow.name === flows[index].name && flow.sourceHash === flows[index].sourceHash);
}
