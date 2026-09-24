export const evidenceModes = ['development', 'final-candidate', 'requested-video'];

export function evidenceMode(value = 'development') {
  if (!evidenceModes.includes(value)) throw new Error(`Unknown evidence mode ${value}; use development, final-candidate, or requested-video`);
  return { name: value, recordVideo: value !== 'development', publishable: value === 'final-candidate' };
}

export function runSelection(args) {
  const [udid, ...rest] = args;
  const modes = rest.filter(arg => arg.startsWith('--mode='));
  if (modes.length > 1) throw new Error('Pass exactly one --mode option');
  if (rest.some(arg => arg.startsWith('--') && !arg.startsWith('--mode='))) throw new Error('Unknown run option');
  const mode = evidenceMode(modes[0]?.slice('--mode='.length));
  return { udid, names: rest.filter(arg => !arg.startsWith('--mode=')), mode };
}

export function matchesFinalCandidate(report, { udid, appHash, configHash, backendDeployment, fixture, flows }) {
  return report?.result === 'pass' && report.evidenceMode === 'final-candidate' &&
    report.simulator === udid && report.appHash === appHash && report.configHash === configHash &&
    report.backendDeployment === backendDeployment && report.fixture === fixture &&
    Array.isArray(report.flows) && report.flows.length === flows.length &&
    report.flows.every((flow, index) => flow.name === flows[index].name && flow.sourceHash === flows[index].sourceHash);
}
