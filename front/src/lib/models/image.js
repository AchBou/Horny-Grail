/**
 * Frontend model representing an image saved in DynamoDB.
 *
 * @typedef {Object} ImageItem
 * @property {string} id - Content hash used as the canonical primary ID.
 * @property {string|null} [ext] - Original file extension.
 * @property {'image'|'video'} [kind] - Media kind inferred from extension.
 * @property {string|null} dateAdded - ISO timestamp string when the picture was added (or null if unknown).
 * @property {string[]} tags - Tags set from the desktop app (sorted, lowercase); empty when untagged.
 */

/**
 * @param {any} value
 * @returns {string[]}
 */
function normalizeTags(value) {
  return Array.isArray(value) ? value.filter((tag) => typeof tag === 'string' && tag.length > 0) : [];
}

const VIDEO_EXTENSIONS = new Set(['webm', 'mp4']);

/**
 * @param {string | null | undefined} ext
 * @returns {'image' | 'video'}
 */
export function getMediaKindFromExt(ext) {
  return typeof ext === 'string' && VIDEO_EXTENSIONS.has(ext.toLowerCase()) ? 'video' : 'image';
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function getExtFromStringValue(value) {
  const base = value.split('/').pop() || '';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return ext ? ext.toLowerCase() : null;
}

/**
 * Normalize an arbitrary API payload item to the ImageItem model.
 * Handles items coming from DynamoDB DocumentClient (plain JS objects)
 * or fallback string forms like "<id>" or URLs/filenames.
 *
 * @param {any} item
 * @returns {ImageItem | null}
 */
export function normalizeImageItem(item) {
  if (!item) return null;

  // If a string is provided, try to extract an id from it.
  if (typeof item === 'string') {
    const base = item.split('/').pop();
    const id = base ? (base.includes('.') ? base.split('.')[0] : base) : null;
    if (!id) return null;
    const ext = getExtFromStringValue(item);
    return { id, ext, kind: getMediaKindFromExt(ext), dateAdded: null, tags: [] };
  }

  if (typeof item === 'object') {
    const id = item.id ?? null;
    const ext = typeof item.ext === 'string' ? item.ext.toLowerCase() : getExtFromStringValue(item.url ?? item.src ?? '');
    const dateAdded = item.dateAdded ?? item.createdAt ?? item.addedAt ?? item.date ?? item.created_at ?? null;

    if (!id) return null;

    return {
      id,
      ext,
      kind: getMediaKindFromExt(ext),
      dateAdded: typeof dateAdded === 'string' ? dateAdded : (dateAdded?.toString?.() ?? null),
      tags: normalizeTags(item.tags)
    };
  }

  return null;
}

/**
 * The browse filter in the page URL: `?tags=a,b` (items with all of them) or `?untagged=1`.
 * @param {URLSearchParams} params
 * @returns {{ tags: string[], untagged: boolean }}
 */
export function readTagFilter(params) {
  const untagged = params.get('untagged') === '1';
  const tags = untagged
    ? []
    : [...new Set((params.get('tags') || '').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  return { tags, untagged };
}

/**
 * Writes a browse filter into query parameters (removing it when empty).
 * @param {URLSearchParams} params
 * @param {{ tags: string[], untagged: boolean }} filter
 */
export function writeTagFilter(params, filter) {
  params.delete('tags');
  params.delete('untagged');
  if (filter.untagged) params.set('untagged', '1');
  else if (filter.tags.length > 0) params.set('tags', filter.tags.join(','));
}

/**
 * Normalize an array of items to ImageItem[]
 * @param {any} payload
 * @returns {ImageItem[]}
 */
export function normalizeImages(payload) {
  const arr = Array.isArray(payload) ? payload : (payload?.data ?? []);
  return arr
    .map(normalizeImageItem)
    .filter(Boolean);
}
