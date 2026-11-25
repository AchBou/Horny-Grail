import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { jest } from '@jest/globals';
import { getAppSecrets, resetAppSecretsCache } from '../../../src/lib/app-secrets.mjs';
import { requireWriteApiKey } from '../../../src/lib/auth.mjs';
import { guardRequest } from '../../../src/lib/request-guards.mjs';

const SECRET_ARN = 'arn:aws:secretsmanager:us-west-2:111111111111:secret:app';
const secretWith = (fields) => ({ SecretString: JSON.stringify(fields) });

describe('app secrets', () => {
  const smMock = mockClient(SecretsManagerClient);

  beforeEach(() => {
    smMock.reset();
    resetAppSecretsCache();
    process.env.APP_SECRETS_SECRET_ARN = SECRET_ARN;
  });

  afterEach(() => {
    delete process.env.APP_SECRETS_SECRET_ARN;
    resetAppSecretsCache();
    jest.restoreAllMocks();
  });

  it('should read the secret at runtime and cache it', async () => {
    smMock.on(GetSecretValueCommand).resolves(secretWith({ writeApiKey: 'runtime-key' }));

    await getAppSecrets();
    const secrets = await getAppSecrets();

    expect(secrets.writeApiKey).toBe('runtime-key');
    expect(smMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
    expect(smMock.commandCalls(GetSecretValueCommand)[0].args[0].input).toEqual({ SecretId: SECRET_ARN });
  });

  it('should pick up a rotated write key once the cache expires', async () => {
    smMock.on(GetSecretValueCommand)
      .resolvesOnce(secretWith({ writeApiKey: 'old-key' }))
      .resolves(secretWith({ writeApiKey: 'new-key' }));
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);

    expect(await requireWriteApiKey({ headers: { 'x-api-key': 'old-key' } })).toBeNull();

    clock.mockReturnValue(now + 61 * 1000);
    expect((await requireWriteApiKey({ headers: { 'x-api-key': 'old-key' } })).statusCode).toBe(401);
    expect(await requireWriteApiKey({ headers: { 'x-api-key': 'new-key' } })).toBeNull();
  });

  it('should fall back to env vars when no secret ARN is set (local runs and tests)', async () => {
    delete process.env.APP_SECRETS_SECRET_ARN;

    const secrets = await getAppSecrets();

    expect(secrets.writeApiKey).toBe('test-write-api-key');
    expect(smMock.commandCalls(GetSecretValueCommand)).toHaveLength(0);
  });

  it('should return 500 from the guard when the secret cannot be read', async () => {
    smMock.on(GetSecretValueCommand).rejects(new Error('AccessDenied'));

    const result = await guardRequest(
      { httpMethod: 'DELETE', headers: { 'x-api-key': 'anything' } },
      { handlerName: 'test', method: 'DELETE', authorize: requireWriteApiKey }
    );

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).message).toBe('Authorization is temporarily unavailable');
  });

  it('should return 500 when the secret lacks the key', async () => {
    smMock.on(GetSecretValueCommand).resolves(secretWith({ readOriginSecret: 'x' }));

    const result = await guardRequest(
      { httpMethod: 'DELETE', headers: { 'x-api-key': 'anything' } },
      { handlerName: 'test', method: 'DELETE', authorize: requireWriteApiKey }
    );

    expect(result.statusCode).toBe(500);
  });
});
