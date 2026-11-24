import { jest } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createMobileSessionHandler } from '../../../src/handlers/auth/create-mobile-session.mjs';

const ddbMock = mockClient(DynamoDBDocumentClient);

function loginEvent(code) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify({ code })
  };
}

describe('Test createMobileSessionHandler', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({ Attributes: { failures: 1 } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should issue a bearer token for a valid access code', async () => {
    const result = await createMobileSessionHandler(loginEvent(process.env.READ_ACCESS_CODE));

    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    expect(typeof body.token).toEqual('string');
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('should reject an invalid access code and count the failure', async () => {
    const result = await createMobileSessionHandler(loginEvent('wrong-code'));

    expect(result.statusCode).toEqual(401);
    expect(JSON.parse(result.body)).toEqual({
      code: 'unauthorized',
      message: 'Unauthorized'
    });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it('should return 429 without checking the code while locked', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: 'global#lock', lockedUntil: Math.floor(Date.now() / 1000) + 120 }
    });

    const result = await createMobileSessionHandler(loginEvent(process.env.READ_ACCESS_CODE));

    expect(result.statusCode).toEqual(429);
    expect(Number(result.headers['Retry-After'])).toBeGreaterThanOrEqual(119);
    expect(JSON.parse(result.body).code).toEqual('too_many_attempts');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('should fail closed with 503 when the limiter is unreachable', async () => {
    ddbMock.on(GetCommand).rejects(new Error('dynamo down'));

    const result = await createMobileSessionHandler(loginEvent(process.env.READ_ACCESS_CODE));

    expect(result.statusCode).toEqual(503);
  });
});
