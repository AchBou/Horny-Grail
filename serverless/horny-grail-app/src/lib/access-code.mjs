import { getAppSecrets, resetAppSecretsCache } from './app-secrets.mjs';
import { plaintextCodeMatches, verifyPassphrase } from './passphrase-hash.mjs';

export const resetAccessCodeCache = resetAppSecretsCache;

/**
 * Prefers the scrypt hash (readAccessCodeHash). Falls back to the legacy plaintext
 * readAccessCode until the hash is set.
 */
export async function verifyAccessCode(code) {
  const { readAccessCodeHash, readAccessCode } = await getAppSecrets();

  if (readAccessCodeHash) {
    return verifyPassphrase(code, readAccessCodeHash);
  }

  if (readAccessCode) {
    return plaintextCodeMatches(code, readAccessCode);
  }

  throw new Error('No access code configured: set readAccessCodeHash (or readAccessCode)');
}
