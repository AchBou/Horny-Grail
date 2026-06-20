/**
 * Frontend model representing an image saved in DynamoDB.
 *
 * @typedef {Object} ImageItem
 * @property {string} id - Content hash used as the canonical primary ID.
 * @property {string|null} [ext] - Original file extension.
 * @property {'image'|'video'} [kind] - Media kind inferred from extension.
 * @property {string|null} dateAdded - ISO timestamp string when the picture was added (or null if unknown).
 */

const VIDEO_EXTENSIONS = new Set(['webm']);

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
    return { id, ext, kind: getMediaKindFromExt(ext), dateAdded: null };
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
      dateAdded: typeof dateAdded === 'string' ? dateAdded : (dateAdded?.toString?.() ?? null)
    };
  }

  return null;
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
