// Vercel Git builds and clean CLI uploads expose the same revision differently.
// Local writers are trusted, as with simulator receipts; metadata is not a
// cryptographic attestation against a repository administrator.
export function backendRevision(deployment) {
  if (deployment.readyState !== 'READY' || deployment.target === 'production') {
    throw new Error('Dev deployment must be ready and non-production');
  }
  const dirty = deployment.meta?.gitDirty;
  if (dirty !== undefined && ![false, 'false', '0'].includes(dirty)) {
    throw new Error('Dev CLI deployment contains uncommitted changes');
  }
  const revision = deployment.gitSource
    ? deployment.gitSource.sha
    : deployment.source === 'cli' ? deployment.meta?.gitCommitSha : undefined;
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Dev deployment has no verified Git identity');
  }
  return revision;
}
