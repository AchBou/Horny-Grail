import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

// One global failure counter per clock hour. When it reaches the cap, every login pauses.
// Per-IP tracking is deliberately absent: behind Cloudflare the visible IP is a proxy.
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const LOCK_KEY = 'global#lock';
const HOUR_SECONDS = 60 * 60;

function readIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

export function getLimiterSettings() {
  return {
    tableName: process.env.LOGIN_ATTEMPTS_TABLE || '',
    failuresPerHour: readIntEnv('LOGIN_GLOBAL_FAILURES_PER_HOUR', 20),
    lockSeconds: readIntEnv('LOGIN_GLOBAL_LOCK_SECONDS', HOUR_SECONDS)
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

/**
 * Returns { allowed: true } or { allowed: false, retryAfterSeconds }.
 * Throws if DynamoDB is unreachable; callers treat that as "not allowed" (fail closed).
 */
export async function checkLoginAllowed() {
  const settings = getLimiterSettings();
  const result = await ddbDocClient.send(new GetCommand({
    TableName: requireTableName(settings),
    Key: { pk: LOCK_KEY },
    ConsistentRead: true
  }));

  const now = nowSeconds();
  const lockedUntil = result.Item?.lockedUntil;
  if (lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: lockedUntil - now };
  }

  return { allowed: true };
}

/** Records a wrong code. Returns { locked } so callers and tests can see when the cap tripped. */
export async function recordLoginFailure() {
  const settings = getLimiterSettings();
  const tableName = requireTableName(settings);
  const now = nowSeconds();

  const result = await ddbDocClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { pk: `global#${Math.floor(now / HOUR_SECONDS)}` },
    UpdateExpression: 'ADD failures :one SET expiresAt = :expiresAt',
    ExpressionAttributeValues: { ':one': 1, ':expiresAt': now + 2 * HOUR_SECONDS },
    ReturnValues: 'ALL_NEW'
  }));
  const failures = result.Attributes?.failures ?? 1;

  if (failures < settings.failuresPerHour) {
    return { locked: false };
  }

  const lockedUntil = now + settings.lockSeconds;
  await ddbDocClient.send(new PutCommand({
    TableName: tableName,
    Item: { pk: LOCK_KEY, lockedUntil, expiresAt: lockedUntil + HOUR_SECONDS }
  }));
  console.warn('LOGIN_GLOBAL_LOCK', { failuresThisHour: failures, lockSeconds: settings.lockSeconds });
  return { locked: true };
}
