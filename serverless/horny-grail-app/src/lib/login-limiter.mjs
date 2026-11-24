import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const GLOBAL_LOCK_KEY = 'global#lock';
const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;

function readIntEnv(name, fallback, min) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

export function getLimiterSettings() {
  return {
    tableName: process.env.LOGIN_ATTEMPTS_TABLE || '',
    ipFreeFailures: readIntEnv('LOGIN_IP_FREE_FAILURES', 5, 1),
    ipBaseLockSeconds: readIntEnv('LOGIN_IP_BASE_LOCK_SECONDS', 60, 1),
    ipMaxLockSeconds: readIntEnv('LOGIN_IP_MAX_LOCK_SECONDS', DAY_SECONDS, 1),
    globalFailuresPerHour: readIntEnv('LOGIN_GLOBAL_FAILURES_PER_HOUR', 50, 1),
    globalLockSeconds: readIntEnv('LOGIN_GLOBAL_LOCK_SECONDS', HOUR_SECONDS, 1)
  };
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function requireTableName(settings) {
  if (!settings.tableName) {
    throw new Error('Missing required environment variable: LOGIN_ATTEMPTS_TABLE');
  }
  return settings.tableName;
}

function ipKey(ip) {
  return `ip#${ip}`;
}

function globalWindowKey(now) {
  return `global#${Math.floor(now / HOUR_SECONDS)}`;
}

/**
 * Lock length for the Nth failure: free failures, then base, 2x base, 4x base... capped.
 */
export function computeIpLockSeconds(failures, settings = getLimiterSettings()) {
  const over = failures - settings.ipFreeFailures;
  if (over < 0) {
    return 0;
  }

  const exponent = Math.min(over, 30);
  return Math.min(settings.ipBaseLockSeconds * 2 ** exponent, settings.ipMaxLockSeconds);
}

/**
 * Returns { allowed: true } or { allowed: false, retryAfterSeconds, scope }.
 * Throws if DynamoDB is unreachable; callers must treat that as "not allowed" (fail closed).
 */
export async function checkLoginAllowed(ip) {
  const settings = getLimiterSettings();
  const tableName = requireTableName(settings);
  const now = nowSeconds();

  const result = await ddbDocClient.send(new BatchGetCommand({
    RequestItems: {
      [tableName]: {
        Keys: [{ pk: ipKey(ip) }, { pk: GLOBAL_LOCK_KEY }],
        ConsistentRead: true
      }
    }
  }));

  const items = result.Responses?.[tableName] || [];
  const globalLock = items.find((item) => item.pk === GLOBAL_LOCK_KEY);
  const ipItem = items.find((item) => item.pk === ipKey(ip));

  if (globalLock?.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: globalLock.lockedUntil - now, scope: 'global' };
  }

  if (ipItem?.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: ipItem.lockedUntil - now, scope: 'ip' };
  }

  return { allowed: true };
}

async function incrementIpFailures(tableName, ip, now) {
  const expiresAt = now + DAY_SECONDS;
  try {
    // Count only while the previous record is still live; TTL deletion can lag by hours.
    const result = await ddbDocClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: ipKey(ip) },
      UpdateExpression: 'ADD failures :one SET expiresAt = :expiresAt',
      ConditionExpression: 'attribute_not_exists(pk) OR expiresAt > :now',
      ExpressionAttributeValues: { ':one': 1, ':expiresAt': expiresAt, ':now': now },
      ReturnValues: 'ALL_NEW'
    }));
    return result.Attributes?.failures ?? 1;
  } catch (error) {
    if (error?.name !== 'ConditionalCheckFailedException') {
      throw error;
    }

    await ddbDocClient.send(new PutCommand({
      TableName: tableName,
      Item: { pk: ipKey(ip), failures: 1, expiresAt }
    }));
    return 1;
  }
}

/**
 * Records a wrong code. Returns { ipLockSeconds, globalLocked } for logging and tests.
 */
export async function recordLoginFailure(ip) {
  const settings = getLimiterSettings();
  const tableName = requireTableName(settings);
  const now = nowSeconds();

  const failures = await incrementIpFailures(tableName, ip, now);
  const ipLockSeconds = computeIpLockSeconds(failures, settings);
  if (ipLockSeconds > 0) {
    const lockedUntil = now + ipLockSeconds;
    await ddbDocClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: ipKey(ip) },
      UpdateExpression: 'SET lockedUntil = :lockedUntil, expiresAt = :expiresAt',
      ExpressionAttributeValues: {
        ':lockedUntil': lockedUntil,
        ':expiresAt': Math.max(now + DAY_SECONDS, lockedUntil + HOUR_SECONDS)
      }
    }));
    console.warn('LOGIN_IP_LOCK', { ip, failures, lockSeconds: ipLockSeconds });
  }

  const windowResult = await ddbDocClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { pk: globalWindowKey(now) },
    UpdateExpression: 'ADD failures :one SET expiresAt = :expiresAt',
    ExpressionAttributeValues: { ':one': 1, ':expiresAt': now + 2 * HOUR_SECONDS },
    ReturnValues: 'ALL_NEW'
  }));
  const globalFailures = windowResult.Attributes?.failures ?? 1;

  let globalLocked = false;
  if (globalFailures >= settings.globalFailuresPerHour) {
    const lockedUntil = now + settings.globalLockSeconds;
    await ddbDocClient.send(new PutCommand({
      TableName: tableName,
      Item: { pk: GLOBAL_LOCK_KEY, lockedUntil, expiresAt: lockedUntil + HOUR_SECONDS }
    }));
    globalLocked = true;
    console.warn('LOGIN_GLOBAL_LOCK', { failuresThisHour: globalFailures, lockSeconds: settings.globalLockSeconds });
  }

  return { ipLockSeconds, globalLocked };
}

/** Clears the IP's failure history after a correct code. */
export async function recordLoginSuccess(ip) {
  const settings = getLimiterSettings();
  const tableName = requireTableName(settings);
  await ddbDocClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { pk: ipKey(ip) }
  }));
}
