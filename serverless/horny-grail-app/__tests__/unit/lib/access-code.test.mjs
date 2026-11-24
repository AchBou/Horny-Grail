import { mockClient } from 'aws-sdk-client-mock';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { resetAccessCodeCache, verifyAccessCode } from '../../../src/lib/access-code.mjs';
import { hashPassphrase } from '../../../src/lib/passphrase-hash.mjs';

const secretsMock = mockClient(SecretsManagerClient);

describe('verifyAccessCode', () => {
  beforeEach(() => {
    secretsMock.reset();
    resetAccessCodeCache();
  });

  afterEach(() => {
    delete process.env.APP_SECRETS_SECRET_ARN;
    delete process.env.READ_ACCESS_CODE_HASH;
  });

  it('uses the plaintext env code when no hash is configured', async () => {
    await expect(verifyAccessCode(process.env.READ_ACCESS_CODE)).resolves.toBe(true);
    await expect(verifyAccessCode('nope')).resolves.toBe(false);
  });

  it('prefers the hash over the plaintext code', async () => {
    process.env.READ_ACCESS_CODE_HASH = await hashPassphrase('velvet lantern orbit pickle');

    await expect(verifyAccessCode('Velvet Lantern Orbit Pickle')).resolves.toBe(true);
    await expect(verifyAccessCode(process.env.READ_ACCESS_CODE)).resolves.toBe(false);
  });

  it('reads the hash from Secrets Manager and caches it', async () => {
    process.env.APP_SECRETS_SECRET_ARN = 'arn:aws:secretsmanager:us-west-2:111111111111:secret:app';
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        readAccessCodeHash: await hashPassphrase('velvet lantern orbit pickle'),
        readAccessCode: 'old-code'
      })
    });

    await expect(verifyAccessCode('velvet lantern orbit pickle')).resolves.toBe(true);
    await expect(verifyAccessCode('old-code')).resolves.toBe(false);
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
  });
});
