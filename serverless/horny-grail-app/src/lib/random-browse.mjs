import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
const ACTIVE_STATUS = 'active';
const INDEX_NAME = 'RandomImageIndex';
const SEGMENT_AFTER = 'after';
const SEGMENT_BEFORE = 'before';
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function parseRandomBrowseLimit(rawValue) {
  if (rawValue == null || rawValue === '') {
    return DEFAULT_LIMIT;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return null;
  }

  return value;
}

export function encodeRandomBrowseCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeRandomBrowseCursor(rawCursor) {
  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
    const seed = parsed?.seed;
    const segment = parsed?.segment;
    const startKey = parsed?.startKey ?? null;

    if (typeof seed !== 'number' || Number.isNaN(seed) || seed < 0 || seed >= 1) {
      return null;
    }

    if (segment !== SEGMENT_AFTER && segment !== SEGMENT_BEFORE) {
      return null;
    }

    if (startKey !== null && typeof startKey !== 'object') {
      return null;
    }

    return { seed, segment, startKey };
  } catch {
    return null;
  }
}

async function querySegment({ seed, segment, startKey, limit }) {
  const data = await ddbDocClient.send(new QueryCommand({
    TableName: getLookupTableName(),
    IndexName: INDEX_NAME,
    KeyConditionExpression: `#status = :status AND ${segment === SEGMENT_AFTER ? 'randomKey >= :seed' : 'randomKey < :seed'}`,
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': ACTIVE_STATUS,
      ':seed': seed
    },
    ExclusiveStartKey: startKey || undefined,
    Limit: limit,
    ScanIndexForward: true
  }));

  return {
    items: data.Items || [],
    lastEvaluatedKey: data.LastEvaluatedKey || null
  };
}

export async function fetchRandomBrowsePage(rawCursor, limit) {
  let state = null;

  if (rawCursor) {
    state = decodeRandomBrowseCursor(rawCursor);
    if (!state) {
      return null;
    }
  } else {
    state = {
      seed: Math.random(),
      segment: SEGMENT_AFTER,
      startKey: null
    };
  }

  let remaining = limit;
  let items = [];
  let segment = state.segment;
  let startKey = state.startKey;
  let lastEvaluatedKey = null;

  while (remaining > 0) {
    const result = await querySegment({
      seed: state.seed,
      segment,
      startKey,
      limit: remaining
    });

    items = items.concat(result.items);
    remaining = limit - items.length;
    lastEvaluatedKey = result.lastEvaluatedKey;

    if (remaining === 0 || lastEvaluatedKey) {
      break;
    }

    if (segment === SEGMENT_AFTER) {
      segment = SEGMENT_BEFORE;
      startKey = null;
      continue;
    }

    break;
  }

  const hasMore = Boolean(lastEvaluatedKey || (segment === SEGMENT_AFTER && items.length < limit));
  const nextCursor = hasMore
    ? encodeRandomBrowseCursor({
        seed: state.seed,
        segment,
        startKey: lastEvaluatedKey
      })
    : null;

  return {
    items,
    seed: state.seed,
    cursor: nextCursor,
    wrapped: segment === SEGMENT_BEFORE,
    hasMore
  };
}
