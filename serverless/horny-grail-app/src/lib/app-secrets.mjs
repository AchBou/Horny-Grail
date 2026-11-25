import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

// Short enough that a rotated key or changed passphrase is live within a minute;
// Secrets Manager reads cost $0.05 per 10,000, so this stays effectively free.
const CACHE_TTL_MS = 60 * 1000;
const secretsClient = new SecretsManagerClient({});

let cached = null;
let cachedAt = 0;

function pick(source) {
  const read = (key) => (typeof source[key] === 'string' ? source[key] : '');
  return {
    writeApiKey: read('writeApiKey'),
    readOriginSecret: read('readOriginSecret'),
    mobileReadTokenSecret: read('mobileReadTokenSecret'),
    readAccessCodeHash: read('readAccessCodeHash'),
    readAccessCode: read('readAccessCode')
  };
}

function loadFromEnv() {
  return pick({
    writeApiKey: process.env.WRITE_API_KEY,
    readOriginSecret: process.env.READ_ORIGIN_SECRET,
    mobileReadTokenSecret: process.env.MOBILE_READ_TOKEN_SECRET,
    readAccessCodeHash: process.env.READ_ACCESS_CODE_HASH,
    readAccessCode: process.env.READ_ACCESS_CODE
  });
}

/**
 * Deployed functions read the app secret from Secrets Manager at runtime (cached for
 * 1 minute), so rotating a key or changing the passphrase needs no redeploy and the
 * values never appear in the Lambda console. Local runs and tests use env vars.
 */
export async function getAppSecrets() {
  const secretId = process.env.APP_SECRETS_SECRET_ARN;
  if (!secretId) {
    return loadFromEnv();
  }

  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  cached = pick(JSON.parse(result.SecretString || '{}'));
  cachedAt = Date.now();
  return cached;
}

/** Reads one required field of the app secret. */
export async function getAppSecret(field) {
  const value = (await getAppSecrets())[field];
  if (!value) {
    throw new Error(`App secret is missing ${field}`);
  }
  return value;
}

export function resetAppSecretsCache() {
  cached = null;
  cachedAt = 0;
}
