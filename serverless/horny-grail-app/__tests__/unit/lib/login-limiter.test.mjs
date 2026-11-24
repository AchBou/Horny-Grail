import { jest } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { checkLoginAllowed, recordLoginFailure } from '../../../src/lib/login-limiter.mjs';

const NOW = 1_800_000_000;
const HOUR_KEY = `global#${Math.floor(NOW / 3600)}`;
const ddbMock = mockClient(DynamoDBDocumentClient);

describe('login limiter (global cap)', () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkLoginAllowed', () => {
    it('allows logins when there is no lock', async () => {
      ddbMock.on(GetCommand).resolves({});

      await expect(checkLoginAllowed()).resolves.toEqual({ allowed: true });
    });

    it('blocks logins while the lock is active', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { pk: 'global#lock', lockedUntil: NOW + 600 } });

      await expect(checkLoginAllowed()).resolves.toEqual({ allowed: false, retryAfterSeconds: 600 });
    });

    it('allows logins once the lock has passed', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { pk: 'global#lock', lockedUntil: NOW - 1 } });

      await expect(checkLoginAllowed()).resolves.toEqual({ allowed: true });
    });

    it('propagates DynamoDB errors so callers can fail closed', async () => {
      ddbMock.on(GetCommand).rejects(new Error('dynamo down'));

      await expect(checkLoginAllowed()).rejects.toThrow('dynamo down');
    });
  });

  describe('recordLoginFailure', () => {
    it('counts failures in the current hour without locking under the cap', async () => {
      ddbMock.on(UpdateCommand).resolves({ Attributes: { failures: 19 } });

      await expect(recordLoginFailure()).resolves.toEqual({ locked: false });
      expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.Key).toEqual({ pk: HOUR_KEY });
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('locks every login for an hour at the cap', async () => {
      ddbMock.on(UpdateCommand).resolves({ Attributes: { failures: 20 } });
      ddbMock.on(PutCommand).resolves({});

      await expect(recordLoginFailure()).resolves.toEqual({ locked: true });
      expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toEqual(expect.objectContaining({
        pk: 'global#lock',
        lockedUntil: NOW + 3600
      }));
      expect(console.warn).toHaveBeenCalledWith('LOGIN_GLOBAL_LOCK', expect.any(Object));
    });
  });
});
