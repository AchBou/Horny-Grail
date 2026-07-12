import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function getItemById(id) {
  const data = await ddbDocClient.send(new GetCommand({
    TableName: getLookupTableName(),
    Key: { id }
  }));

  return data.Item || null;
}

export function encodeScanCursor(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
}

export function parseScanLimit(rawValue) {
  if (rawValue == null || rawValue === '') return 48;
  const value = Number.parseInt(rawValue, 10);
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : null;
}

export function decodeScanCursor(rawCursor) {
  if (rawCursor == null || rawCursor === '') return null;
  if (typeof rawCursor !== 'string' || rawCursor.length > 2048) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function scanItemsPage({ cursor = null, limit = 48 } = {}) {
  const data = await ddbDocClient.send(new ScanCommand({
    TableName: getLookupTableName(),
    Limit: limit,
    ExclusiveStartKey: cursor || undefined
  }));
  return {
    items: data.Items || [],
    cursor: encodeScanCursor(data.LastEvaluatedKey || null)
  };
}

export async function deleteItemById(id) {
  const data = await ddbDocClient.send(new DeleteCommand({
    TableName: getLookupTableName(),
    Key: { id },
    ReturnValues: 'ALL_OLD'
  }));

  return data.Attributes || null;
}
