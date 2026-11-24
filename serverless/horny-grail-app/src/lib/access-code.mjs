import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { plaintextCodeMatches, verifyPassphrase } from './passphrase-hash.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000;
const secretsClient = new SecretsManagerClient({});

let cachedConfig = null;
let cachedAt = 0;

async function loadFromSecretsManager(secretId) {
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secret = JSON.parse(result.SecretString || '{}');
  return {
    hash: typeof secret.readAccessCodeHash === 'string' ? secret.readAccessCodeHash : '',
    plaintext: typeof secret.readAccessCode === 'string' ? secret.readAccessCode : ''
  };
}

function loadFromEnv() {
  return {
    hash: process.env.READ_ACCESS_CODE_HASH || '',
    plaintext: process.env.READ_ACCESS_CODE || ''
  };
}

/**
 * Deployed functions read the access code from Secrets Manager at runtime (cached for
 * 5 minutes) so changing the passphrase needs no redeploy. Local runs and tests use env vars.
 */
export async function getAccessCodeConfig() {
  const secretId = process.env.APP_SECRETS_SECRET_ARN;
  if (!secretId) {
    return loadFromEnv();
  }

  if (cachedConfig && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  cachedConfig = await loadFromSecretsManager(secretId);
  cachedAt = Date.now();
  return cachedConfig;
}

export function resetAccessCodeCache() {
  cachedConfig = null;
  cachedAt = 0;
}

/**
 * Prefers the scrypt hash (readAccessCodeHash). Falls back to the legacy plaintext
 * readAccessCode until the hash is set.
 */
export async function verifyAccessCode(code) {
  const config = await getAccessCodeConfig();

  if (config.hash) {
    return verifyPassphrase(code, config.hash);
  }

  if (config.plaintext) {
    return plaintextCodeMatches(code, config.plaintext);
  }

  throw new Error('No access code configured: set readAccessCodeHash (or readAccessCode)');
}
