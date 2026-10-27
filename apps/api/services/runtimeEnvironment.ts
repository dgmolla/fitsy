export const REVIEWER_EMAIL = 'appreview@fitsy.org';

/** Production is the default; dev conveniences cannot override a prod target. */
export function isDevelopmentEnvironment(): boolean {
  if (process.env['VERCEL_ENV'] === 'production' ||
      process.env['SUPABASE_URL']?.includes('zaxkmjqozvmbifiwbxps')) return false;
  const environment = process.env['VERCEL_ENV'] ?? process.env['NODE_ENV'];
  return environment === 'preview' || environment === 'development' || environment === 'test';
}
