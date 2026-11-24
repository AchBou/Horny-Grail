import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createSessionHandler } from '../../../src/handlers/auth/create-session.mjs';

const ddbMock = mockClient(DynamoDBDocumentClient);
const secretsMock = mockClient(SecretsManagerClient);
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});

function formPost(code, next = '/browse') {
  return {
    requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, next }).toString()
  };
}

describe('Test createSessionHandler', () => {
  beforeAll(() => {
    process.env.CLOUDFRONT_PRIVATE_KEY_SECRET_ARN = 'test-private-key-arn';
    process.env.CLOUDFRONT_KEY_PAIR_ID = 'K123';
    process.env.CLOUDFRONT_COOKIE_RESOURCE = 'https://example.test/*';
    process.env.ACCESS_COOKIE_TTL_SECONDS = '3600';
  });

  beforeEach(() => {
    ddbMock.reset();
    secretsMock.reset();
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: privateKey });
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({ Attributes: { failures: 1 } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sets signed cookies and redirects to next on the right code', async () => {
    const result = await createSessionHandler(formPost(process.env.READ_ACCESS_CODE));

    expect(result.statusCode).toBe(303);
    expect(result.headers.Location).toBe('/browse');
    expect(result.cookies).toHaveLength(3);
    expect(result.cookies[0]).toContain('Max-Age=3600');
  });

  it('redirects back with error=1 on a wrong code', async () => {
    const result = await createSessionHandler(formPost('wrong-code'));

    expect(result.headers.Location).toBe('/access?error=1&next=%2Fbrowse');
    expect(result.cookies).toEqual([]);
  });

  it('redirects back with locked=1 while locked out', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: 'global#lock', lockedUntil: Math.floor(Date.now() / 1000) + 600 }
    });

    const result = await createSessionHandler(formPost(process.env.READ_ACCESS_CODE));

    expect(result.headers.Location).toBe('/access?locked=1&next=%2Fbrowse');
    expect(result.cookies).toEqual([]);
  });

  it('redirects back with unavailable=1 when the limiter is unreachable', async () => {
    ddbMock.on(GetCommand).rejects(new Error('dynamo down'));

    const result = await createSessionHandler(formPost(process.env.READ_ACCESS_CODE));

    expect(result.headers.Location).toBe('/access?unavailable=1&next=%2Fbrowse');
  });
});
