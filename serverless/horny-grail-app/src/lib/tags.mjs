// Tags are free-form labels on an item. They are stored lowercase and trimmed so "Beach",
// "beach " and "beach" are one tag. Letters (any language), digits, spaces, "-" and "_" only.
export const MAX_TAGS_PER_ITEM = 30;
export const MAX_TAG_LENGTH = 32;
export const MAX_TAGS_PER_CHANGE = 30;
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;

/** Returns the stored form of a tag, or null when it is empty or not allowed. */
export function normalizeTag(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const tag = value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!tag || tag.length > MAX_TAG_LENGTH || !TAG_RE.test(tag)) {
    return null;
  }
  return tag;
}

/**
 * Normalizes a list of tags from a request, dropping duplicates. Returns null when the value
 * is not an array, is too long, or holds a tag that is not allowed, so the caller can reject it.
 */
export function parseTagList(value, maxLength = MAX_TAGS_PER_CHANGE) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxLength) {
    return null;
  }
  const tags = [];
  for (const raw of value) {
    const tag = normalizeTag(raw);
    if (!tag) {
      return null;
    }
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

/** The tags stored on an item, always as an array. */
export function itemTags(item) {
  return Array.isArray(item?.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [];
}

/** Applies a change to an item's tags: additions keep their order, removals win over additions. */
export function applyTagChange(current, { add = [], remove = [] }) {
  const removed = new Set(remove);
  const next = current.filter((tag) => !removed.has(tag));
  for (const tag of add) {
    if (!removed.has(tag) && !next.includes(tag)) {
      next.push(tag);
    }
  }
  return next.sort((a, b) => a.localeCompare(b));
}

/**
 * Reads the browse filter from query parameters: `tags=a,b` keeps items that have every one
 * of those tags, `untagged=1` keeps items with no tags. Returns null when it is invalid.
 */
export function parseTagFilter(query) {
  const untagged = query?.untagged === '1' || query?.untagged === 'true';
  const rawTags = typeof query?.tags === 'string' && query.tags.trim() ? query.tags.split(',') : [];
  const tags = parseTagList(rawTags, 10);
  if (!tags || (untagged && tags.length > 0)) {
    return null;
  }
  return { tags, untagged };
}

export function matchesTagFilter(item, filter) {
  if (!filter) {
    return true;
  }
  const tags = itemTags(item);
  if (filter.untagged) {
    return tags.length === 0;
  }
  return filter.tags.every((tag) => tags.includes(tag));
}

/** Every tag in use with how many items carry it, most used first. */
export function countTags(items) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of itemTags(item)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
