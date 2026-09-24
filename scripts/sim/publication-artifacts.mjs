export function publicationArtifacts(report, categories) {
  const artifacts = new Set(['report.json']);
  for (const flow of report.flows) {
    artifacts.add(flow.commands);
    artifacts.add(flow.screenshot);
    artifacts.add(flow.video);
  }
  for (const category of categories) artifacts.add(report.exploration.find(item => item.category === category).trace);
  return [...artifacts];
}
