import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../../config/env.mjs';
import { badRequest, jsonResponse, methodNotAllowed, serverError } from '../../lib/http.mjs';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
const ACTIVE_STATUS = 'active';
const INDEX_NAME = 'RandomImageIndex';
const SEGMENT_AFTER = 'after';
const SEGMENT_BEFORE = 'before';
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getQueryParam(event, key) {
  return event?.queryStringParameters?.[key] ?? null;
}

function parseLimit(rawValue) {
  if (rawValue == null || rawValue === '') {
    return DEFAULT_LIMIT;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return null;
  }

  return value;
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(rawCursor) {
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
  const expressionAttributeValues = {
    ':status': ACTIVE_STATUS,
    ':seed': seed
  };

  const rangeExpression = segment === SEGMENT_AFTER
    ? 'randomKey >= :seed'
    : 'randomKey < :seed';

  const data = await ddbDocClient.send(new QueryCommand({
    TableName: getLookupTableName(),
    IndexName: INDEX_NAME,
    KeyConditionExpression: `#status = :status AND ${rangeExpression}`,
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: expressionAttributeValues,
    ExclusiveStartKey: startKey || undefined,
    Limit: limit,
    ScanIndexForward: true
  }));

  return {
    items: data.Items || [],
    lastEvaluatedKey: data.LastEvaluatedKey || null
  };
}

export const getRandomBrowseHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method && method !== 'GET') {
    return methodNotAllowed(`getRandomBrowse only accepts GET method, you tried: ${method}`, event);
  }

  const limit = parseLimit(getQueryParam(event, 'limit'));
  if (limit == null) {
    return badRequest(`Invalid limit. Expected an integer between 1 and ${MAX_LIMIT}.`, event);
  }

  const rawCursor = getQueryParam(event, 'cursor');
  let state = null;

  if (rawCursor) {
    state = decodeCursor(rawCursor);
    if (!state) {
      return badRequest('Invalid cursor', event);
    }
  } else {
    state = {
      seed: Math.random(),
      segment: SEGMENT_AFTER,
      startKey: null
    };
  }

  try {
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

      if (remaining === 0) {
        break;
      }

      if (lastEvaluatedKey) {
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
      ? encodeCursor({
          seed: state.seed,
          segment,
          startKey: lastEvaluatedKey
        })
      : null;

    return jsonResponse(200, {
      items,
      seed: state.seed,
      cursor: nextCursor,
      wrapped: segment === SEGMENT_BEFORE,
      hasMore
    }, event);
  } catch (error) {
    console.error('Error browsing random images:', error);
    return serverError('Failed to browse random images', event);
  }
};
