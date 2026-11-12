const SECRET_KEY = /password|token|secret/i;
const REDACTED = '[REDACTED]';

function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value))
      out[key] = SECRET_KEY.test(key) && typeof inner === 'string' ? REDACTED : redactValue(inner);
    return out;
  }
  return value;
}

// Maestro/XCTest JSON and JSONL receipts can carry disposable dev-fixture
// credentials verbatim (e.g. a defineVariables env); redact any password/
// token/secret-named string field before publication. Binary and other
// non-JSON/JSONL artifacts (screenshots, video) pass through unchanged,
// since we cannot safely parse and re-encode them.
export function redactSecrets(bytes) {
  const text = bytes.toString('utf8');
  try { return Buffer.from(JSON.stringify(redactValue(JSON.parse(text)))); }
  catch { /* not a single JSON document; try JSONL below */ }
  const lines = text.split('\n').map(line => {
    if (!line.trim()) return line;
    try { return JSON.stringify(redactValue(JSON.parse(line))); }
    catch { return null; }
  });
  return lines.every(line => line !== null) ? Buffer.from(lines.join('\n')) : bytes;
}

export function publicationArtifacts(report, categories) {
  const artifacts = new Set(['report.json']);
  for (const flow of report.flows) {
    artifacts.add(flow.commands);
    artifacts.add(flow.screenshot);
    artifacts.add(flow.captureReceipt);
    if (flow.identity) artifacts.add(flow.identity);
    if (flow.attachmentCloseout) artifacts.add(flow.attachmentCloseout);
    if (flow.video) artifacts.add(flow.video);
  }
  for (const category of categories) artifacts.add(report.exploration.find(item => item.category === category).trace);
  for (const observation of report.exploration || []) artifacts.add(observation.trace);
  for (const session of report.walkthroughSessions || []) {
    artifacts.add(session.receipt);
    for (const file of session.artifacts) artifacts.add(file);
  }
  return [...artifacts];
}
