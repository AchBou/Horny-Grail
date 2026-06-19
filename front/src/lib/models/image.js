/**
 * Frontend model representing an image saved in DynamoDB.
 *
 * @typedef {Object} ImageItem
 * @property {string} id - Content hash (hex) used as the primary ID.
 * @property {string} [hex] - Optional hex identifier (kept for backward compatibility); usually equals id.
 * @property {string|null} dateAdded - ISO timestamp string when the picture was added (or null if unknown).
 */

/**
 * Normalize an arbitrary API payload item to the ImageItem model.
 * Handles items coming from DynamoDB DocumentClient (plain JS objects)
 * or fallback string forms like "<hex>" or URLs/filenames.
 *
 * @param {any} item
 * @returns {ImageItem | null}
 */
export function normalizeImageItem(item) {
  if (!item) return null;

  // If a string is provided, try to extract hex from it
  if (typeof item === 'string') {
    const base = item.split('/').pop();
    const hex = base ? (base.includes('.') ? base.split('.')[0] : base) : null;
    if (!hex) return null;
    return { id: hex, hex, dateAdded: null };
  }

  if (typeof item === 'object') {
    // Prefer explicit properties; fallbacks included for compatibility
    const id = item.id ?? item.pk ?? null;
    const hex = item.hex ?? null;
    const dateAdded = item.dateAdded ?? item.createdAt ?? item.addedAt ?? item.date ?? item.created_at ?? null;

    if (!id && !hex) return null;

    return {
      id: id || hex,
      hex: hex || id, // keep something usable for thumbnails even if only one exists
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
