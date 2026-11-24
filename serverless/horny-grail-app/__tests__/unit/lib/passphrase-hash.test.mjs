import {
  hashPassphrase,
  normalizePassphrase,
  parsePassphraseHash,
  plaintextCodeMatches,
  verifyPassphrase
} from '../../../src/lib/passphrase-hash.mjs';

describe('passphrase hashing', () => {
  it('verifies the right passphrase and rejects a wrong one', async () => {
    const hash = await hashPassphrase('velvet lantern orbit pickle');

    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    await expect(verifyPassphrase('velvet lantern orbit pickle', hash)).resolves.toBe(true);
    await expect(verifyPassphrase('velvet lantern orbit pickles', hash)).resolves.toBe(false);
  });

  it('ignores case, surrounding spaces and repeated spaces', async () => {
    const hash = await hashPassphrase('Velvet Lantern Orbit Pickle');

    await expect(verifyPassphrase('  velvet   lantern orbit PICKLE ', hash)).resolves.toBe(true);
  });

  it('salts every hash', async () => {
    const first = await hashPassphrase('same words every time');
    const second = await hashPassphrase('same words every time');

    expect(first).not.toEqual(second);
  });

  it('rejects empty, non-string and oversized input without throwing', async () => {
    const hash = await hashPassphrase('velvet lantern orbit pickle');

    await expect(verifyPassphrase('', hash)).resolves.toBe(false);
    await expect(verifyPassphrase(undefined, hash)).resolves.toBe(false);
    await expect(verifyPassphrase('a'.repeat(257), hash)).resolves.toBe(false);
  });

  it('throws on a malformed stored hash', async () => {
    await expect(verifyPassphrase('anything', 'not-a-hash')).rejects.toThrow('malformed');
    expect(parsePassphraseHash('scrypt$3$8$1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA')).toBeNull();
  });

  it('normalizes unicode and whitespace', () => {
    expect(normalizePassphrase(' Ｈello\tWorld ')).toBe('hello world');
  });
});

describe('legacy plaintext code', () => {
  it('matches exactly, ignoring surrounding whitespace', () => {
    expect(plaintextCodeMatches(' Code-123 ', 'Code-123')).toBe(true);
    expect(plaintextCodeMatches('code-123', 'Code-123')).toBe(false);
    expect(plaintextCodeMatches(undefined, 'Code-123')).toBe(false);
    expect(plaintextCodeMatches('x', '')).toBe(false);
  });
});
