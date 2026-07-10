const HASH_RE = /^[a-fA-F0-9]{64}$/;
const EXT_RE = /^(jpe?g|png|gif|webp|bmp|tiff?|webm|mp4)$/i;
const MIME_BY_EXT = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webm: 'video/webm',
  mp4: 'video/mp4'
});

export const ORIGINAL_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const THUMBNAIL_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

export function isValidImageId(id) {
  return typeof id === 'string' && HASH_RE.test(id);
}

export function isValidImageExt(ext) {
  return typeof ext === 'string' && EXT_RE.test(ext);
}

export function normalizeImageExt(ext) {
  return typeof ext === 'string' ? ext.toLowerCase() : '';
}

export function getMimeTypeForImageExt(ext) {
  return MIME_BY_EXT[normalizeImageExt(ext)] || null;
}

export function isValidContentLength(sizeBytes, maxBytes) {
  return Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= maxBytes;
}

export function parseJsonBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return null;
  }
}
