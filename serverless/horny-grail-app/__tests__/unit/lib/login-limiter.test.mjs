import { jest } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import {
  checkLoginAllowed,
  computeIpLockSeconds,
  getLimiterSettings,
  recordLoginFailure,
  recordLoginSuccess
} from '../../../src/lib/login-limiter.mjs';

const TABLE = 'test-login-attempts';
const NOW = 1_800_000_000;
const ddbMock = mockClient(DynamoDBDocumentClient);

function updatesFor(pk) {
  return ddbMock.commandCalls(UpdateCommand).filter((call) => call.args[0].input.Key.pk === pk);
}

describe('login limiter', () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('computeIpLockSeconds', () => {
    const settings = getLimiterSettings();

    it('allows the free failures, then doubles from one minute up to a day', () => {
      expect(computeIpLockSeconds(4, settings)).toBe(0);
      expect(computeIpLockSeconds(5, settings)).toBe(60);
      expect(computeIpLockSeconds(6, settings)).toBe(120);
      expect(computeIpLockSeconds(7, settings)).toBe(240);
      expect(computeIpLockSeconds(40, settings)).toBe(86400);
    });
  });

  describe('checkLoginAllowed', () => {
    it('allows a clean IP', async () => {
      ddbMock.on(BatchGetCommand).resolves({ Responses: { [TABLE]: [] } });

      await expect(checkLoginAllowed('198.51.100.7')).resolves.toEqual({ allowed: true });
    });

    it('blocks a locked IP with the remaining time', async () => {
      ddbMock.on(BatchGetCommand).resolves({
        Responses: { [TABLE]: [{ pk: 'ip#198.51.100.7', failures: 5, lockedUntil: NOW + 45 }] }
      });

      await expect(checkLoginAllowed('198.51.100.7')).resolves.toEqual({
        allowed: false,
        retryAfterSeconds: 45,
        scope: 'ip'
      });
    });

    it('allows an IP whose lock has expired', async () => {
      ddbMock.on(BatchGetCommand).resolves({
        Responses: { [TABLE]: [{ pk: 'ip#198.51.100.7', failures: 5, lockedUntil: NOW - 1 }] }
      });

      await expect(checkLoginAllowed('198.51.100.7')).resolves.toEqual({ allowed: true });
    });

    it('blocks everyone while the global lock is active', async () => {
      ddbMock.on(BatchGetCommand).resolves({
        Responses: { [TABLE]: [{ pk: 'global#lock', lockedUntil: NOW + 600 }] }
      });

      await expect(checkLoginAllowed('203.0.113.1')).resolves.toEqual({
        allowed: false,
        retryAfterSeconds: 600,
        scope: 'global'
      });
    });

    it('propagates DynamoDB errors so callers can fail closed', async () => {
      ddbMock.on(BatchGetCommand).rejects(new Error('dynamo down'));

      await expect(checkLoginAllowed('198.51.100.7')).rejects.toThrow('dynamo down');
    });
  });

  describe('recordLoginFailure', () => {
    it('counts a failure without locking while under the threshold', async () => {
      ddbMock.on(UpdateCommand).resolves({ Attributes: { failures: 2 } });

      await expect(recordLoginFailure('198.51.100.7')).resolves.toEqual({ ipLockSeconds: 0, globalLocked: false });
      expect(updatesFor('ip#198.51.100.7')).toHaveLength(1);
      expect(updatesFor(`global#${Math.floor(NOW / 3600)}`)).toHaveLength(1);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('locks the IP on the fifth failure', async () => {
      ddbMock.on(UpdateCommand).resolves({ Attributes: { failures: 5 } });

      const result = await recordLoginFailure('198.51.100.7');

      expect(result.ipLockSeconds).toBe(60);
      const lockUpdate = updatesFor('ip#198.51.100.7')[1].args[0].input;
      expect(lockUpdate.ExpressionAttributeValues[':lockedUntil']).toBe(NOW + 60);
    });

    it('starts a fresh count when the old record has expired', async () => {
      ddbMock
        .on(UpdateCommand, { Key: { pk: 'ip#198.51.100.7' } })
        .rejects(Object.assign(new Error('expired'), { name: 'ConditionalCheckFailedException' }));
      ddbMock.on(UpdateCommand, { Key: { pk: `global#${Math.floor(NOW / 3600)}` } }).resolves({ Attributes: { failures: 1 } });
      ddbMock.on(PutCommand).resolves({});

      const result = await recordLoginFailure('198.51.100.7');

      expect(result.ipLockSeconds).toBe(0);
      expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toEqual(expect.objectContaining({
        pk: 'ip#198.51.100.7',
        failures: 1
      }));
    });

    it('sets the global lock once the hourly cap is reached', async () => {
      ddbMock.on(UpdateCommand, { Key: { pk: 'ip#198.51.100.7' } }).resolves({ Attributes: { failures: 1 } });
      ddbMock.on(UpdateCommand, { Key: { pk: `global#${Math.floor(NOW / 3600)}` } }).resolves({ Attributes: { failures: 50 } });
      ddbMock.on(PutCommand).resolves({});

      const result = await recordLoginFailure('198.51.100.7');

      expect(result.globalLocked).toBe(true);
      const lock = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
      expect(lock).toEqual(expect.objectContaining({ pk: 'global#lock', lockedUntil: NOW + 3600 }));
      expect(console.warn).toHaveBeenCalledWith('LOGIN_GLOBAL_LOCK', expect.any(Object));
    });
  });

  describe('recordLoginSuccess', () => {
    it('clears the IP record', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await recordLoginSuccess('198.51.100.7');

      expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ pk: 'ip#198.51.100.7' });
    });
  });
});
