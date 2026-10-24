/** Only the literal string "true" enables a flag; missing or malformed values stay OFF. */
export function isFlagEnabled(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name) && process.env[`FLAG_${name}`] === 'true';
}

/** FLAG_MOBILE_* is explicitly public; private API flags never leave the server. */
export function mobileFlags(): Record<string, boolean> {
  return Object.fromEntries(Object.keys(process.env)
    .filter(key => /^FLAG_MOBILE_[A-Z][A-Z0-9_]*$/.test(key))
    .map(key => [key.slice('FLAG_MOBILE_'.length), isFlagEnabled(key.slice('FLAG_'.length))]));
}
