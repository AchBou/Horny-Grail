import { buildApiUrl, WRITE_API_KEY } from "../config/apiEnv.js";
import { httpFetch } from "../config/httpClient.js";

// Same rules as the backend (serverless/horny-grail-app/src/lib/tags.mjs): lowercase, single
// spaces, letters in any language, digits, spaces, "-" and "_", at most 32 characters.
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;
export const MAX_TAG_LENGTH = 32;

/**
 * @param {string} value
 * @returns {string | null} the stored form of the tag, or null when it is not allowed
 */
export function normalizeTag(value) {
  const tag = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  return tag && tag.length <= MAX_TAG_LENGTH && TAG_RE.test(tag) ? tag : null;
}

/**
 * Splits typed text on commas into tags, skipping ones that are not allowed.
 * @param {string} text
 * @returns {{ tags: string[], rejected: string[] }}
 */
export function parseTagInput(text) {
  /** @type {string[]} */
  const tags = [];
  /** @type {string[]} */
  const rejected = [];
  for (const part of String(text ?? "").split(",")) {
    if (!part.trim()) continue;
    const tag = normalizeTag(part);
    if (!tag) rejected.push(part.trim());
    else if (!tags.includes(tag)) tags.push(tag);
  }
  return { tags, rejected };
}

/**
 * @typedef {{ tag: string, count: number }} TagCount
 * @typedef {{ tags: TagCount[], total: number, untagged: number }} TagSummary
 */

/** @returns {Promise<TagSummary>} every tag in use with its item count */
export async function fetchTagSummary() {
  const response = await httpFetch(buildApiUrl("/desktop/tags"), {
    headers: { "x-api-key": WRITE_API_KEY }
  });
  if (!response.ok) {
    throw new Error(`Loading tags failed with status ${response.status}`);
  }
  return response.json();
}

/** @type {Map<string, Promise<unknown>>} */
const pendingChanges = new Map();

/**
 * Adds and removes tags on an item in the Grail. Changes to the same item are sent one after
 * another: the server reads then writes the tag list, so two at once could lose one.
 * @param {string} id
 * @param {{ add?: string[], remove?: string[] }} change
 * @returns {Promise<string[]>} the item's tags afterwards
 */
export function updateItemTags(id, change) {
  const previous = pendingChanges.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => sendTagChange(id, change));
  pendingChanges.set(id, next);
  next.finally(() => {
    if (pendingChanges.get(id) === next) pendingChanges.delete(id);
  }).catch(() => {});
  return next;
}

/**
 * @param {string} id
 * @param {{ add?: string[], remove?: string[] }} change
 * @returns {Promise<string[]>}
 */
async function sendTagChange(id, change) {
  const response = await httpFetch(buildApiUrl(`/assets/${id}/tags`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-api-key": WRITE_API_KEY },
    body: JSON.stringify(change)
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json())?.message || "";
    } catch {
      // keep the status code only
    }
    throw new Error(detail || `Saving tags failed with status ${response.status}`);
  }
  return (await response.json()).tags;
}

/**
 * @typedef {{ id: string, ext: string, date?: string, tags?: string[], fileUrl: string, thumbnailUrl: string }} WatchItem
 * @typedef {{ items: WatchItem[], cursor: string | null, hasMore: boolean }} WatchPage
 */

/**
 * One page of the shuffled feed from the Grail, optionally filtered.
 * @param {{ cursor?: string | null, tags?: string[], untagged?: boolean, limit?: number }} options
 * @returns {Promise<WatchPage>}
 */
export async function fetchWatchPage({ cursor = null, tags = [], untagged = false, limit = 36 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (untagged) params.set("untagged", "1");
  else if (tags.length > 0) params.set("tags", tags.join(","));

  const response = await httpFetch(buildApiUrl(`/desktop/browse/random?${params}`), {
    headers: { "x-api-key": WRITE_API_KEY }
  });
  if (!response.ok) {
    throw new Error(`Loading the feed failed with status ${response.status}`);
  }
  return response.json();
}
