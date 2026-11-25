import { createHash, randomBytes, randomInt } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
const MAX_CURSOR_LENGTH = 512;
const ACTIVE_STATUS = 'active';
const INDEX_NAME = 'RandomImageIndex';
const SEED_PATTERN = /^[0-9a-f]{16}$/;
// A position is the item's shuffle hash (16 hex) followed by its id, so ties cannot happen.
const POSITION_PATTERN = /^[0-9a-f]{16}[\w.-]{1,200}$/;
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

/**
 * Returns { seed, after } for a valid cursor, { seed: null } for a cursor from the old
 * randomKey-walk format (the session restarts with a new shuffle), or null when invalid.
 */
export function decodeRandomBrowseCursor(rawCursor) {
  if (typeof rawCursor !== 'string' || rawCursor.length > MAX_CURSOR_LENGTH) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  if (typeof parsed.seed === 'number' && (parsed.segment === 'after' || parsed.segment === 'before')) {
    return { seed: null, after: '' };
  }

  if (typeof parsed.seed !== 'string' || !SEED_PATTERN.test(parsed.seed)) {
    return null;
  }

  if (typeof parsed.after !== 'string' || !POSITION_PATTERN.test(parsed.after)) {
    return null;
  }

  return { seed: parsed.seed, after: parsed.after };
}

// A warm read function reuses the item list while someone scrolls, so only the first page
// of a session pays for the full index read. New uploads show up within a minute.
const ACTIVE_ITEMS_TTL_MS = 60 * 1000;
let activeItemsCache = null;
let activeItemsLoadedAt = 0;

export function resetActiveItemsCache() {
  activeItemsCache = null;
  activeItemsLoadedAt = 0;
}

/** Every active item, cached per container for a minute. */
export async function loadActiveItems() {
  if (activeItemsCache && Date.now() - activeItemsLoadedAt < ACTIVE_ITEMS_TTL_MS) {
    return activeItemsCache;
  }
  activeItemsCache = await queryActiveItems();
  activeItemsLoadedAt = Date.now();
  return activeItemsCache;
}

/** Reads every active item from the random index. The collection is small enough to hold in memory. */
async function queryActiveItems() {
  const items = [];
  let startKey;

  do {
    const data = await ddbDocClient.send(new QueryCommand({
      TableName: getLookupTableName(),
      IndexName: INDEX_NAME,
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': ACTIVE_STATUS },
      ExclusiveStartKey: startKey
    }));

    items.push(...(data.Items || []));
    startKey = data.LastEvaluatedKey;
  } while (startKey);

  return items;
}

export function shufflePosition(seed, id) {
  return createHash('sha256').update(`${seed}:${id}`).digest('hex').slice(0, 16) + id;
}

/**
 * Pages through the active items in an order shuffled by the session seed. Each item's
 * place depends only on the seed and its own id, so items added or removed mid-session
 * do not reshuffle the rest: nothing already shown repeats and nothing is skipped.
 */
export async function fetchRandomBrowsePage(rawCursor, limit) {
  let state = { seed: null, after: '' };

  if (rawCursor) {
    state = decodeRandomBrowseCursor(rawCursor);
    if (!state) {
      return null;
    }
  }

  const seed = state.seed || randomBytes(8).toString('hex');
  const ordered = (await loadActiveItems())
    .filter((item) => typeof item?.id === 'string' && item.id)
    .map((item) => ({ item, position: shufflePosition(seed, item.id) }))
    .filter(({ position }) => position > state.after)
    .sort((a, b) => (a.position < b.position ? -1 : 1));

  const page = ordered.slice(0, limit);
  const hasMore = ordered.length > limit;
  const cursor = hasMore
    ? encodeRandomBrowseCursor({ seed, after: page[page.length - 1].position })
    : null;

  return {
    items: page.map(({ item }) => item),
    seed,
    cursor,
    hasMore
  };
}

/** Picks one active item with every item equally likely. */
export async function pickRandomItem() {
  const items = await loadActiveItems();
  return items.length ? items[randomInt(items.length)] : null;
}
