// Vercel Git builds and clean CLI uploads expose the same revision differently.
// Local writers are trusted, as with simulator receipts; metadata is not a
// cryptographic attestation against a repository administrator.
export function backendOrigin(value) {
  if (typeof value !== 'string' || !/^https:\/\/(?:dev\.fitsy\.org|fitsy-api-[a-z0-9-]+-dawits-projects-74b6e00f\.vercel\.app)$/.test(value)) {
    throw new Error('Load the dev API or this project\'s Vercel preview; this runner refuses production and unrelated origins');
  }
  return value;
}

export const maestroApiArgs = (env = process.env) => ['-e', `EXPO_PUBLIC_API_URL=${backendOrigin(env.EXPO_PUBLIC_API_URL)}`];

export function backendRevision(deployment, origin) {
  if (origin !== undefined) {
    backendOrigin(origin);
    if (deployment.name !== 'fitsy-api') throw new Error('Simulator backend must belong to fitsy-api');
  }
  if (deployment.readyState !== 'READY' || deployment.target === 'production') {
    throw new Error('Dev deployment must be ready and non-production');
  }
  const dirty = deployment.meta?.gitDirty;
  if (deployment.source === 'cli' && dirty !== undefined && ![false, 'false', '0'].includes(dirty)) {
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
