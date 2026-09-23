// Parse actual element rows only; Mobile MCP's legend also contains state names.
export function nativeElement(dump, id) {
  const matches = dump.split('\n').filter(line => {
    if (!/^@e\d+ /.test(line)) return false;
    const attributes = [...line.matchAll(/\b(\w+)=("(?:\\.|[^"\\])*")/g)];
    return attributes.some(([, key, value]) => key === 'id' && JSON.parse(value) === id);
  });
  if (matches.length !== 1) return null;
  return matches[0];
}

export function isNativeFocused(dump, id) {
  const line = nativeElement(dump, id);
  const flags = line?.match(/ at=-?[\d.]+,-?[\d.]+ size=[\d.]+x[\d.]+((?: \w+)*)$/)?.[1].trim().split(/\s+/) ?? [];
  return flags.includes('focused');
}

export function assertNativeValue(dump, id, expected) {
  const line = nativeElement(dump, id);
  const attributes = [...(line ?? '').matchAll(/\b(\w+)=("(?:\\.|[^"\\])*")/g)];
  const value = attributes.find(([, key]) => key === 'value');
  if (!line || !value || JSON.parse(value[2]) !== expected) {
    throw new Error(`Native field value mismatch: ${id}`);
  }
}
