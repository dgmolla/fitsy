export { randomUUID } from 'node:crypto';

export enum CryptoDigestAlgorithm {
  SHA256 = 'SHA-256',
}

export async function digestStringAsync(
  _algorithm: CryptoDigestAlgorithm,
  _data: string,
): Promise<string> {
  return 'mocked-hash';
}
