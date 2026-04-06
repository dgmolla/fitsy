export function randomUUID(): string {
  return '00000000-0000-0000-0000-000000000000';
}

export enum CryptoDigestAlgorithm {
  SHA256 = 'SHA-256',
}

export async function digestStringAsync(
  _algorithm: CryptoDigestAlgorithm,
  _data: string,
): Promise<string> {
  return 'mocked-hash';
}
