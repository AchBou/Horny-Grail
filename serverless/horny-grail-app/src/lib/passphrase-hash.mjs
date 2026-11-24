import crypto from 'node:crypto';

// scrypt cost parameters. N=2^14 keeps a single check well under a second even on a
// 128 MB Lambda; online guessing is bounded by the login limiter, not by hash cost.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_INPUT_LENGTH = 256;
const HASH_PREFIX = 'scrypt';

/**
 * Makes a memorable passphrase forgiving to type: Unicode-normalized, trimmed,
 * whitespace collapsed, and lowercased (phone keyboards auto-capitalize).
 */
export function normalizePassphrase(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function scryptAsync(input, salt, { n, r, p, keyLength }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(input, salt, keyLength, { N: n, r, p, maxmem: 256 * n * r }, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

/**
 * Hash format: scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
 */
export async function hashPassphrase(passphrase) {
  const normalized = normalizePassphrase(passphrase);
  if (!normalized) {
    throw new Error('Passphrase must not be empty');
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(normalized, salt, {
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keyLength: KEY_LENGTH
  });

  return [
    HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url')
  ].join('$');
}

export function parsePassphraseHash(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value.split('$');
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    return null;
  }

  const [n, r, p] = parts.slice(1, 4).map((part) => Number.parseInt(part, 10));
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');

  const validCost = Number.isInteger(n) && n >= 2 && n <= 2 ** 20 && (n & (n - 1)) === 0
    && Number.isInteger(r) && r >= 1 && r <= 32
    && Number.isInteger(p) && p >= 1 && p <= 16;
  if (!validCost || salt.length < 8 || hash.length < 16) {
    return null;
  }

  return { n, r, p, salt, hash };
}

export async function verifyPassphrase(passphrase, storedHash) {
  const parsed = parsePassphraseHash(storedHash);
  if (!parsed) {
    throw new Error('Stored passphrase hash is malformed');
  }

  if (typeof passphrase !== 'string' || passphrase.length > MAX_INPUT_LENGTH) {
    return false;
  }

  const normalized = normalizePassphrase(passphrase);
  if (!normalized) {
    return false;
  }

  const derived = await scryptAsync(normalized, parsed.salt, {
    n: parsed.n,
    r: parsed.r,
    p: parsed.p,
    keyLength: parsed.hash.length
  });

  return crypto.timingSafeEqual(derived, parsed.hash);
}

/**
 * Constant-time comparison for the legacy plaintext code. Hashing both sides first
 * keeps the comparison length-independent.
 */
export function plaintextCodeMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) {
    return false;
  }

  if (provided.length > MAX_INPUT_LENGTH) {
    return false;
  }

  const left = crypto.createHash('sha256').update(provided.trim()).digest();
  const right = crypto.createHash('sha256').update(expected.trim()).digest();
  return crypto.timingSafeEqual(left, right);
}
